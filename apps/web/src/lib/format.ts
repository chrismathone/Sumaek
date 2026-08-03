import { KST } from "@su-maek/core/shared";

/* 오늘 날짜는 core가 갖는다 — 워커도 같은 함수를 쓴다. 화면 쪽 호출부가
 * 서식 헬퍼와 같은 자리에서 가져오도록 여기서 다시 내보낸다. */
export { todayInKst } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 조회 화면 공용 서식 헬퍼.
 *
 * 시각은 **언제나 KST**로 표시한다 (불변 조건 14 — UTC 저장 + 표시는 KST).
 * 시간대를 인자로 받지 않는 이유는 core/shared/dates.ts의 KST 주석에 있다:
 * 고를 수 없게 만들면 잘못 넘길 수도 없다. 서버 컴포넌트에서만 쓰이므로
 * 클라이언트 로캘에도 의존하지 않는다.
 * ───────────────────────────────────────────────────────────── */

/** 24시간 표기 시:분 (KST) */
export function formatTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: KST,
  });
}

/** YYYY-MM-DD (숫자 표기 — font-mono와 함께 쓴다) */
export function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: KST,
  });
}

/** YYYY-MM-DD HH:MM (KST) */
export function formatDateTime(value: Date | string): string {
  return `${formatDate(value)} ${formatTime(value)}`;
}

/** "2026-07-31" → "7월 31일" (달력·일정 목록용) */
export function formatIsoDay(iso: string): string {
  const [, month, day] = iso.split("-");
  if (!month || !day) return iso;
  return `${Number(month)}월 ${Number(day)}일`;
}

/**
 * 점수는 정수부만 보여준다 — 소수점은 버린다 ("40.00" → "40", "9.9" → "9").
 * 반올림이 아니라 내림이다: 39.9점을 40점으로 보여주면 학생·학부모에게
 * 실제보다 높은 점수를 알리는 셈이 된다.
 */
export function trimScore(value: string | null): string {
  if (value === null) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return String(Math.floor(n));
}

/** 0~1 점 추정치를 백분율 문자열로 ("0.725" → "73%") */
export function formatRatio(value: string | null): string {
  if (value === null) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

export const SESSION_STATUS_LABEL: Record<string, string> = {
  planned: "예정",
  confirmed: "확정",
  in_progress: "진행 중",
  completed: "완료",
  cancelled: "취소",
  makeup_planned: "보강 계획",
};

export const ASSESSMENT_STATUS_LABEL: Record<string, string> = {
  generating: "생성 중",
  draft: "초안",
  ready: "준비 완료",
  review_required: "검토 필요",
  published: "게시됨",
  open: "응시 중",
  closed: "마감",
  grading: "채점 중",
  finalized: "완료",
  cancelled: "취소",
};

export const ATTEMPT_STATUS_LABEL: Record<string, string> = {
  not_started: "미응시",
  in_progress: "응시 중",
  submitted: "제출됨",
  auto_graded: "자동 채점 완료",
  review_required: "선생님 확인 필요",
  finalized: "확정",
  invalidated: "무효",
};

/** 개념 숙련도 상태 (20장) — 6개 상태의 공식 한국어 라벨 */
export const MASTERY_STATE_LABEL: Record<string, string> = {
  no_evidence: "근거 없음",
  exploring: "탐색 중",
  partial: "부분 이해",
  stable: "안정적 수행",
  transfer_confirmed: "전이 확인",
  recheck_needed: "재점검 필요",
};

/** 상태 표시 순서 — 목록·집계 화면에서 항상 같은 순서를 쓴다 */
export const MASTERY_STATES = [
  "recheck_needed",
  "exploring",
  "partial",
  "stable",
  "transfer_confirmed",
  "no_evidence",
] as const;

/** 손봐야 할 상태 — "취약"의 정의를 한 곳에서만 둔다 */
export const WEAK_MASTERY_STATES = ["exploring", "partial", "recheck_needed"] as const;

export const HOLIDAY_KIND_LABEL: Record<string, string> = {
  national: "공휴일",
  academy: "휴강일",
  school_exam: "학교 시험",
  vacation: "방학",
};

export const GRADING_EXCEPTION_KIND_LABEL: Record<string, string> = {
  low_confidence_ocr: "인식 신뢰도 부족",
  multiple_valid_answers: "복수 정답 가능",
  format_mismatch: "정답 형식 불일치",
  essay_partial: "서술형 부분 점수",
  answer_explanation_conflict: "답안·해설 충돌",
  question_error_suspected: "문항 오류 의심",
  scan_missing: "스캔 누락",
  identity_unresolved: "학생 식별 미해결",
  resubmission_required: "재제출 필요",
  regrade_required: "재채점 필요",
};

export const PROPOSAL_TRIGGER_LABEL: Record<string, string> = {
  absence: "학습 불참",
  cancellation: "휴강",
  partial_completion: "부분 진행",
  test_failure: "확인테스트 미통과",
  manual: "수동 요청",
  route_published: "루트 게시",
};

export const NOTIFICATION_KIND_LABEL: Record<string, string> = {
  today_task: "오늘 할 일",
  route_approval: "루트 승인",
  schedule_conflict: "일정 충돌",
  test_generation_failed: "테스트 생성 실패",
  grading_exception: "채점 예외",
  learner_risk: "학습 경고",
  content_review: "콘텐츠 검수",
  import_error: "가져오기 오류",
  system_notice: "시스템 공지",
};

/** 라벨 맵에 없는 값은 원본을 그대로 보여준다 — 임의로 감추지 않는다 */
export function label(map: Record<string, string>, key: string | null): string {
  if (!key) return "—";
  return map[key] ?? key;
}
