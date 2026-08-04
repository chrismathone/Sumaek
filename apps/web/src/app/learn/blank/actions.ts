"use server";

import { getCurrentLearner } from "@/lib/auth/current-learner";
import {
  submitBlankAnswers,
  type BlankGradeResult,
} from "@/lib/domain/concept-blank";

/* 빈칸 제출 — 입력칸은 본문 HTML 안에 `b-{자리}`라는 이름으로 심겨 있고
 * (ReadingBody), 3단계는 하나의 textarea다. 제어 컴포넌트로 만들지 않았기
 * 때문에 FormData가 곧 답안이다.
 *
 * revalidatePath를 부르지 않는다 — 채점 결과는 이 액션의 반환값으로 그 자리에
 * 그린다. 다시 그리면 학생이 쓴 답이 지워진다. */
export async function submitBlankAction(
  _prev: BlankGradeResult | null,
  formData: FormData,
): Promise<BlankGradeResult> {
  const empty = { graded: {}, found: [], missing: [], correct: 0, total: 0 };
  const learner = await getCurrentLearner();
  if (!learner) {
    return { ok: false, message: "로그인이 필요합니다.", completed: false, ...empty };
  }

  const answers: Record<number, string> = {};
  for (const [key, value] of formData.entries()) {
    const m = /^b-(\d+)$/.exec(key);
    if (m && typeof value === "string") answers[Number(m[1])] = value;
  }

  const result = await submitBlankAnswers({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    blankSetId: String(formData.get("setId") ?? ""),
    answers,
    essay: String(formData.get("essay") ?? ""),
  });
  /* 쓴 답을 돌려준다 — 채점 뒤 폼이 다시 그려지면서 입력칸이 비기 때문이다.
   * 본문은 서버가 그린 HTML이라 defaultValue를 걸 자리가 없고, 답이 사라지면
   * 학생은 틀린 한 칸을 고치려고 전부 다시 써야 한다. */
  return { ...result, submitted: answers };
}
