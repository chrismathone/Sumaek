"use server";

import { redirect } from "next/navigation";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { saveResponse, submitAndGrade } from "@/lib/domain/attempt";

export async function saveAnswerAction(input: {
  attemptId: string;
  assessmentQuestionId: string;
  answer: unknown;
  clientSequence: number;
}): Promise<{ ok: boolean; message?: string }> {
  const learner = await getCurrentLearner();
  if (!learner) return { ok: false, message: "로그인이 필요합니다." };
  const result = await saveResponse({
    organizationId: learner.user.organizationId,
    // 폼이 아니라 **세션에서** 온 학습자여야 한다 (조작 불가)
    learnerId: learner.learnerId,
    attemptId: input.attemptId,
    assessmentQuestionId: input.assessmentQuestionId,
    answer: input.answer,
    clientSequence: input.clientSequence,
  });
  return result.message !== undefined
    ? { ok: result.ok, message: result.message }
    : { ok: result.ok };
}

export async function submitAttemptAction(
  attemptId: string,
): Promise<{ ok: boolean; message: string }> {
  const learner = await getCurrentLearner();
  if (!learner) return { ok: false, message: "로그인이 필요합니다." };
  const result = await submitAndGrade({
    organizationId: learner.user.organizationId,
    attemptId,
    learnerId: learner.learnerId,
    timezone: learner.user.timezone,
  });
  if (!result.ok) return { ok: false, message: result.message };
  redirect(`/learn/results/${attemptId}`);
}
