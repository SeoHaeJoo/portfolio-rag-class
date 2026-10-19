"use strict";
/*
 * 기업 홈페이지 정보 수집 (과제 6단계).
 *
 * OpenDART 는 공시 숫자만 준다. 자기소개서의 '지원동기'에는 그 회사가 무엇을 하고
 * 어떤 사람을 찾는지가 필요하므로, 공시의 홈페이지 주소(hm_url)에서 몇 쪽만 읽어
 * Gemini 로 요약해 둔다.
 *
 * 수집해도 되는가를 먼저 따진다.
 *   - robots.txt 가 막은 경로는 읽지 않는다. robots.txt 를 못 읽으면 첫 페이지만 읽는다.
 *   - 회사 소개·사업·인재상·채용처럼 '회사가 알리려고 공개한' 페이지만 고른다.
 *   - 한 회사에 최대 MAX_PAGES 쪽, 요청 사이 DELAY_MS 를 둔다.
 *   - 원문 HTML 은 저장하지 않는다. 요약과 출처 URL 만 남긴다.
 *   - 로그인·게시판·개인정보처리방침 같은 경로는 처음부터 제외한다.
 */
const { db } = require("./db");
const { gemini } = require("./config");

const UA = "portfolio-rag-class/0.1 (student coursework; company summary for cover letter)";
const MAX_PAGES = 5;
const DELAY_MS = 1500;
const TIMEOUT_MS = 10000;
const MAX_TEXT = 6000; // 쪽당 프롬프트에 넣는 글자 수

/* 링크 글자나 주소에 이런 말이 있으면 회사 소개 쪽으로 본다 */
const WANT = /회사\s*소개|기업\s*소개|about|company|사업|business|solution|솔루션|제품|product|서비스|service|비전|vision|미션|인재상|채용|recruit|career|핵심\s*가치|연혁|history/i;
/* 읽을 필요가 없거나 읽으면 안 되는 쪽 */
const SKIP = /login|logout|signin|join|member|mypage|\/\/my[a-z]*\.|privacy|개인정보|board|bbs|notice|qna|faq|cart|order|download|contact|news|press|pr-room|blog|content-center|event|invest|\.(pdf|zip|jpg|jpeg|png|gif|hwp|docx?|xlsx?|pptx?)(\?|$)/i;

/* 회사 소개·인재상 쪽을 제품 쪽보다 먼저 읽는다. 앞의 것이 우선, 제품 쪽은 PRODUCT_PAGES 개까지 */
const PRIORITY = [
  /회사\s*소개|기업\s*소개|about|company|ceo|인사말/i,
  /인재상|채용|recruit|career|talent|people|핵심\s*가치|비전|vision|미션|mission|culture|문화/i,
  /사업\s*(분야|소개|영역)|business|연혁|history/i,
];
const PRODUCT_PAGES = 2;

/*
 * 중간 인증서를 빠뜨린 사이트(예: 이글루코퍼레이션)는 브라우저와 달리 Node 에서 실패한다.
 * 운영체제 인증서 저장소도 함께 믿도록 한다 (Node 22.19+/24.5+ 에서만 동작, 아니면 그대로).
 */
try {
  const tls = require("tls");
  if (tls.setDefaultCACertificates && tls.getCACertificates) {
    tls.setDefaultCACertificates([...new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")])]);
  }
} catch (_) {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeUrl(u) {
  if (!u) return null;
  let s = String(u).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    return new URL(s).href;
  } catch (_) {
    return null;
  }
}

/* 오래된 국내 사이트는 EUC-KR 이 많다. 헤더나 <meta charset> 을 보고 디코딩한다 */
function decodeBody(buf, type) {
  const head = buf.subarray(0, 2048).toString("latin1");
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(type) || /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  let cs = m ? m[1].toLowerCase() : "utf-8";
  if (cs === "ks_c_5601-1987" || cs === "cp949") cs = "euc-kr";
  try {
    return new TextDecoder(cs).decode(buf);
  } catch (_) {
    return new TextDecoder("utf-8").decode(buf);
  }
}

/* fetch 실패 이유(인증서·DNS 등)는 e.cause 에 있다 */
function why(e) {
  if (e.name === "AbortError") return "시간 초과";
  const c = e.cause;
  return c ? `${c.code || ""} ${c.message || ""}`.trim() : e.message;
}

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain" }, redirect: "follow", signal: ctl.signal });
    const type = r.headers.get("content-type") || "";
    const body = r.ok && /text|html/i.test(type) ? decodeBody(Buffer.from(await r.arrayBuffer()), type) : "";
    return { ok: r.ok, status: r.status, url: r.url || url, body };
  } finally {
    clearTimeout(t);
  }
}

