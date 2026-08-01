"use server";

import { revalidatePath } from "next/cache";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInTimeZone } from "@/lib/format";
import { answerReview, type ReviewAnswerResult } from "@/lib/domain/review";

export async function answerReviewAction(
  _prev: ReviewAnswerResult | null,
  formData: FormData,
): Promise<ReviewAnswerResult> {
  const learner = await getCurrentLearner();
  if (!learner) {
    return {
      ok: false,
      correct: false,
      message: "로그인이 필요합니다.",
      remaining: 0,
    };
  }
  const reviewItemId = String(formData.get("reviewItemId") ?? "");
  const kind = String(formData.get("kind") ?? "short_answer");
  const raw = String(formData.get("answer") ?? "");
  const choiceId = String(formData.get("choiceId") ?? "");

  const answer =
    kind === "multiple_choice"
      ? { kind: "multiple_choice", selectedChoiceIds: choiceId ? [choiceId] : [] }
      : { kind: "short_answer", rawText: raw };

  const result = await answerReview({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    reviewItemId,
    answer,
    today: todayInTimeZone(learner.user.timezone),
  });
  revalidatePath("/learn/review");
  revalidatePath("/learn/today");
  return result;
}
