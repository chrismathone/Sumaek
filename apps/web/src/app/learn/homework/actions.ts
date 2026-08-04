"use server";

import { revalidatePath } from "next/cache";
import { getSharedSql } from "@su-maek/db";
import { completeDayPlanItem } from "@su-maek/db/domain";
import type { IsoDate } from "@su-maek/core/shared";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { markMaterialProgress } from "@/lib/domain/learning-material";
import { projectToday } from "@/lib/domain/day-plan";

/* ─────────────────────────────────────────────────────────────
 * 숙제·교재 범위 완료.
 *
 * 학생이 넘긴 항목 id를 그대로 믿지 않는다. (조직·학생·오늘·항목 키)로
 * 다시 찾아서 바꾼다 — 학생 흐름에는 실제로 스코프 없는 저장 경로가
 * 있었고(남의 응시에 답을 쓸 수 있었다), 같은 실수를 반복하지 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface HomeworkResult {
  ok: boolean;
  message: string;
}

/**
 * 교재 범위·숙제 확인 완료.
 *
 * 시스템 연습 숙제(`practice_set`)는 자료 진도와 계획 항목을 **함께**
 * 남긴다. 하나만 남기면 연습 화면과 오늘 화면이 서로 다른 사실을 말한다.
 */
export async function completeHomework(
  _prev: HomeworkResult | null,
  formData: FormData,
): Promise<HomeworkResult> {
  const learner = await getCurrentLearner();
  if (!learner) return { ok: false, message: "로그인이 필요합니다." };

  const itemKey = String(formData.get("itemKey") ?? "").trim();
  if (!itemKey) return { ok: false, message: "항목을 찾을 수 없습니다." };

  const today = todayInKst() as IsoDate;
  const sql = getSharedSql();

  /* 연습 숙제면 자료 진도도 함께 남긴다. 채점 결과는 연습 화면이 이미
   * 저장하므로 여기서는 「끝냈다」는 사실만 잇는다. */
  const materialId = String(formData.get("materialId") ?? "").trim();
  if (materialId) {
    await markMaterialProgress({
      organizationId: learner.user.organizationId,
      learnerId: learner.learnerId,
      materialId,
      status: "completed",
    });
  }

  const result = await completeDayPlanItem(sql, {
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    planDate: today,
    itemKey,
  });

  if (result.ok) {
    /* 완료 뒤 곧바로 재투영한다 — 오늘 화면의 단계 상태가 이 항목 하나
     * 때문에 뒤처지면 학생은 방금 한 일이 반영되지 않았다고 읽는다. */
    await projectToday({
      learner: {
        organizationId: learner.user.organizationId,
        learnerId: learner.learnerId,
      },
      today,
    });
    revalidatePath("/learn/homework");
    revalidatePath("/learn/today");
  }

  return { ok: result.ok, message: result.message };
}
