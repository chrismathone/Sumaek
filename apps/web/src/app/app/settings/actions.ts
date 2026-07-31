"use server";

import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";

/* 워크스페이스 등록 흐름 (7장 온보딩의 핵심 3단계) —
 * 과정 기간 → 반(수업 요일·시간) → 학습자. 시드 없이 자립 가능하게 한다. */

export interface ActionResult {
  ok: boolean;
  message: string;
}

const periodSchema = z.object({
  name: z.string().min(1, "기간 이름을 입력하세요."),
  academicYear: z.coerce.number().int().min(2020).max(2100),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "시작일을 선택하세요."),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "종료일을 선택하세요."),
});

export async function createCoursePeriod(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "settings")) {
    return { ok: false, message: "설정 변경 권한이 없습니다." };
  }
  const parsed = periodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  if (parsed.data.endsOn <= parsed.data.startsOn) {
    return { ok: false, message: "종료일은 시작일 이후여야 합니다." };
  }
  const sql = getSharedSql();
  const id = uuidv7();
  await sql`
    insert into course_periods (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${id}, ${user.organizationId}, ${parsed.data.name},
            ${parsed.data.academicYear}, ${parsed.data.startsOn}, ${parsed.data.endsOn}, 'active')
  `;
  await audit(user.organizationId, user.userId, "settings.create-period", "course_period", id, parsed.data.name);
  revalidatePath("/app/settings");
  return { ok: true, message: `과정 기간 "${parsed.data.name}"을 만들었습니다.` };
}

const groupSchema = z.object({
  name: z.string().min(1, "반 이름을 입력하세요."),
  coursePeriodId: z.uuid("과정 기간을 선택하세요."),
  courseName: z.string().default(""),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "시작 시각을 선택하세요."),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "종료 시각을 선택하세요."),
});

export async function createLearningGroup(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "groups")) {
    return { ok: false, message: "반을 만들 권한이 없습니다." };
  }
  const weekdays = formData
    .getAll("weekdays")
    .map(Number)
    .filter((d) => d >= 0 && d <= 6);
  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  if (weekdays.length === 0) {
    return { ok: false, message: "수업 요일을 하나 이상 선택하세요." };
  }
  if (parsed.data.endTime <= parsed.data.startTime) {
    return { ok: false, message: "종료 시각은 시작 시각 이후여야 합니다." };
  }
  const sql = getSharedSql();
  const [period] = await sql<{ starts_on: string }[]>`
    select starts_on::text from course_periods
    where id = ${parsed.data.coursePeriodId} and organization_id = ${user.organizationId}
  `;
  if (!period) return { ok: false, message: "선택한 과정 기간을 찾을 수 없습니다." };

  const groupId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into learning_groups (
        id, organization_id, course_period_id, name, course_name,
        home_teacher_user_id, status
      ) values (
        ${groupId}, ${user.organizationId}, ${parsed.data.coursePeriodId},
        ${parsed.data.name}, ${parsed.data.courseName || null},
        ${user.userId}, 'operating'
      )
    `;
    for (const weekday of weekdays) {
      await tx`
        insert into calendar_rules (
          id, organization_id, subject_type, subject_id, weekday,
          start_time, end_time, effective_from
        ) values (
          ${uuidv7()}, ${user.organizationId}, 'learning_group', ${groupId},
          ${weekday}, ${parsed.data.startTime}, ${parsed.data.endTime},
          ${period.starts_on}
        )
      `;
    }
  });
  await audit(user.organizationId, user.userId, "settings.create-group", "learning_group", groupId, parsed.data.name);
  revalidatePath("/app/settings");
  revalidatePath("/app/classes");
  return {
    ok: true,
    message: `반 "${parsed.data.name}"을 만들었습니다 (주 ${weekdays.length}회 수업).`,
  };
}

const learnerSchema = z.object({
  displayName: z.string().min(1, "학습자 이름을 입력하세요."),
  gradeLevel: z.string().default(""),
  learningGroupId: z.uuid("소속 반을 선택하세요."),
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "합류일을 선택하세요."),
});

export async function addLearner(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "learners")) {
    return { ok: false, message: "학습자를 등록할 권한이 없습니다." };
  }
  const parsed = learnerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const sql = getSharedSql();
  const [group] = await sql<{ id: string }[]>`
    select id from learning_groups
    where id = ${parsed.data.learningGroupId} and organization_id = ${user.organizationId}
  `;
  if (!group) return { ok: false, message: "선택한 반을 찾을 수 없습니다." };

  const learnerId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into learners (id, organization_id, display_name, grade_level, status)
      values (${learnerId}, ${user.organizationId}, ${parsed.data.displayName},
              ${parsed.data.gradeLevel || null}, 'active')
    `;
    await tx`
      insert into learning_group_memberships (
        id, organization_id, learning_group_id, learner_id, joined_on, status
      ) values (
        ${uuidv7()}, ${user.organizationId}, ${parsed.data.learningGroupId},
        ${learnerId}, ${parsed.data.joinedOn}, 'active'
      )
    `;
  });
  await audit(user.organizationId, user.userId, "settings.add-learner", "learner", learnerId, parsed.data.displayName);
  revalidatePath("/app/students");
  revalidatePath("/app/classes");
  return { ok: true, message: `학습자 "${parsed.data.displayName}"을 등록했습니다.` };
}

