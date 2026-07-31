"use server";

import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";

/* 불참·휴강 입력 (10장) — 전자출결이 아니다. 이미 확정된 사실을 수신해
 * 일정 재계산의 입력으로 만든다. 같은 트랜잭션에서 Outbox로
 * LearningAvailabilityChanged를 발행하면 워커가 재계산을 이어받는다 (2D). */

export interface ActionResult {
  ok: boolean;
  message: string;
}

const reportSchema = z.object({
  learningGroupId: z.uuid(),
  kind: z.enum(["learner_absence", "group_cancelled"]),
  learnerId: z.string().default(""),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "시작일을 선택하세요."),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "종료일을 선택하세요."),
  reason: z.string().default(""),
});

export async function reportAvailability(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "calendar")) {
    return { ok: false, message: "일정 이벤트를 입력할 권한이 없습니다." };
  }
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const { learningGroupId, kind, startsOn, endsOn, reason } = parsed.data;
  const learnerId = parsed.data.learnerId || null;
  if (endsOn < startsOn) {
    return { ok: false, message: "종료일은 시작일 이후여야 합니다." };
  }
  if (kind === "learner_absence" && !learnerId) {
    return { ok: false, message: "불참 학생을 선택하세요." };
  }

  const sql = getSharedSql();
  const [group] = await sql<{ id: string }[]>`
    select id from learning_groups
    where id = ${learningGroupId} and organization_id = ${user.organizationId}
  `;
  if (!group) return { ok: false, message: "반을 찾을 수 없습니다." };

  if (learnerId) {
    const [member] = await sql<{ id: string }[]>`
      select id from learning_group_memberships
      where organization_id = ${user.organizationId}
        and learning_group_id = ${learningGroupId}
        and learner_id = ${learnerId} and status = 'active'
    `;
    if (!member) return { ok: false, message: "이 반에 속한 학생이 아닙니다." };
  }

  const eventId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into learning_availability_events (
        id, organization_id, kind, learner_id, learning_group_id,
        starts_on, ends_on, source, reason, status
      ) values (
        ${eventId}, ${user.organizationId}, ${kind}, ${learnerId},
        ${learningGroupId}, ${startsOn}, ${endsOn}, 'manual',
        ${reason || null}, 'received'
      )
    `;
    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'availability', ${eventId}, 1,
        'LearningAvailabilityChanged', now(),
        ${tx.json({
          availabilityEventId: eventId,
          kind,
          learnerId,
          learningGroupId,
          startsOn,
          endsOn,
        } as never)}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, reason, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'schedule.report-availability', 'availability_event', ${eventId},
        ${reason || null},
        ${tx.json({ kind, startsOn, endsOn, learnerId } as never)}
      )
    `;
  });

  revalidatePath(`/app/classes/${learningGroupId}`);
  revalidatePath("/app/calendar");
  revalidatePath("/app/today");
  return {
    ok: true,
    message:
      kind === "group_cancelled"
        ? `휴강(${startsOn}~${endsOn})을 접수했습니다. 다음 일정 재계산부터 해당 날짜를 비웁니다.`
        : `불참(${startsOn}~${endsOn})을 접수했습니다. 반 공통 일정은 유지되고, 보강은 개별 경로로 계획합니다.`,
  };
}

const dismissSchema = z.object({
  eventId: z.uuid(),
  learningGroupId: z.uuid(),
});

/** 잘못 접수된 이벤트 무시 — 이미 반영된 휴강이면 재계산으로 되돌린다 */
export async function dismissAvailability(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "calendar")) {
    return { ok: false, message: "일정 이벤트를 변경할 권한이 없습니다." };
  }
  const parsed = dismissSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "대상 이벤트가 지정되지 않았습니다." };
  }
  const sql = getSharedSql();
  const [event] = await sql<
    { id: string; kind: string; starts_on: string; ends_on: string; learner_id: string | null }[]
  >`
    select id, kind, starts_on::text, ends_on::text, learner_id
    from learning_availability_events
    where id = ${parsed.data.eventId}
      and organization_id = ${user.organizationId}
      and status <> 'dismissed'
  `;
  if (!event) return { ok: false, message: "이벤트를 찾을 수 없거나 이미 무시되었습니다." };

  await sql.begin(async (tx) => {
    await tx`
      update learning_availability_events
      set status = 'dismissed', updated_at = now()
      where id = ${event.id}
    `;
    // 무시도 가용성 변화다 — 재계산이 이 이벤트 없이 다시 돌게 발행
    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'availability', ${event.id}, 2,
        'LearningAvailabilityChanged', now(),
        ${tx.json({
          availabilityEventId: event.id,
          kind: event.kind,
          learnerId: event.learner_id,
          learningGroupId: parsed.data.learningGroupId,
          startsOn: event.starts_on,
          endsOn: event.ends_on,
        } as never)}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'schedule.dismiss-availability', 'availability_event', ${event.id},
        ${tx.json({ kind: event.kind } as never)}
      )
    `;
  });

  revalidatePath(`/app/classes/${parsed.data.learningGroupId}`);
  revalidatePath("/app/calendar");
  return { ok: true, message: "이벤트를 무시했습니다. 다음 재계산부터 반영되지 않습니다." };
}
