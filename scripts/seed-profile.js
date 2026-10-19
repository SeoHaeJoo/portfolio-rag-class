"use strict";
/*
 * 서해주 프로필 심기.
 *
 *   npm run seed:profile
 *   npm run seed:profile -- --reset   # 기존 큐레이션 데이터를 지우고 다시
 *
 * scripts/seed-sample.js 를 본인 내용으로 바꾼 것이다.
 * 생년월일·주소·전화·이메일은 저장소에 올리지 않으려고 myprofile/basic.json
 * (.gitignore 대상)에서 읽는다. 파일이 없으면 빈 값으로 둔다.
 */
const fs = require("fs");
const path = require("path");
const { db } = require("../src/db");

const RESET = process.argv.includes("--reset");
const now = () => new Date().toISOString();

const PRIVATE_FILE = path.join(__dirname, "..", "myprofile", "basic.json");
const PRIVATE = fs.existsSync(PRIVATE_FILE) ? JSON.parse(fs.readFileSync(PRIVATE_FILE, "utf8")) : {};

/* ── 인적사항 ─────────────────────────────────── */
const BASIC = {
  name: "서해주",
  name_sub: "SeoHaeJoo",
  birth: PRIVATE.birth || "",
  headline: "디지털 흔적 속에서 사실을 찾아내는 법을 공부합니다",
  org: "목원대학교 컴퓨터융합학부",
  position: "4학년 재학",
  email: PRIVATE.email || "",
  phone: PRIVATE.phone || "",
  office: "",
  address: PRIVATE.address || "",
  summary: [
    "목원대학교 컴퓨터융합학부에서 컴퓨터 전반을 공부하고 있습니다.",
    "디지털 포렌식에 흥미를 느껴 관련 지식과 도구를 스스로 익히고 있습니다.",
  ].join("\n"),
  photo: "",
};

/* ── 학력 ────────────────────────────────────── */
const EDUCATION = [
  ["목원대학교 컴퓨터융합학부", "목원대학교", "2018-03", "2027-03", "학사 재학 (4학년, 졸업예정)"],
];

/* ── 경력 ────────────────────────────────────── */
const CAREER = [
  ["병역 (만기 제대)", "대한민국 육군", "", "", "군 휴학 기간 중 복무"],
  ["아르바이트", "헬스장·편의점·음식점·노래방·당구장·시장", "", "", "휴학 기간 동안 여러 업종에서 고객 응대와 매장 운영 업무"],
];

/* ── 자격 ────────────────────────────────────── */
const CERTS = [];

/* ── 어학 ────────────────────────────────────── */
const LANGUAGE = [];

/*
 * ── 활동(포트폴리오) ──────────────────────────
 * [분류, 제목, 기관, 역할, 시작, 종료, 요약, 성과, 태그]
 * 분류는 기술개발 · 정책연구 · 논문 · 저서 · 창업활동 · 수상내역 · 대외활동
 */
const ACTIVITIES = [
  ["기술개발", "앱 인벤터 주사위 게임", "목원대학교 '앱인벤터를 이용한 인공지능 프로그래밍' 수업", "개발", "", "",
    "MIT 앱 인벤터로 간단한 주사위 게임 앱을 만들었다.",
    "", "앱인벤터,모바일앱,수업과제"],
  ["논문", "디지털 포렌식 주제 논문 준비", "목원대학교", "저자", "", "",
    "디지털 포렌식에 흥미를 느껴 관련 논문 작성을 준비하고 있다.",
    "", "디지털포렌식,논문,준비중"],
];

function main() {
  const d = db();

  if (RESET) {
    d.exec(
      "DELETE FROM project_docs; DELETE FROM projects; DELETE FROM profile_docs; DELETE FROM profile_items; DELETE FROM profile_basic;"
    );
    console.log("기존 큐레이션 데이터 삭제");
  }

  if (!d.prepare("SELECT COUNT(*) c FROM profile_basic").get().c) {
    d.prepare(
      `INSERT INTO profile_basic (id,name,name_sub,birth,headline,org,position,email,phone,office,address,summary,photo,updated_at)
       VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(BASIC.name, BASIC.name_sub, BASIC.birth, BASIC.headline, BASIC.org, BASIC.position,
      BASIC.email, BASIC.phone, BASIC.office, BASIC.address, BASIC.summary, BASIC.photo, now());
    console.log("인적사항 1건");
  }

  const insItem = d.prepare(
    `INSERT INTO profile_items (kind,title,org,period_start,period_end,description,tags,sort_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  const hasItem = d.prepare("SELECT COUNT(*) c FROM profile_items WHERE kind=? AND title=?");
  let n = 0;
  const add = (kind, title, org, s, e, desc, i) => {
    if (hasItem.get(kind, title).c) return;
    insItem.run(kind, title, org, s, e, desc, "", i, now(), now());
    n++;
  };
  EDUCATION.forEach(([t, o, s, e, dsc], i) => add("학력", t, o, s, e, dsc, i));
  CAREER.forEach(([t, o, s, e, dsc], i) => add("경력", t + " · " + o, o, s, e, dsc, i));
  CERTS.forEach(([t, o, date, no], i) => add("자격", t, o, date, date, no ? "등록번호 " + no : "", i));
  LANGUAGE.forEach(([t, o, dsc], i) => add("어학", t, o, "", "", dsc, i));
  console.log(`프로필 항목 ${n}건`);

  const insAct = d.prepare(
    `INSERT INTO projects (title,org,role,category,period_start,period_end,summary,outcomes,tags,featured,visibility,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const hasAct = d.prepare("SELECT COUNT(*) c FROM projects WHERE title=?");
  let m = 0;
  for (const [category, title, org, role, s, e, summary, outcomes, tags] of ACTIVITIES) {
    if (hasAct.get(title).c) continue;
    insAct.run(title, org, role, category, s, e, summary, outcomes, tags, 0, "private", now(), now());
    m++;
  }
  console.log(`활동 ${m}건`);
  console.log("\n다음: npm run index:activities && npm start");
}

main();
