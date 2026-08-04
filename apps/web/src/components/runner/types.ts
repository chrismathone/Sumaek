import type { AnswerKey } from "@su-maek/contracts";

/** 러너에 전달되는 문항 — 서버에서 게시 모드로 사전 렌더된 HTML */
export interface RunnerQuestion {
  questionId: string;
  number: number;
  kind: "multiple_choice" | "short_answer";
  /** renderQuestionBody('publish') 결과 — katex-error·원시 LaTeX 없음이 보장됨.
   *  첫 줄이 발문, 뒤가 판별 대상이다 */
  bodyLines: string[];
  choices?: Array<{ choiceId: string; order: number; html: string }>;
  points: number;
  /** 채점 키 — 데모 체험판에서만 클라이언트로 전달된다.
   *  실제 응시에서는 서버에만 있고 제출 후 서버가 채점한다. */
  answerKey: AnswerKey;
  conceptName: string;
}
