/**
 * 자율 하루의 읽기 경로 부하 시나리오 (k6) — T6.3.
 *
 * `submit-answers.k6.js`가 답안 쓰기(임시 저장·확정 제출)를 재는 데 비해,
 * 이 시나리오는 **수업 시작 직전 30분**을 재현한다. 그 창에서 실제로 일어나는
 * 것은 쓰기가 아니라 읽기다:
 *
 *   학생 전원이 「오늘 학습」을 연다        → 하루 계획 투영 (쓰기 한 번 포함)
 *   학생이 개념 자료·시험 목록을 훑는다     → 순수 조회
 *   교사가 오늘 운영실·반별 진행을 연다     → 반 인원만큼의 계획을 다시 읽는다
 *   교사가 날짜별 준비도를 미리 본다        → 학생 화면과 같은 투영기 (계획은 안 남김)
 *
 * 마지막 둘이 이 시나리오의 이유다. 교사 화면 하나가 **학생 수만큼의 계산**을
 * 돌린다(listGroupDayProgress · loadDayReadiness). 학생 부하와 교사 부하는
 * 곱해지지 더해지지 않는다 — 그것이 답안 제출 부하와 성격이 다른 지점이고,
 * 답안 쪽만 재고 넘어가면 놓친다.
 *
 * 근거: docs/phase0/slo.md 2.1(L-01 오늘 학습·운영실 p95 1.5s / p99 3s),
 *       9장(부하시험 통과 조건), assumptions.md 3.1
 *
 * ── 먼저 읽을 것 ─────────────────────────────────────────────
 * scripts/load/README.md. 이 스크립트는 **세션 쿠키만** 있으면 그대로 돈다 —
 * 전부 GET이라 서버 액션 ID가 필요 없다. 쓰기 경로가 필요하면
 * submit-answers.k6.js를 쓴다.
 *
 *   k6 run -e BASE_URL=https://staging.example.com \
 *          -e STUDENT_COOKIE="sb-xxxx-auth-token=base64-..." \
 *          -e TEACHER_COOKIE="sb-xxxx-auth-token=base64-..." \
 *          -e GROUP_ID=0199... \
 *          scripts/load/autonomous-day.k6.js
 */
import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";
import exec from "k6/execution";

/* ── 설정 ─────────────────────────────────────────────────────── */

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

/** 학생·교사 세션 쿠키. README 2장 — 둘은 **다른 계정**이어야 한다. */
const STUDENT_COOKIE = __ENV.STUDENT_COOKIE || "";
const TEACHER_COOKIE = __ENV.TEACHER_COOKIE || "";

/** 반 상세를 열 대상. 없으면 반 상세 시나리오를 건너뛴다. */
const GROUP_ID = __ENV.GROUP_ID || "";

/**
 * 규모 계수. 시험 환경은 운영의 1/10이다 (slo.md 9장).
 * 결과는 선형 외삽 + 보정 계수 1.3으로 환산한다 (assumptions.md Q-12).
 */
const RPS_SCALE = Number(__ENV.RPS_SCALE || "0.1");
const scaled = (rps) => Math.max(1, Math.round(rps * RPS_SCALE));

/**
 * 기준 RPS.
 *
 * 학생 20,000명이 수업 시작 전 10분 안에 오늘 화면을 연다 = 33.3/초
 * (assumptions.md 3.1의 「시험 시작」과 같은 산출). 한 번 열고 마는 것이
 * 아니라 자료·시험을 오가므로 조회를 그 3배로 잡는다.
 *
 * 교사는 학생의 1/20이지만 화면 하나가 반 인원(평균 15명)만큼의 계획을
 * 계산한다. 그래서 요청 수는 적어도 **부하는 그 15배**로 봐야 한다 —
 * 요청 수만 보고 「교사 쪽은 무시해도 된다」고 판단하는 것이 이 시나리오가
 * 막으려는 오해다.
 */
