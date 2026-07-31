/**
 * 답안 제출 부하 시나리오 (k6).
 *
 * 근거: docs/phase0/slo.md 9장(부하시험 통과 조건),
 *       docs/phase0/assumptions.md 3.1(피크 답안 RPS 산출),
 *       docs/phase0/slo.md 2.1(L-01·L-02·L-05 지연 SLO), 2장 O-02
 *
 * 실행 전에 scripts/load/README.md를 읽으세요. 이 스크립트만으로는 쓰기 경로가
 * 돌지 않습니다 — 답안 저장·제출이 Next 서버 액션이라 액션 ID를 빌드마다
 * 뽑아 넣어야 합니다. ID가 없으면 조회 경로만 돌고 쓰기는 건너뜁니다.
 *
 *   k6 run -e BASE_URL=https://staging.example.com \
 *          -e SB_COOKIE="sb-xxxx-auth-token=base64-..." \
 *          -e FIXTURES=./fixtures.json \
 *          scripts/load/submit-answers.k6.js
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

/* ── 설정 ─────────────────────────────────────────────────────── */

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

/** 로그인 세션 쿠키. README 2장 참고 — Supabase 세션을 쿠키 형태로 넣는다. */
const SB_COOKIE = __ENV.SB_COOKIE || "";

/** 서버 액션 ID (빌드마다 바뀐다). README 3장 참고. 없으면 쓰기 시나리오를 끈다. */
const ACTION_SAVE = __ENV.NEXT_ACTION_SAVE || "";
const ACTION_SUBMIT = __ENV.NEXT_ACTION_SUBMIT || "";
const WRITES_ENABLED = SB_COOKIE !== "" && ACTION_SAVE !== "" && ACTION_SUBMIT !== "";

/**
 * 규모 계수. 부하시험 환경은 운영의 1/10이다 (slo.md 9장).
 * 결과는 선형 외삽 + 보정 계수 1.3으로 환산한다 (assumptions.md Q-12).
 * 운영 규모로 때리려면 -e RPS_SCALE=1 을 준다.
 */
const RPS_SCALE = Number(__ENV.RPS_SCALE || "0.1");

/**
 * assumptions.md 3.1의 산출값을 그대로 쓴다.
 *   확정 제출 625 RPS + 임시 저장 250 RPS = 평시 피크 875 RPS
 *   부하시험 목표 2,000 RPS = 설계 수용 1,000 RPS의 2배 (골프롬프트 29장)
 *   시험 시작 33.3/초 = 학생 20,000명 ÷ 10분
 */
const BASELINE = { submit: 625, save: 250, start: 33 };
const PEAK_TOTAL = 2000;
const PEAK = {
  submit: Math.round((PEAK_TOTAL * BASELINE.submit) / (BASELINE.submit + BASELINE.save)),
  save: Math.round((PEAK_TOTAL * BASELINE.save) / (BASELINE.submit + BASELINE.save)),
  start: BASELINE.start * 2,
};

const scaled = (rps) => Math.max(1, Math.round(rps * RPS_SCALE));

/* ── 고정 데이터 ───────────────────────────────────────────────── */

/**
 * 응시 대상. 사전에 시드해 둔 (attemptId, assessmentQuestionId, learnerCookie) 목록.
 * README 4장의 준비 스크립트가 만든다. 없으면 조회 경로만 돈다.
 */
const fixtures = new SharedArray("attempts", () => {
  const path = __ENV.FIXTURES;
  if (!path) return [];
  try {
    const parsed = JSON.parse(open(path));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`FIXTURES를 읽지 못했습니다: ${path} — ${error}`);
    return [];
  }
});

/* ── 커스텀 지표 ───────────────────────────────────────────────── */

const saveLatency = new Trend("sumaek_save_answer_ms", true);
const submitLatency = new Trend("sumaek_submit_attempt_ms", true);
const readLatency = new Trend("sumaek_read_today_ms", true);
const submitFailures = new Rate("sumaek_submit_failed");
const skippedWrites = new Counter("sumaek_skipped_writes");

