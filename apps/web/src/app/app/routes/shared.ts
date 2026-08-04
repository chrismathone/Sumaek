/* 루트 빌더의 서버·클라이언트 공용 상수.
 *
 * actions.ts는 "use server" 파일이라 async 함수 외에는 내보낼 수 없다.
 * 폼 필드 이름·노드 종류 표기처럼 양쪽이 같은 값을 써야 하는 것들은 여기 둔다
 * (화면과 액션이 다른 이름을 쓰면 스냅샷이 조용히 사라진다). */

/** 읽은 시점의 노드 스냅샷을 폼에 싣는 필드 이름 (인수 20 충돌 diff) */
export const BASELINE_FIELD = "baselineNodes";

export const NODE_KIND_LABEL: Record<string, string> = {
  concept_lesson: "개념 수업",
  problem_solving: "문제 풀이",
  book_range: "교재 범위",
  homework: "숙제",
  daily_test: "일일테스트",
  confirmation_test: "확인테스트",
  wrong_answer_review: "오답 복습",
  remediation: "보충",
  cumulative_review: "누적 복습",
  buffer: "버퍼",
  break: "휴강 구간",
  custom: "사용자 정의",
};

/**
 * 빌더가 내미는 노드 종류.
 *
 * DB enum(route_node_kind)은 12종이지만 여기 여덟만 둔다. 나머지 넷은
 * 일부러 뺀 것이고, 이유가 없으면 다시 새어 들어온다:
 *   remediation — 교사가 직접 만들지 않는다. 확인테스트 미통과가 학생
 *                 오버라이드로 끼워 넣는다 (시퀀스 S-6).
 *   break       — 휴강은 노드가 아니라 달력(holidays)이 표현한다.
 *   custom      — 무엇을 하는 노드인지 아무도 모르는 노드를 만들 수 있게
 *                 하면 실행기(T2.2)가 그것을 차단으로 낼 수밖에 없다.
 *   problem_solving은 남긴다 — 개념 수업과 다른 실제 차시 종류다.
 *
 * `daily_test`는 예전에 빠져 있었다. DB enum에는 있는데 폼에 없어서
 * 도달 자체가 불가능했고, 자동 평가 생성(M3)의 출발점이 그 노드다.
 */
export const NODE_KINDS = [
  "concept_lesson",
  "problem_solving",
  "book_range",
  "homework",
  "daily_test",
  "confirmation_test",
  "wrong_answer_review",
  "cumulative_review",
  "buffer",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const nodeKindLabel = (kind: string): string =>
  NODE_KIND_LABEL[kind] ?? kind;

export const PLAN_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  validating: "검증 중",
  needs_fix: "수정 필요",
  publishable: "게시 가능",
  published: "게시됨",
  superseded: "대체됨",
  archived: "보관",
};