const BASELINE = {
  studentToday: 33,
  studentBrowse: 100,
  teacherOps: 5,
  teacherReadiness: 2,
};
/** 부하시험 목표는 설계 수용의 2배 (골프롬프트 29장) */
const PEAK_MULTIPLIER = 2;

/* ── 지표 ─────────────────────────────────────────────────────── */

const todayLatency = new Trend("sumaek_learn_today_ms", true);
const browseLatency = new Trend("sumaek_learn_browse_ms", true);
const opsLatency = new Trend("sumaek_teacher_today_ms", true);
const readinessLatency = new Trend("sumaek_teacher_readiness_ms", true);
const authBounced = new Rate("sumaek_auth_bounced");

/* ── 시나리오 ─────────────────────────────────────────────────── */

/** 평시 → 2배 피크 → 회복. 각 구간을 SLO 관측 창(5분)보다 길게 잡는다. */
function rampingStages(baselineRps) {
  const peak = baselineRps * PEAK_MULTIPLIER;
  return [
    { target: scaled(baselineRps * 0.3), duration: "2m" }, // 예열
    { target: scaled(baselineRps), duration: "5m" }, // 평시 피크
    { target: scaled(peak), duration: "3m" }, // 상승
    { target: scaled(peak), duration: "10m" }, // 2배 피크 유지
    { target: scaled(baselineRps), duration: "3m" }, // 회복
    { target: 0, duration: "2m" },
  ];
}

function arrivalScenario(fn, baselineRps, vus, tag) {
  return {
    executor: "ramping-arrival-rate",
    exec: fn,
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: vus,
    maxVUs: vus * 10,
    stages: rampingStages(baselineRps),
    tags: { sumaek_path: tag },
  };
}

const studentScenarios = {
  learn_today: arrivalScenario("learnToday", BASELINE.studentToday, 50, "learn_today"),
  learn_browse: arrivalScenario("learnBrowse", BASELINE.studentBrowse, 100, "learn_browse"),
};

const teacherScenarios = {
  teacher_today: arrivalScenario("teacherToday", BASELINE.teacherOps, 20, "teacher_today"),
  teacher_readiness: arrivalScenario(
    "teacherReadiness",
    BASELINE.teacherReadiness,
    20,
    "teacher_readiness",
  ),
};

export const options = {
  discardResponseBodies: false,
  scenarios: {
    ...(STUDENT_COOKIE ? studentScenarios : {}),
    ...(TEACHER_COOKIE ? teacherScenarios : {}),
  },
  thresholds: {
    /* L-01 오늘 학습·운영실 p95 1.5s / p99 3s. 네 화면 모두 이 SLO다 —
     * 교사 화면이 학생 수만큼 계산한다고 해서 느려도 되는 것이 아니다. */
    sumaek_learn_today_ms: ["p(95)<1500", "p(99)<3000"],
    sumaek_learn_browse_ms: ["p(95)<1500", "p(99)<3000"],
    sumaek_teacher_today_ms: ["p(95)<1500", "p(99)<3000"],
    sumaek_teacher_readiness_ms: ["p(95)<1500", "p(99)<3000"],
    /* 세션이 깨지면 전 요청이 조용히 로그인 리다이렉트가 되고, 그러면
     * 「아주 빠른 302」를 재게 된다 — 통과처럼 보이는 실패다. */
    sumaek_auth_bounced: ["rate<0.001"],
    /* 통과 조건 "핵심 API 오류율 < 1%" (slo.md 9장) */
    http_req_failed: ["rate<0.01"],
  },
};

/* ── 공통 ─────────────────────────────────────────────────────── */

function get(path, cookie, trend, name) {
  const response = http.get(`${BASE_URL}${path}`, {
    headers: { Cookie: cookie },
    tags: { name },
    redirects: 0,
  });
  trend.add(response.timings.duration);
  const bounced = response.status === 302 || response.status === 307;
  authBounced.add(bounced);
  check(response, {
    "200": (r) => r.status === 200,
    "로그인으로 튕기지 않음": () => !bounced,
  });
  return response;
}

/* ── 시나리오 본문 ─────────────────────────────────────────────── */

