"use server";

import { revalidatePath } from "next/cache";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import {
  markMaterialProgress,
  recordVideoWatch,
} from "@/lib/domain/learning-material";

export interface MaterialActionResult {
  ok: boolean;
  message: string;
}

export interface WatchProgressResult {
  ok: boolean;
  percent: number;
  completed: boolean;
}

/* 인강 시청 진도 — 플레이어가 재생 중에 주기적으로 부른다.
 *
 * **revalidatePath를 부르지 않는다.** 재생 중 몇 초마다 오는 호출이 매번
 * 서버 컴포넌트를 다시 그리면 영상이 있는 화면이 통째로 새로 렌더된다 —
 * 보고 있는 영상이 끊긴다. 화면의 잠금 해제는 클라이언트 상태로 처리하고
 * (LectureGate), 서버 화면은 다음 이동 때 자연히 새 진도를 읽는다. */
export async function recordWatchProgressAction(input: {
  materialId: string;
  seconds: number;
  percent: number;
}): Promise<WatchProgressResult> {
  const learner = await getCurrentLearner();
  if (!learner) return { ok: false, percent: 0, completed: false };
  return recordVideoWatch({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    materialId: input.materialId,
    seconds: input.seconds,
    percent: input.percent,
  });
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
