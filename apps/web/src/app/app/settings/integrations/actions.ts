"use server";

import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import { todayInKst } from "@/lib/format";
import {
  NEIS_ALLOWED_FIELDS,
  classifyScheduleEvent,
  fetchSchoolSchedule,
  mergeConsecutiveDates,
  searchSchools,
  type NeisSchool,
} from "@/lib/integrations/neis";
import { fetchPublicHolidays } from "@/lib/integrations/kasi";

/* ─────────────────────────────────────────────────────────────
 * 외부 명단 연동 액션 (1A장 연동 경계 · 인수 61).
 *
 * 설계: 전체 학교를 내려받지 않는다.
 * - 공휴일(실제 쉬는 날만): 전국 공통 — 특일 API를 연도당 1회
 * - 학사일정: 학원이 연결한 학교만, 오늘~과정 기간 종료일만, 요청 시에만.
 *   가져오는 것은 시험 기간(school_exam)뿐 — 학교 휴업일·방학은
 *   학원 수업일이므로 버리고, 공휴일은 특일 API가 담당하므로 버린다.
 * ───────────────────────────────────────────────────────────── */

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface SchoolSearchResult extends ActionResult {
  schools: NeisSchool[];
}

function deny(): ActionResult {
  return { ok: false, message: "연동을 변경할 권한이 없습니다." };
}

/** 과정 기간 종료일(가장 늦은 활성 기간) — 없으면 오늘+180일 */
async function horizonEnd(organizationId: string, today: string): Promise<string> {
  const sql = getSharedSql();
  const [row] = await sql<{ ends_on: string | null }[]>`
    select max(ends_on)::text as ends_on from course_periods
    where organization_id = ${organizationId} and status = 'active'
  `;
  if (row?.ends_on && row.ends_on > today) return row.ends_on;
  const d = new Date(`${today}T00:00:00Z`);
  return new Date(d.getTime() + 180 * 86_400_000).toISOString().slice(0, 10);
}

/* ── 공휴일 동기화 (전국 1회) ── */

export async function syncPublicHolidays(
  _prev: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "integrations")) return deny();

  const sql = getSharedSql();
  const today = todayInKst();
  const end = await horizonEnd(user.organizationId, today);
  const years = [...new Set([Number(today.slice(0, 4)), Number(end.slice(0, 4))])];

  let inserted = 0;
  let skipped = 0;
  for (const year of years) {
    const result = await fetchPublicHolidays(year);
    if (!result.ok) return { ok: false, message: result.message };
    for (const holiday of result.holidays) {
      const [existing] = await sql<{ id: string }[]>`
        select id from holidays
        where organization_id = ${user.organizationId}
          and starts_on = ${holiday.date}
          and learning_group_id is null
          and kind = 'national'
        limit 1
      `;
      if (existing) {
        skipped++;
        continue;
      }
      await sql`
        insert into holidays (id, organization_id, kind, name, starts_on, ends_on)
        values (${uuidv7()}, ${user.organizationId}, 'national',
                ${holiday.name}, ${holiday.date}, ${holiday.date})
      `;
      inserted++;
    }
  }

  await sql`
    insert into audit_events (
      id, organization_id, actor_type, actor_id, action, target_type, target_id, after
    ) values (
      ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
      'integration.sync-holidays', 'organization', ${user.organizationId},
      ${sql.json({ years, inserted, skipped } as never)}
    )
  `;
  revalidatePath("/app/settings/integrations");
  revalidatePath("/app/calendar");
  return {
    ok: true,
    message: `공휴일 동기화 완료 — ${years.join("·")}년, 새로 ${inserted}건 · 이미 있음 ${skipped}건. 다음 일정 재계산부터 반영됩니다.`,
  };
}

/* ── NEIS 학교 검색·연결 ── */

const searchSchema = z.object({
  schoolName: z.string().trim().min(2, "학교 이름을 두 글자 이상 입력하세요."),
});