/**
 * 학생이 오늘 화면을 연다 — 이 요청만 **쓰기를 포함한다.**
 * 그날 첫 열람이 하루 계획을 확정하기 때문이다(ADR-0017 §4). 두 번째부터는
 * 병합이라 가벼워진다 — 그래서 이 시나리오의 첫 몇 분이 가장 무겁다.
 */
export function learnToday() {
  get(`/learn/today`, STUDENT_COOKIE, todayLatency, "GET /learn/today");
}

/** 학생이 자료·시험·복습을 오간다 — 순수 조회 */
export function learnBrowse() {
  const paths = ["/learn/study", "/learn/records", "/learn/review"];
  const path = paths[exec.scenario.iterationInTest % paths.length];
  get(path, STUDENT_COOKIE, browseLatency, `GET ${path}`);
}

/**
 * 교사가 오늘 운영실을 연다.
 * 화면 하나가 반별로 학생 전원의 하루 계획을 읽는다(listGroupDayProgress).
 * 요청 수는 학생의 1/20이지만 계산량은 그렇지 않다.
 */
export function teacherToday() {
  get(`/app/today`, TEACHER_COOKIE, opsLatency, "GET /app/today");
  if (GROUP_ID) {
    get(`/app/classes/${GROUP_ID}`, TEACHER_COOKIE, opsLatency, "GET /app/classes/[id]");
  }
}

/**
 * 교사가 날짜별 준비도를 미리 본다.
 * 학생 화면과 **같은 투영기**를 계획을 남기지 않고 돌린다 — 읽기인데 비용은
 * 학생 화면과 같다. 이 화면이 SLO를 넘기면 교사는 수업 직전에 결손을 확인할
 * 수 없고, 그것이 T5.4가 막으려던 상황 그대로다.
 */
export function teacherReadiness() {
  get(`/app/readiness`, TEACHER_COOKIE, readinessLatency, "GET /app/readiness");
}

/* ── 실행 전후 안내 ────────────────────────────────────────────── */

export function setup() {
  console.log(`대상       : ${BASE_URL}`);
  console.log(`규모 계수  : ${RPS_SCALE} (1/10 스테이징 기본값 — 결과는 ×1.3 보정 후 외삽)`);
  console.log(
    `학생 목표  : 평시 ${scaled(BASELINE.studentToday + BASELINE.studentBrowse)} RPS ` +
      `→ 피크 ${scaled((BASELINE.studentToday + BASELINE.studentBrowse) * PEAK_MULTIPLIER)} RPS`,
  );
  console.log(
    `교사 목표  : 평시 ${scaled(BASELINE.teacherOps + BASELINE.teacherReadiness)} RPS ` +
      `(요청 수는 적지만 화면당 반 인원만큼 계산한다)`,
  );
  if (!STUDENT_COOKIE) console.warn("STUDENT_COOKIE 없음 — 학생 시나리오를 건너뜁니다.");
  if (!TEACHER_COOKIE) console.warn("TEACHER_COOKIE 없음 — 교사 시나리오를 건너뜁니다.");
  if (!GROUP_ID) console.warn("GROUP_ID 없음 — 반 상세는 건너뜁니다.");
  if (!STUDENT_COOKIE && !TEACHER_COOKIE) {
    throw new Error("쿠키가 하나도 없습니다 — 잴 것이 없습니다 (README 2장).");
  }
  return {};
}

export function teardown() {
  console.log("");
  console.log("이 시나리오가 통과해도 확인이 남습니다 (slo.md 9장):");
  console.log("  · 하루 계획이 학생당 하나인가 — learner_day_plans_uq 위반 0건");
  console.log("  · 교차 테넌트 노출 0건 — 부하 중 RLS 테스트 동시 실행");
  console.log("  · 불변 조건 위반 0건 — node scripts/verify-recovery.mjs (부하 종료 후)");
  console.log("");
  console.log("쓰기 경로(답안 저장·제출)는 submit-answers.k6.js가 잽니다.");
}