/* ── robots.txt ──────────────────────────────── */

/*
 * User-agent: * 묶음의 Disallow/Allow 만 본다. 가장 길게 일치하는 규칙이 이긴다.
 * 표준(RFC 9309)의 핵심만 구현했다 — 와일드카드는 '*' 와 끝의 '$' 만 지원한다.
 */
function parseRobots(text) {
  const rules = [];
  let mine = false;
  let inGroup = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === "user-agent") {
      if (!inGroup) mine = false;
      inGroup = true;
      if (v === "*" || /portfolio-rag-class/i.test(v)) mine = true;
    } else {
      inGroup = false;
      if (mine && (k === "disallow" || k === "allow") && v) rules.push({ allow: k === "allow", path: v });
    }
  }
  return rules;
}

function ruleMatches(rule, path) {
  const re = "^" + rule.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/\\\$$/, "$");
  return new RegExp(re).test(path);
}

function allowedBy(rules, url) {
  const u = new URL(url);
  const path = u.pathname + u.search;
  let best = null;
  for (const r of rules) {
    if (ruleMatches(r.path, path) && (!best || r.path.length > best.path.length)) best = r;
  }
  return !best || best.allow;
}

/* ── HTML → 글자 ─────────────────────────────── */

function decode(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlText(html) {
  return decode(
    String(html || "")
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function pageTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1]).replace(/\s+/g, " ").trim() : "";
}

/* www 를 뗀 호스트. company.ahnlab.com 처럼 같은 회사 하위 도메인도 같은 사이트로 본다 */
const siteOf = (url) => new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
const inSite = (url, site) => {
  const h = new URL(url).hostname.toLowerCase();
  return h === site || h.endsWith("." + site);
};

/* 같은 사이트 안에서 회사 소개 쪽으로 보이는 링크만 고른다 */
function pickLinks(html, base, site = siteOf(base)) {
  const out = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    let href;
    try {
      href = new URL(decode(m[1]), base).href;
    } catch (_) {
      continue;
    }
    if (!/^https?:/i.test(href) || !inSite(href, site) || SKIP.test(href)) continue;
    const label = htmlText(m[2]);
    if (!WANT.test(label) && !WANT.test(href)) continue;
    if (!out.has(href)) out.set(href, label);
  }
  /* 메뉴 앞쪽의 제품 링크가 자리를 다 차지하지 않도록 우선순위로 줄 세운다 */
  const rank = (href, label) => {
    const p = new URL(href).pathname;
    const i = PRIORITY.findIndex((re) => re.test(label) || re.test(p));
    return i < 0 ? PRIORITY.length : i;
  };
  /* 분류마다 하나씩 돌아가며 뽑아 회사소개만 여러 쪽 읽는 일을 막는다. 제품 쪽은 맨 뒤 */
  const groups = PRIORITY.map(() => []);
  const products = [];
  for (const [href, label] of out) {
    const r = rank(href, label);
    (r < PRIORITY.length ? groups[r] : products).push(href);
  }
  const picked = [];
  while (groups.some((g) => g.length)) for (const g of groups) if (g.length) picked.push(g.shift());
  return picked.concat(products.slice(0, PRODUCT_PAGES));
}

/* ── 수집 ────────────────────────────────────── */

