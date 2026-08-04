"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import type { IsoDate } from "@su-maek/core/shared";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSharedSql } from "@su-maek/db";
import {
  generateConfirmationTest,
  generateDailyTest,
  retryAssessmentGeneration,
  type GenerateResult,
  type RetryGenerationResult,
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

/**
 * 실패한 자동 생성의 수동 재실행 (T3.4).
 *
 * 여기서 곧바로 `generateDailyTest`를 부르지 **않는다.** 그렇게 하면 화면은
 * 성공하는데 큐의 작업은 `failed_final`로 남아, 그 반·날짜의 멱등 키가
 * 영원히 잠긴 채 자동 경로가 다시는 돌지 않는다. 같은 작업 행을 되살려야
 * 자동화가 원래대로 돌아온다 — 그리고 그것이 「수동 재실행도 동일 멱등 키를
 * 쓴다」의 실제 의미다.
 */
export async function retryAssessmentGenerationAction(
  _prev: RetryGenerationResult | null,
  formData: FormData,
): Promise<RetryGenerationResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "tests")) {
    return { ok: false, message: "테스트를 재실행할 권한이 없습니다." };
  }
  const jobId = String(formData.get("jobId") ?? "");
  if (!/^[0-9a-fA-F-]{36}$/.test(jobId)) {
    return { ok: false, message: "재실행할 작업을 찾을 수 없습니다." };
  }

  const result = await retryAssessmentGeneration(getSharedSql(), {
    organizationId: user.organizationId,
    jobId,
    actorUserId: user.userId,
  });
  revalidatePath("/app/tests");
  return result;
}
