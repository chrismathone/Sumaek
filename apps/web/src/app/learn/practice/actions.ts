"use server";

import { revalidatePath } from "next/cache";
import { answerKey, studentAnswer } from "@su-maek/contracts";
import { gradeAnswer } from "@su-maek/core/grading";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import {
  listPracticeQuestions,
  markMaterialProgress,
} from "@/lib/domain/learning-material";

export interface PracticeResult {
  ok: boolean;
  /** 문항 키 → 정답 여부. 화면이 문항마다 표시한다 */
  graded: Record<string, boolean>;
  correct: number;
  total: number;
  message: string;
}

/* 연습문제 채점.
 *
 * 응시(attempts)를 만들지 않는다 — 연습은 평가가 아니다. 평가 사슬에 끼우면
 * "평가 1건 = 숙련도 증거 1건"(불변 조건 10)이 깨지고, 점수 이력에 연습이
 * 섞여 교사가 보는 성적이 뜻을 잃는다. 결과는 학습 자료 진도에만 남는다. */
export async function submitPracticeAction(
  _prev: PracticeResult | null,
  formData: FormData,
): Promise<PracticeResult> {
  const learner = await getCurrentLearner();
  if (!learner) {
    return { ok: false, graded: {}, correct: 0, total: 0, message: "로그인이 필요합니다." };
  }
  const materialId = String(formData.get("materialId") ?? "");
  const questions = await listPracticeQuestions({
    organizationId: learner.user.organizationId,
    materialId,
  });
  if (questions.length === 0) {
    return {
      ok: false,
      graded: {},
      correct: 0,
      total: 0,
      message: "연습문제를 불러올 수 없습니다.",
    };
  }

  const graded: Record<string, boolean> = {};
  let correct = 0;
  let gradable = 0;
  for (const q of questions) {
    const key = answerKey.safeParse(q.answerKey);
    if (!key.success) continue; // 정답 정보가 없는 문항은 채점하지 않는다
    gradable += 1;
    const raw =
      q.kind === "multiple_choice"
        ? {
            kind: "multiple_choice",
            selectedChoiceIds: [String(formData.get(`c-${q.assessmentQuestionId}`) ?? "")].filter(
              Boolean,
            ),
          }
        : {
            kind: "short_answer",
            rawText: String(formData.get(`a-${q.assessmentQuestionId}`) ?? ""),
          };
    const parsed = studentAnswer.safeParse(raw);
    if (!parsed.success) {
      graded[q.assessmentQuestionId] = false;
      continue;
    }
    const outcome = gradeAnswer(key.data, parsed.data, q.points, {
      minAutoConfidence: 0.9,
    });
    const isCorrect = outcome.verdict === "correct";
    graded[q.assessmentQuestionId] = isCorrect;
    if (isCorrect) correct += 1;
  }

  /* 진도는 **다 맞혀야** 완료가 아니다 — 연습은 틀리면서 하는 것이다.
   * 한 번 끝까지 풀면 완료로 두되, 결과를 함께 남겨 무엇을 틀렸는지 보인다. */
  await markMaterialProgress({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    materialId,
    status: "completed",
    result: { correct, total: gradable, answeredAt: new Date().toISOString() },
  });
  revalidatePath("/learn/practice");
  revalidatePath("/learn/today");

  return {
    ok: true,
    graded,
    correct,
    total: gradable,
    message:
      gradable === 0
        ? "채점할 수 있는 문항이 없었습니다. 선생님께 알려 주세요."
        : `${gradable}문항 중 ${correct}문항 맞았습니다.`,
  };
}