export async function searchNeisSchools(
  _prev: SchoolSearchResult | null,
  formData: FormData,
): Promise<SchoolSearchResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "integrations")) {
    return { ...deny(), schools: [] };
  }
  const parsed = searchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "입력을 확인하세요.",
      schools: [],
    };
  }
  const result = await searchSchools(parsed.data.schoolName);
  if (!result.ok) return { ok: false, message: result.message, schools: [] };
  const schools = result.rows.slice(0, 10);
  return {
    ok: true,
    message:
      result.totalCount === 0
        ? "검색 결과가 없습니다. 정식 학교명으로 다시 시도하세요."
        : `${result.totalCount}곳 중 ${schools.length}곳 표시${result.sampleOnly ? " (인증키 없음 — 샘플 5건 제한)" : ""}`,
    schools,
  };
}

const connectSchema = z.object({
  officeCode: z.string().min(1),
  officeName: z.string().min(1),
  schoolCode: z.string().min(1),
  schoolName: z.string().min(1),
  schoolKind: z.string().default(""),
});

export async function connectNeisSchool(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "integrations")) return deny();
  const parsed = connectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "학교 정보가 올바르지 않습니다." };

  const sql = getSharedSql();
  const [existing] = await sql<{ id: string }[]>`
    select id from integration_connections
    where organization_id = ${user.organizationId}
      and status <> 'disconnected'
      and config->>'provider' = 'neis'
      and config->>'schoolCode' = ${parsed.data.schoolCode}
    limit 1
  `;
  if (existing) return { ok: false, message: "이미 연결된 학교입니다." };

  const connectionId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into integration_connections (
        id, organization_id, kind, name, status, config, allowed_fields
      ) values (
        ${connectionId}, ${user.organizationId}, 'sis',
        ${`NEIS · ${parsed.data.schoolName}`}, 'connected',
        ${tx.json({
          provider: "neis",
          officeCode: parsed.data.officeCode,
          officeName: parsed.data.officeName,
          schoolCode: parsed.data.schoolCode,
          schoolName: parsed.data.schoolName,
          schoolKind: parsed.data.schoolKind,
        } as never)},
        ${tx.json([...NEIS_ALLOWED_FIELDS] as never)}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'integration.connect', 'integration_connection', ${connectionId},
        ${tx.json({ provider: "neis", school: parsed.data.schoolName } as never)}
      )
    `;
  });
  revalidatePath("/app/settings/integrations");
  return {
    ok: true,
    message: `"${parsed.data.schoolName}"을 연결했습니다. 학사일정 동기화로 시험 기간을 가져오세요.`,
  };
}

/* ── 학사일정 동기화 (연결된 학교만·시험 기간만) ── */

const syncSchema = z.object({
  connectionId: z.uuid(),
  learningGroupId: z.string().default(""), // "" = 전체 반
});

export async function syncSchoolSchedule(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "integrations")) return deny();
  const parsed = syncSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상 연결이 지정되지 않았습니다." };
  const learningGroupId = parsed.data.learningGroupId || null;

  const sql = getSharedSql();
  const [connection] = await sql<
    { id: string; config: { officeCode?: string; schoolCode?: string; schoolName?: string } }[]
  >`
    select id, config from integration_connections
    where id = ${parsed.data.connectionId}
      and organization_id = ${user.organizationId}
      and status = 'connected' and config->>'provider' = 'neis'
  `;
  if (!connection?.config.officeCode || !connection.config.schoolCode) {
    return { ok: false, message: "연결을 찾을 수 없습니다." };
  }
  if (learningGroupId) {
    const [group] = await sql<{ id: string }[]>`
      select id from learning_groups
      where id = ${learningGroupId} and organization_id = ${user.organizationId}
    `;
    if (!group) return { ok: false, message: "선택한 반을 찾을 수 없습니다." };
  }

  const today = todayInKst();
  const end = await horizonEnd(user.organizationId, today);
  const schoolName = connection.config.schoolName ?? "학교";

  const fetched = await fetchSchoolSchedule({
    officeCode: connection.config.officeCode,
    schoolCode: connection.config.schoolCode,
    fromYmd: today.replaceAll("-", ""),
    toYmd: end.replaceAll("-", ""),
  });

  const upsertCursor = async (status: string, error: string | null) => {
    await sql`
      insert into integration_sync_cursors (
        id, organization_id, connection_id, resource, cursor,
        last_status, last_error, last_synced_at
      ) values (
        ${uuidv7()}, ${user.organizationId}, ${connection.id}, 'school_schedule',
        ${`${today}..${end}`}, ${status}, ${error}, now()
      )
      on conflict (connection_id, resource) do update
      set cursor = excluded.cursor, last_status = excluded.last_status,
          last_error = excluded.last_error, last_synced_at = excluded.last_synced_at,
          updated_at = now()
    `;
  };

  if (!fetched.ok) {
    await upsertCursor("error", fetched.message);
    revalidatePath("/app/settings/integrations");
    return { ok: false, message: fetched.message };
  }

  /* 시험 기간만 취해 연속 일자를 기간으로 합친다 */
  const examEvents = fetched.rows
    .filter((event) => classifyScheduleEvent(event) === "school_exam")
    .map((event) => ({ date: event.date, name: event.eventName }));
  const ranges = mergeConsecutiveDates(examEvents);

  let inserted = 0;
  let skipped = 0;
  for (const range of ranges) {
    const name = `${range.name} (${schoolName})`;
    const [existing] = await sql<{ id: string }[]>`
      select id from holidays
      where organization_id = ${user.organizationId}
        and name = ${name} and starts_on = ${range.startsOn}
        and learning_group_id is not distinct from ${learningGroupId}
      limit 1
    `;
    if (existing) {
      skipped++;
      continue;
    }
    await sql`
      insert into holidays (
        id, organization_id, kind, name, starts_on, ends_on, learning_group_id
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'school_exam', ${name},
        ${range.startsOn}, ${range.endsOn}, ${learningGroupId}
      )
    `;
    inserted++;
  }

  await upsertCursor("ok", null);
  await sql`
    insert into audit_events (
      id, organization_id, actor_type, actor_id, action, target_type, target_id, after
    ) values (
      ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
      'integration.sync-schedule', 'integration_connection', ${connection.id},
      ${sql.json({
        school: schoolName,
        range: `${today}..${end}`,
        fetched: fetched.totalCount,
        examRanges: ranges.length,
        inserted,
        skipped,
        scope: learningGroupId ?? "all",
      } as never)}
    )
  `;
  revalidatePath("/app/settings/integrations");
  revalidatePath("/app/calendar");

  const sampleWarning = fetched.sampleOnly
    ? " ⚠ 인증키가 없어 5건 샘플만 조회됨 — NEIS_API_KEY를 채우세요."
    : "";
  return {
    ok: true,
    message: `학사일정 ${fetched.totalCount}건 조회 — 시험 기간 ${ranges.length}건 중 새로 ${inserted}건, 이미 있음 ${skipped}건. 휴업일·방학은 학원 수업일이라 가져오지 않습니다.${sampleWarning}`,
  };
}

/* ── 연결 해제 ── */

const disconnectSchema = z.object({ connectionId: z.uuid() });

export async function disconnectConnection(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "integrations")) return deny();
  const parsed = disconnectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상 연결이 지정되지 않았습니다." };

  const sql = getSharedSql();
  const updated = await sql`
    update integration_connections
    set status = 'disconnected', updated_at = now()
    where id = ${parsed.data.connectionId}
      and organization_id = ${user.organizationId}
      and status <> 'disconnected'
  `;
  if (updated.count === 0) return { ok: false, message: "연결을 찾을 수 없습니다." };

  await sql`
    insert into audit_events (
      id, organization_id, actor_type, actor_id, action, target_type, target_id
    ) values (
      ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
      'integration.disconnect', 'integration_connection', ${parsed.data.connectionId}
    )
  `;
  revalidatePath("/app/settings/integrations");
  return {
    ok: true,
    message: "연결을 해제했습니다. 이미 가져온 시험 기간 휴일은 그대로 남습니다.",
  };
}