/* 글자가 거의 없고 자바스크립트·meta refresh 로 다른 쪽으로 넘기기만 하는 첫 화면의 목적지 */
function stubTarget(html, base) {
  const s = String(html || "");
  const found = [
    /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'>\s]+)/gi,
    /location(?:\.href)?\s*(?:=|\.replace\(|\.assign\()\s*["']([^"']+)["']/gi,
    /<i?frame\b[^>]*src\s*=\s*["']([^"']+)["']/gi,
  ].flatMap((re) => [...s.matchAll(re)].map((m) => m[1]));
  /* 브라우저 언어로 갈라 보내는 경우가 많다 — 한국어 쪽을 고른다 */
  const pick = found.find((u) => /(^|[\/_.-])(ko|kor|kr|korean)([\/_.-]|$)/i.test(u)) || found[0];
  if (!pick) return null;
  try {
    return new URL(decode(pick), base).href;
  } catch (_) {
    return null;
  }
}

async function crawlSite(startUrl, { log = () => {} } = {}) {
  const home = normalizeUrl(startUrl);
  if (!home) throw new Error("홈페이지 주소가 없습니다.");

  /* robots.txt 는 하위 도메인마다 따로 있다. null = 확인 못 함 */
  const robots = new Map();
  async function rulesFor(url) {
    const origin = new URL(url).origin;
    if (!robots.has(origin)) {
      let rules = null;
      try {
        const r = await get(origin + "/robots.txt");
        if (r.status === 200) rules = parseRobots(r.body);
        else if (r.status >= 400 && r.status < 500) rules = []; // 없으면 제한 없음(RFC 9309)
      } catch (_) {}
      robots.set(origin, rules);
    }
    return robots.get(origin);
  }

  /* 첫 화면이 실제로 열린 주소의 robots.txt 가 기준. 그걸 못 읽으면 첫 화면만 읽는다 */
  let homeRules = null;

  const pages = [];
  const blocked = [];
  const queue = [home];
  const seen = new Set();
  let site = siteOf(home);
  let hops = 0;
  while (queue.length && pages.length < (homeRules === null ? 1 : MAX_PAGES)) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const rules = await rulesFor(url);
    /* 첫 화면(과 그 넘겨주기 목적지)은 robots.txt 를 몰라도 읽고, 나머지 쪽은 확인된 곳만 읽는다 */
    if (rules === null && pages.length) {
      log(`robots.txt 를 확인하지 못해 건너뜀: ${url}`);
      continue;
    }
    if (rules && !allowedBy(rules, url)) {
      blocked.push(url);
      log(`robots.txt 제외: ${url}`);
      continue;
    }
    if (pages.length || hops) await sleep(DELAY_MS);
    let r;
    try {
      r = await get(url);
    } catch (e) {
      log(`실패: ${url} (${why(e)})`);
      /* 공시 주소엔 http/https 구분이 없어 http 로 붙여 둔다. 첫 화면이 안 열리면 https 로 한 번 더 */
      if (!pages.length && url.startsWith("http://")) queue.unshift("https://" + url.slice(7));
      continue;
    }
    if (!r.ok || !r.body) {
      log(`건너뜀: ${url} (HTTP ${r.status})`);
      continue;
    }
    const text = htmlText(r.body);
    if (!pages.length && text.length < 200 && hops < 2) {
      const next = stubTarget(r.body, r.url);
      if (next) {
        hops++;
        log(`넘겨주기만 하는 첫 화면: ${r.url} → ${next}`);
        queue.unshift(next);
        continue;
      }
    }
    if (text.length < 50) {
      log(`건너뜀: ${r.url} (글자가 거의 없음 — 자바스크립트로 그리는 쪽일 수 있음)`);
      continue;
    }
    pages.push({ url: r.url, title: pageTitle(r.body), text });
    log(`읽음: ${r.url} (${text.length.toLocaleString()}자)`);
    if (pages.length === 1) {
      site = siteOf(r.url); // 다른 주소로 넘어갔으면 그쪽을 기준으로
      homeRules = await rulesFor(r.url);
      if (homeRules === null) log("robots.txt 를 확인하지 못해 첫 페이지만 읽습니다.");
      else for (const l of pickLinks(r.body, r.url, site)) if (!seen.has(l)) queue.push(l);
    }
  }
  return { home, pages, blocked, robots: homeRules === null ? "unknown" : homeRules.length ? "rules" : "none" };
}

/* ── 요약 ────────────────────────────────────── */

const SUMMARY_SYSTEM = `당신은 기업 홈페이지 글을 읽고 취업 준비생이 참고할 회사 개요를 정리합니다.
- 주어진 홈페이지 글에 있는 사실만 쓰십시오. 없으면 빈 문자열이나 빈 배열로 두십시오.
- 홍보 문구는 걷어내고 사실 위주로 짧게 쓰십시오.
- JSON 만 출력하십시오.`;

function summaryPrompt(name, pages) {
  const body = pages
    .map((p, i) => `[${i + 1}] ${p.title || ""} (${p.url})\n${p.text.slice(0, MAX_TEXT)}`)
    .join("\n\n");
  return `회사: ${name}

아래 홈페이지 글을 읽고 다음 형식의 JSON 으로 정리하십시오.
{
  "overview": "회사가 무엇을 하는 곳인지 2~3문장",
  "business": ["주요 사업·제품·서비스, 항목당 한 줄"],
  "talent": ["인재상·핵심가치·채용에서 강조하는 점, 항목당 한 줄"],
  "keywords": ["자기소개서에 연결할 만한 핵심어 5개 이내"]
}

${body}`;
}

async function summarize(name, pages) {
  if (!gemini.enabled()) throw new Error("GEMINI_API_KEY 가 없어 요약할 수 없습니다.");
  const url = `${gemini.base()}/v1beta/models/${gemini.textModel()}:generateContent?key=${encodeURIComponent(gemini.key())}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SUMMARY_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: summaryPrompt(name, pages) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200, responseMimeType: "application/json" },
    }),
  });
  if (!r.ok) throw new Error(`요약 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const cand = (j.candidates || [])[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || "").join("");
  const s = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
  const arr = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return { overview: String(s.overview || ""), business: arr(s.business), talent: arr(s.talent), keywords: arr(s.keywords) };
}

/* ── 저장 ────────────────────────────────────── */

function save(corpCode, result, summary) {
  db()
    .prepare(
      `INSERT INTO company_web (corp_code, home_url, pages, blocked, robots, summary, fetched_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(corp_code) DO UPDATE SET home_url=excluded.home_url, pages=excluded.pages,
         blocked=excluded.blocked, robots=excluded.robots, summary=excluded.summary, fetched_at=excluded.fetched_at`
    )
    .run(
      corpCode,
      result.home,
      JSON.stringify(result.pages.map((p) => ({ url: p.url, title: p.title }))),
      JSON.stringify(result.blocked),
      result.robots,
      JSON.stringify(summary),
      new Date().toISOString()
    );
}

function load(corpCode) {
  const r = db().prepare("SELECT * FROM company_web WHERE corp_code=?").get(corpCode);
  if (!r) return null;
  return { ...r, pages: JSON.parse(r.pages || "[]"), blocked: JSON.parse(r.blocked || "[]"), summary: JSON.parse(r.summary || "{}") };
}

/* 회사 하나를 읽고 요약해 저장한다 */
async function crawlCompany(co, opts = {}) {
  const result = await crawlSite(opts.url || co.hm_url, opts);
  if (!result.pages.length) throw new Error("읽을 수 있는 페이지가 없습니다.");
  const summary = await summarize(co.corp_name, result.pages);
  save(co.corp_code, result, summary);
  return { ...result, summary };
}

module.exports = { crawlSite, crawlCompany, summarize, load, parseRobots, allowedBy, htmlText, pickLinks, normalizeUrl };
