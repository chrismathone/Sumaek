"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { issueOperatorAccess, revokeOperatorAccess } from "@su-maek/db/domain";
import { getCurrentUser } from "@/lib/auth/current-user";

/* ─────────────────────────────────────────────────────────────
 * break-glass 발급·회수 (인수 28).
 *
 * 게이트는 canWrite(settings) — 기본 매트릭스에서 settings에 full을 가진 역할은
 * owner뿐이므로 승인자는 워크스페이스 소유자다. 운영자 자신은 매트릭스의
 * operator 열에 full·scoped가 하나도 없어 이 액션을 통과할 수 없다(자기 승인
 * 연장 금지). 승인·회수 기록과 소유자 고지는 도메인 트랜잭션이 함께 남긴다.
 * ───────────────────────────────────────────────────────────── */

export interface ActionResult {
  ok: boolean;
  message: string;
}

const issueSchema = z.object({
  operatorUserId: z.uuid("운영자 계정 ID를 확인하세요."),
  reason: z.string(),
  /** 필요 시간(분). 절대 시각 계산은 DB 시계로 도메인이 한다 —
   *  화면에서 지역 시각 문자열을 받으면 시간대를 잃고 만료가 밀린다 */
  durationMinutes: z.coerce.number().int().positive(),
});

export async function grantOperatorAccess(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "settings")) {
    return { ok: false, message: "운영자 접근을 승인할 권한이 없습니다." };
  }
  const parsed = issueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }

  const result = await issueOperatorAccess({
    organizationId: user.organizationId,
    operatorUserId: parsed.data.operatorUserId,
    reason: parsed.data.reason,
    approvedByUserId: user.userId,
    durationMinutes: parsed.data.durationMinutes,
  });
  if (result.ok) revalidatePath("/app/settings/operator-access");
  return { ok: result.ok, message: result.message };
}

const revokeSchema = z.object({ grantId: z.uuid() });

export async function revokeOperatorAccessAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "settings")) {
    return { ok: false, message: "운영자 접근을 회수할 권한이 없습니다." };
  }
  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상 승인이 올바르지 않습니다." };

  const result = await revokeOperatorAccess({
    organizationId: user.organizationId,
    grantId: parsed.data.grantId,
    actorUserId: user.userId,
  });
  if (result.ok) revalidatePath("/app/settings/operator-access");
  return { ok: result.ok, message: result.message };
}