/* ── 시나리오 ─────────────────────────────────────────────────── */

/** 평시 → 2배 피크 → 회복. 각 구간을 SLO 관측 창(5분 이상)보다 길게 잡는다. */
function rampingStages(baselineRps, peakRps) {
  return [
    { target: scaled(baselineRps * 0.3), duration: "2m" }, // 예열
    { target: scaled(baselineRps), duration: "5m" }, // 평시 피크
    { target: scaled(peakRps), duration: "3m" }, // 상승
    { target: scaled(peakRps), duration: "10m" }, // 2배 피크 유지
    { target: scaled(baselineRps), duration: "3m" }, // 회복
    { target: 0, duration: "2m" },
  ];
}

const writeScenarios = {
  save_answer: {
    executor: "ramping-arrival-rate",
    exec: "saveAnswer",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 200,
    maxVUs: 2000,
    stages: rampingStages(BASELINE.save, PEAK.save),
    tags: { sumaek_path: "save_answer" },
  },
  submit_attempt: {
    executor: "ramping-arrival-rate",
    exec: "submitAttempt",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 400,
    maxVUs: 4000,
    stages: rampingStages(BASELINE.submit, PEAK.submit),
    tags: { sumaek_path: "submit_attempt" },
  },
};

const readScenarios = {
  read_today: {
    executor: "ramping-arrival-rate",
    exec: "readToday",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 50,
    maxVUs: 500,
    stages: rampingStages(BASELINE.start, PEAK.start),
    tags: { sumaek_path: "read_today" },
  },
};

export const options = {
  discardResponseBodies: false,
  scenarios: WRITES_ENABLED
    ? { ...readScenarios, ...writeScenarios }
    : readScenarios,
  thresholds: {
    // L-05 답안 임시 저장 p95 300ms / p99 700ms
    "sumaek_save_answer_ms": ["p(95)<300", "p(99)<700"],
    // L-02 답안 제출 접수 p95 1s / p99 2.5s
    "sumaek_submit_attempt_ms": ["p(95)<1000", "p(99)<2500"],
    // L-01 오늘 학습·운영실 p95 1.5s / p99 3s
    "sumaek_read_today_ms": ["p(95)<1500", "p(99)<3000"],
    // O-02 시험 시간대 시작·제출 99.95% — 통과 조건 "제출 유실 0건"
    "sumaek_submit_failed": ["rate<0.0005"],
    // 통과 조건 "핵심 API 오류율 < 1%"
    "http_req_failed": ["rate<0.01"],
  },
};

/* ── 공통 ─────────────────────────────────────────────────────── */

function sessionHeaders(extra) {
  const headers = { Cookie: SB_COOKIE };
  return extra ? Object.assign(headers, extra) : headers;
}

function pickFixture() {
  if (fixtures.length === 0) return null;
  // 시나리오 반복 번호로 고르게 분산한다 — 같은 응시에 몰리면 CAS 충돌만 측정된다.
  return fixtures[exec.scenario.iterationInTest % fixtures.length];
}

/**
 * Next.js 서버 액션 호출.
 * 서버 액션은 공개 REST 엔드포인트가 아니다 — 페이지 URL에 POST하면서
 * Next-Action 헤더로 어떤 액션인지 지정하고, 본문에 인자 배열을 JSON으로 싣는다.
 * 액션 ID는 빌드 산출물의 해시라 배포마다 바뀐다 (README 3장).
 */
function callServerAction(pagePath, actionId, args, tag) {
  return http.post(`${BASE_URL}${pagePath}`, JSON.stringify(args), {
    headers: sessionHeaders({
      "Next-Action": actionId,
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
    }),
    tags: { name: tag },
    redirects: 0,
  });
}

/* ── 시나리오 본문 ─────────────────────────────────────────────── */