const KILL_SWITCH_KEYS = [
  "auto_reschedule",
  "auto_publish_questions",
  "auto_grading",
  "curriculum_release",
  "formula_autofix",
  "document_export",
  "external_notifications",
] as const;

const killSwitchSchema = z.object({
  key: z.enum(KILL_SWITCH_KEYS),
  action: z.enum(["disable", "enable"]),
  reason: z.string().default(""),
});

/**
 * 조직 스코프 kill switch 전환 (28장·인수 40) — 자동화만 멈추고 수동
 * 운영·확정 데이터 열람은 계속 가능하다. 전역 스위치는 운영 CLI
 * (`pnpm kill-switch`)의 몫이다.
 */
export async function toggleKillSwitch(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "settings")) {
    return { ok: false, message: "kill switch를 변경할 권한이 없습니다." };
  }
  const parsed = killSwitchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "대상 스위치가 올바르지 않습니다." };
  }
  const { key, action } = parsed.data;
  const reason = parsed.data.reason.trim();
  if (action === "disable" && !reason) {
    return { ok: false, message: "중지 사유를 입력하세요 (감사 기록에 남습니다)." };
  }

  const sql = getSharedSql();
  const enabled = action === "enable";
  await sql.begin(async (tx) => {
    const [existing] = await tx<{ id: string }[]>`
      select id from kill_switches
      where organization_id = ${user.organizationId} and key = ${key}
    `;
    if (existing) {
      await tx`
        update kill_switches
        set enabled = ${enabled}, reason = ${reason || null},
            changed_by = ${user.userId}, updated_at = now()
        where id = ${existing.id}
      `;
    } else {
      await tx`
        insert into kill_switches (id, organization_id, key, enabled, reason, changed_by)
        values (${uuidv7()}, ${user.organizationId}, ${key}, ${enabled},
                ${reason || null}, ${user.userId})
      `;
    }
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'settings.kill-switch', 'kill_switch', ${existing?.id ?? null},
        ${reason || null},
        ${tx.json({ key, enabled } as never)}
      )
    `;
  });

  revalidatePath("/app/settings");
  return {
    ok: true,
    message: enabled
      ? `"${key}" 자동화를 재개했습니다.`
      : `"${key}" 자동화를 중지했습니다. 수동 운영은 계속 가능합니다.`,
  };
}

async function audit(
  organizationId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  name: string,
): Promise<void> {
  const sql = getSharedSql();
  await sql`
    insert into audit_events (
      id, organization_id, actor_type, actor_id, action, target_type, target_id, after
    ) values (
      ${uuidv7()}, ${organizationId}, 'user', ${actorId}, ${action},
      ${targetType}, ${targetId}, ${sql.json({ name } as never)}
    )
  `;
}
