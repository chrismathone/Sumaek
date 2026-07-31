"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveGradingException } from "@/lib/domain/attempt";

export async function resolveExceptionAction(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "grading")) {
    return { ok: false, message: "채점을 판정할 권한이 없습니다." };
  }
  const verdict = String(formData.get("verdict") ?? "");
  if (!["correct", "incorrect", "partial"].includes(verdict)) {
    return { ok: false, message: "판정 값을 확인하세요." };
  }
  const result = await resolveGradingException({
    organizationId: user.organizationId,
    exceptionId: String(formData.get("exceptionId") ?? ""),
    resolverUserId: user.userId,
    timezone: user.timezone,
    verdict: verdict as "correct" | "incorrect" | "partial",
    partialScore: Number(formData.get("partialScore") ?? 0),
    note: String(formData.get("note") ?? "") || undefined,
  } as Parameters<typeof resolveGradingException>[0]);
  revalidatePath("/app/grading");
  revalidatePath("/app/tests");
  return result;
}
