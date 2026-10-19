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
  headline: "운영체제에 남은 흔적으로 사실을 입증하는 법을 공부합니다",
  org: "목원대학교 컴퓨터융합학부",
  position: "4학년 재학",
  email: PRIVATE.email || "",
  phone: PRIVATE.phone || "",
  office: "",
  address: PRIVATE.address || "",
  summary: [
    "목원대학교 컴퓨터융합학부에서 정보보호응용, 사이버범죄수사정보인텔리전스를 수강하며 보안과 수사 분야를 공부하고 있습니다.",
    "디지털 포렌식에 흥미를 느껴, 브라우저 시크릿 모드의 사용 사실을 운영체제 흔적으로 입증하는 논문을 준비하고 있습니다.",
    "사회복무요원으로 소방 업무를 보조했고, 음식점·시장 등 여러 현장에서 일하며 책임감과 사람을 대하는 법을 배웠습니다.",
  ].join("\n"),
  photo: "",
};

/* ── 학력 ────────────────────────────────────── */
const EDUCATION = [
  ["목원대학교 컴퓨터융합학부", "목원대학교", "2018-03", "2027-03", "학사 재학 (4학년, 졸업예정) · 주요 수강: 정보보호응용, 사이버범죄수사정보인텔리전스"],
];

/* ── 경력 ────────────────────────────────────── */
const CAREER = [
  ["사회복무요원 (소집해제)", "소방서", "", "2024-04", "소방관 업무 보조 및 청사 청소"],
  ["음식점 홀 서빙", "음식점", "", "", "16개 테이블 서빙을 혼자 맡고 영업 마감까지 처리"],
  ["시장 아르바이트", "전통시장", "", "", "새벽 4시부터 저녁 7시까지 근무, 주로 어르신 고객 응대"],
  ["아르바이트", "헬스장·편의점·노래방·당구장", "", "", "휴학 기간 동안 여러 업종에서 고객 응대와 매장 관리"],
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
  ["기술개발", "앱 인벤터 주사위 숫자 맞추기 게임", "목원대학교 '앱인벤터를 이용한 인공지능 프로그래밍' 수업", "개발", "2026-09", "2026-12",
    "MIT 앱 인벤터로 주사위 숫자 맞추기 게임을 만들었다. 첫 주사위 숫자가 나오고, 다음 숫자가 그보다 크면 두 숫자 사이에서 정답을 맞히는 방식이다.",
    "", "앱인벤터,모바일앱,수업과제"],
  ["논문", "시크릿 모드 사용 사실의 운영체제 흔적 기반 입증 (준비 중)", "목원대학교", "저자", "2026-09", "",
    "브라우저 시크릿 모드는 방문 기록을 남기지 않지만, 사용했다는 사실 자체는 운영체제 흔적으로 입증할 수 있는지 연구하려 한다. 주제를 정하고 준비하는 단계다.",
    "", "디지털포렌식,시크릿모드,운영체제아티팩트,논문"],
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
