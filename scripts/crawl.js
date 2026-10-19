"use strict";
/*
 * 기업 홈페이지 정보 수집 — 과제 6단계.
 *
 *   npm run crawl -- --name 안랩               # 회사명으로 찾아 수집·요약
 *   npm run crawl -- --code 00110583           # DART 고유번호로
 *   npm run crawl -- --name 안랩 --url https://www.ahnlab.com   # 공시 주소 대신 직접 지정
 *   npm run crawl -- --url https://www.ahnlab.com --dry-run    # 저장·요약 없이 무엇을 읽는지만
 *   npm run crawl -- --show --name 안랩        # 저장된 요약 보기
 *
 * 회사 목록과 홈페이지 주소는 8장(DART enrich)에서 받아온 것을 쓴다.
 * 무엇을 읽고 무엇을 건너뛰는지는 src/crawl.js 머리말에 적어 두었다.
 */
const { db } = require("../src/db");
const crawl = require("../src/crawl");
require("../src/config"); // .env 로드

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

function findCompany() {
  const d = db();
  const code = val("--code");
  if (code) return d.prepare("SELECT * FROM companies WHERE corp_code=?").get(code);
  const name = val("--name");
  if (!name) return null;
  const rows = d
    .prepare("SELECT * FROM companies WHERE corp_name LIKE ? ORDER BY (corp_name = ?) DESC, (stock_code IS NOT NULL) DESC, length(corp_name) LIMIT 5")
    .all(`%${name}%`, name);
  if (rows.length > 1 && rows[0].corp_name !== name) {
    console.log("여러 회사가 걸립니다. --code 로 하나를 고르세요:");
    for (const r of rows) console.log(`  ${r.corp_code}  ${r.corp_name}${r.stock_code ? " (상장)" : ""}  ${r.hm_url || ""}`);
    process.exit(1);
  }
  return rows[0];
}

function show(co) {
  const w = crawl.load(co.corp_code);
  if (!w) return console.log(`${co.corp_name}: 아직 수집하지 않았습니다.`);
  const s = w.summary;
  console.log(`${co.corp_name} — ${w.fetched_at.slice(0, 10)} 수집, ${w.pages.length}쪽`);
  if (s.overview) console.log("\n개요\n  " + s.overview);
  if (s.business.length) console.log("\n주요 사업\n" + s.business.map((x) => "  - " + x).join("\n"));
  if (s.talent.length) console.log("\n인재상·강조점\n" + s.talent.map((x) => "  - " + x).join("\n"));
  if (s.keywords.length) console.log("\n핵심어  " + s.keywords.join(", "));
  console.log("\n출처\n" + w.pages.map((p) => "  " + p.url).join("\n"));
  if (w.blocked.length) console.log("\nrobots.txt 로 건너뜀\n" + w.blocked.map((u) => "  " + u).join("\n"));
}

async function main() {
  const log = (m) => console.log("  " + m);

  if (has("--dry-run")) {
    const co = val("--name") || val("--code") ? findCompany() : null;
    const url = val("--url") || (co && co.hm_url);
    if (!url) throw new Error("--url 을 주거나, 홈페이지 주소가 있는 회사를 고르세요.");
    const r = await crawl.crawlSite(url, { log });
    console.log(`\n읽은 쪽 ${r.pages.length}개 · robots.txt: ${r.robots}`);
    for (const p of r.pages) console.log(`  ${p.url}  ${p.title}  (${p.text.length}자)`);
    return;
  }

  const co = findCompany();
  if (!co) throw new Error("회사를 찾지 못했습니다. 먼저 npm run dart codes / enrich 로 회사 목록을 받으세요.");
  if (has("--show")) return show(co);

  const url = val("--url") || co.hm_url;
  if (!url) throw new Error(`${co.corp_name} 은(는) 공시에 홈페이지 주소가 없습니다. --url 로 직접 주세요.`);
  console.log(`${co.corp_name} 수집: ${url}`);
  await crawl.crawlCompany(co, { url, log });
  console.log("");
  show(co);
}

main().catch((e) => {
  console.error("오류:", e.message);
  process.exit(1);
});
