"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import type { IsoDate } from "@su-maek/core/shared";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  materializeGroupSchedule,
  type MaterializeResult,
} from "@/lib/domain/schedule";

export async function materializeSchedule(
  _prev: MaterializeResult | null,
  formData: FormData,
): Promise<MaterializeResult> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      message: "로그인이 필요합니다.",
      createdSessions: 0,
      preservedSessions: 0,
      conflicts: 0,
      firstDate: null,
      lastDate: null,
    };
  }
  // 쓰기 게이트 — 읽기 게이트를 쓰면 readonly 역할이 샌다 (eywa)
  if (!canWrite(DEFAULT_MATRIX, user.role, "routes")) {
    return {
      ok: false,
      message: "학습 루트를 변경할 권한이 없습니다.",
      createdSessions: 0,
      preservedSessions: 0,
      conflicts: 0,
      firstDate: null,
      lastDate: null,
    };
  }

  const learningGroupId = String(formData.get("learningGroupId") ?? "");
  if (!learningGroupId) {
    return {
      ok: false,
      message: "대상 학습 그룹이 지정되지 않았습니다.",
      createdSessions: 0,
      preservedSessions: 0,
      conflicts: 0,
      firstDate: null,
      lastDate: null,
    };
  }

  const today = new Date()
    .toLocaleDateString("en-CA", { timeZone: user.timezone }) as IsoDate;

  const result = await materializeGroupSchedule({
    organizationId: user.organizationId,
    learningGroupId,
    actorUserId: user.userId,
    timezone: user.timezone,
    today,
  });

  revalidatePath("/app/today");
  revalidatePath("/app/routes");
  return result;
}
