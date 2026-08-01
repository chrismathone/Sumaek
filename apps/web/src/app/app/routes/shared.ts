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