/** 조회 경로 — 순수 HTTP라 그대로 재현된다. 세션 쿠키가 없으면 로그인으로 튕긴다. */
export function readToday() {
  const response = http.get(`${BASE_URL}/learn/today`, {
    headers: sessionHeaders(),
    tags: { name: "GET /learn/today" },
    redirects: 0,
  });
  readLatency.add(response.timings.duration);
  check(response, {
    "오늘 학습 200": (r) => r.status === 200,
    "로그인으로 튕기지 않음": (r) => r.status !== 302 && r.status !== 307,
  });
}

/** 임시 저장 — 학생이 문항을 풀며 수시로 호출한다 (L-05). */
export function saveAnswer() {
  const fixture = pickFixture();
  if (!fixture) {
    skippedWrites.add(1);
    return;
  }
  const response = callServerAction(
    `/learn/tests/${fixture.assessmentId}`,
    ACTION_SAVE,
    [
      {
        attemptId: fixture.attemptId,
        assessmentQuestionId: fixture.assessmentQuestionId,
        answer: { choiceId: fixture.choiceId ?? "1" },
        // 서버가 낮은 시퀀스 저장을 거부하므로 단조 증가시킨다 (여러 기기 충돌 감지)
        clientSequence: exec.scenario.iterationInTest + 1,
      },
    ],
    "ACTION saveAnswer",
  );
  saveLatency.add(response.timings.duration);
  check(response, {
    "임시 저장 200": (r) => r.status === 200,
    "kill switch로 막히지 않음": (r) => r.status !== 403,
  });
}

/** 확정 제출 — 유실 0건이 통과 조건이다 (O-08·29장). */
export function submitAttempt() {
  const fixture = pickFixture();
  if (!fixture) {
    skippedWrites.add(1);
    return;
  }
  const response = callServerAction(
    `/learn/tests/${fixture.assessmentId}`,
    ACTION_SUBMIT,
    [fixture.attemptId],
    "ACTION submitAttempt",
  );
  submitLatency.add(response.timings.duration);

  // 서버 액션의 redirect()는 200 + text/x-component 본문으로 돌아온다.
  // 이미 제출된 응시의 409는 멱등 재시도이므로 실패로 세지 않는다 (I-09).
  const ok = response.status === 200 || response.status === 409;
  submitFailures.add(!ok);
  check(response, {
    "제출 접수": () => ok,
    "5xx 아님": (r) => r.status < 500,
  });
}

/* ── 실행 전후 안내 ────────────────────────────────────────────── */

export function setup() {
  console.log(`대상       : ${BASE_URL}`);
  console.log(`규모 계수  : ${RPS_SCALE} (1/10 스테이징 기본값 — 결과는 ×1.3 보정 후 외삽)`);
  console.log(
    `목표 RPS   : 평시 ${scaled(BASELINE.submit + BASELINE.save)} → 피크 ${scaled(PEAK.submit + PEAK.save)}`,
  );
  console.log(`고정 데이터: ${fixtures.length}건`);
  if (!WRITES_ENABLED) {
    console.warn(
      "쓰기 시나리오를 건너뜁니다 — SB_COOKIE / NEXT_ACTION_SAVE / NEXT_ACTION_SUBMIT 중 빠진 값이 있습니다.",
    );
    console.warn("scripts/load/README.md 2·3장을 보고 값을 채우거나, Playwright 대안을 쓰세요.");
  }
  if (fixtures.length === 0 && WRITES_ENABLED) {
    console.warn("FIXTURES가 비어 있어 쓰기 요청이 전부 건너뛰어집니다.");
  }
  return {};
}

export function teardown() {
  console.log("");
  console.log("통과 판정은 k6 임계값만으로 끝나지 않습니다 (slo.md 9장):");
  console.log("  · 제출 유실 0건 — 응답 202/200 수와 attempts·responses 행 수 대조");
  console.log("  · 교차 테넌트 노출 0건 — 부하 중 RLS 테스트 동시 실행");
  console.log("  · realtime 큐가 ai 큐에 고갈되지 않음 — RB-04 4-1·4-3 쿼리");
  console.log("  · 공정 큐 작동 — 단일 조직 점유율 40% 이하");
}
