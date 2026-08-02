/* 저작 화면과 폼이 함께 쓰는 모양·이름.
 *
 * `"use server"` 파일에는 순수 값을 둘 수 없고, 서버 컴포넌트(page.tsx)에서
 * 타입을 끌어오면 클라이언트 폼이 서버 모듈에 매달린 것처럼 보인다.
 * 그래서 중립 파일에 둔다 (routes/shared.ts와 같은 이유). */

/** 개념 선택지 — 낼 수 있는 문항 수를 함께 들고 다닌다 */
export interface ConceptOption {
  id: string;
  name: string;
  /** 이 개념에 연결된 검수 완료·사용 권한 유효 문항 수 (연습문제 가능 여부) */
  usable_questions: number;
}

export const KIND_LABEL: Record<string, string> = {
  reading: "개념 공부",
  video: "개념 인강",
  practice: "연습문제",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  published: "게시됨",
  archived: "보관",
};
