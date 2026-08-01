"use server";

import { revalidatePath } from "next/cache";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { markMaterialProgress } from "@/lib/domain/learning-material";

export interface MaterialActionResult {
  ok: boolean;
  message: string;
}

export async function completeMaterialAction(
  _prev: MaterialActionResult | null,
  formData: FormData,
): Promise<MaterialActionResult> {
  const learner = await getCurrentLearner();
  if (!learner) return { ok: false, message: "로그인이 필요합니다." };

  const materialId = String(formData.get("materialId") ?? "");
  const status = formData.get("status") === "in_progress" ? "in_progress" : "completed";
  const result = await markMaterialProgress({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    materialId,
    status,
  });
  // 오늘 학습의 단계 상태가 이 진도로 결정되므로 함께 새로 그린다
  revalidatePath("/learn/study");
  revalidatePath("/learn/watch");
  revalidatePath("/learn/today");
  return result;
}
