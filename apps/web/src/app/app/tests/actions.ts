"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import type { IsoDate } from "@su-maek/core/shared";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  generateConfirmationTest,
  generateDailyTest,
  type GenerateResult,
} from "@su-maek/db/domain";

export async function generateDailyTestAction(
  _prev: GenerateResult | null,
  formData: FormData,
): Promise<GenerateResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "tests")) {
    return {
      ok: false,
      message: "테스트를 생성할 권한이 없습니다.",
      assessmentId: null,
      questionCount: 0,
      shortfalls: [],
      assignedLearners: 0,
      deduplicated: false,
    };
  }

  const learningGroupId = String(formData.get("learningGroupId") ?? "");
  const targetDate = String(formData.get("targetDate") ?? "") as IsoDate;
  if (!learningGroupId || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return {
      ok: false,
      message: "학습 그룹과 날짜를 확인하세요.",
      assessmentId: null,
      questionCount: 0,
      shortfalls: [],
      assignedLearners: 0,
      deduplicated: false,
    };
  }

  const purpose = String(formData.get("purpose") ?? "formative");
  /* 최근 출제분 허용 — 확인테스트는 단원 전체 풀을 쓰므로 해당 없음 */
  const allowRecentlyUsed = formData.get("allowRecentlyUsed") === "on";
  const result =
    purpose === "confirmation"
      ? await generateConfirmationTest({
          organizationId: user.organizationId,
          learningGroupId,
          targetDate,
          actorUserId: user.userId,
        })
      : await generateDailyTest({
          organizationId: user.organizationId,
          learningGroupId,
          targetDate,
          actorUserId: user.userId,
          allowRecentlyUsed,
        });
  revalidatePath("/app/tests");
  return result;
}
