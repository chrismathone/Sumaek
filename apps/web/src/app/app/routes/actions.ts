"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import {
  buildRouteConflict,
  decodeRouteSnapshot,
  validateRoute,
  type RouteConflict,
  type RouteEditIntent,
  type RouteNodeSnapshot,
  type RouteValidationReport,
} from "@su-maek/core/routes";
import type { GraphEdge } from "@su-maek/core/curriculum";
import type { IsoDate } from "@su-maek/core/shared";
import { getCurrentUser } from "@/lib/auth/current-user";
import { todayInTimeZone } from "@/lib/format";
import {
  materializeGroupSchedule,
  type MaterializeResult,
} from "@/lib/domain/schedule";
import { BASELINE_FIELD } from "./shared";

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

/* ─────────────────────────────────────────────────────────────
 * 루트 빌더 (13장) — 계획 생성 → 노드 편집 → 검증 → 게시.
 * 게시된 버전은 불변 — 수정은 새 버전으로만 한다 (불변 조건 2).
 * 게시는 검증 게이트(publishable)를 통과해야만 가능하다.
 * ───────────────────────────────────────────────────────────── */

export interface BuilderResult {
  ok: boolean;
  message: string;
  /** 동시 수정 충돌일 때만 채워진다 — 내 변경 vs 저장된 최신 상태 비교 (인수 20) */
  conflict?: RouteConflict;
}

function deny(): BuilderResult {
  return { ok: false, message: "학습 루트를 변경할 권한이 없습니다." };
}

/* ── 낙관적 동시성 (인수 20) — 편집 폼은 읽은 시점의 lock_version을
 * 제시하고, 불일치면 마지막 저장이 조용히 이기는 대신 명시적으로
 * 거부된다 (계약 오류 코드 VERSION_CONFLICT). ── */

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 루트를 방금 수정했습니다 (VERSION_CONFLICT). 내 변경은 아직 저장되지 않았습니다 — 아래에서 저장된 최신 상태와 비교한 뒤 결정하세요.";

async function bumpLockOrConflict(
  planId: string,
  organizationId: string,
  expected: number,
): Promise<boolean> {
  const sql = getSharedSql();
  const updated = await sql`
    update route_plans
    set lock_version = lock_version + 1, updated_at = now()
    where id = ${planId} and organization_id = ${organizationId}
      and lock_version = ${expected}
  `;
  return updated.count > 0;
}

/** 폼이 실어 온 "읽은 시점" 스냅샷 — 없거나 깨졌으면 null (비교 불가로 정직하게) */
function baselineFrom(formData: FormData): RouteNodeSnapshot[] | null {
  const raw = formData.get(BASELINE_FIELD);
  return decodeRouteSnapshot(typeof raw === "string" ? raw : null);
}

/**
 * 충돌 거부를 **비교 가능한 형태**로 만들어 돌려준다 (인수 20).
 *
 * 여기서 읽는 최신 상태는 lock_version과 노드를 따로 조회한 결과다. 순서가
 * 중요하다 — 토큰을 먼저 읽으면 토큰이 노드보다 오래된 쪽으로만 어긋나므로
 * 최악이 "diff가 실제보다 적게 보인다"이고, 반대로 하면 이미 지나간 상태를
 * 최신으로 착각할 수 있다. 어느 쪽이든 쓰기 허용 여부는 위의 조건부 UPDATE가
 * 정하므로 조용히 덮어쓰는 일은 없다.
 */
async function conflictResult(params: {
  planId: string;
  organizationId: string;
  expectedLockVersion: number;
  intent: RouteEditIntent;
  baseline: RouteNodeSnapshot[] | null;
}): Promise<BuilderResult> {
  const sql = getSharedSql();
  const [plan] = await sql<{ lock_version: number }[]>`
    select lock_version from route_plans
    where id = ${params.planId} and organization_id = ${params.organizationId}
  `;
  const version = await findDraftVersion(params.organizationId, params.planId);
  const rows = version
    ? await sql<
        {
          id: string;
          kind: string;
          title: string;
          sort_order: number;
          expected_minutes: number | null;
        }[]
      >`
        select id, kind, title, sort_order, expected_minutes
        from route_nodes where route_version_id = ${version.id}
        order by sort_order
      `
    : [];

  const conflict = buildRouteConflict({
    baseline: params.baseline,
    latest: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      sortOrder: r.sort_order,
      expectedMinutes: r.expected_minutes ?? 60,
    })),
    intent: params.intent,
    baseLockVersion: params.expectedLockVersion,
    currentLockVersion: plan?.lock_version ?? params.expectedLockVersion,
  });

  return { ok: false, message: VERSION_CONFLICT_MESSAGE, conflict };
}

const createPlanSchema = z.object({
  name: z.string().min(1, "루트 이름을 입력하세요."),
  scope: z.enum(["group", "learner"]),
  learningGroupId: z.string().default(""),
  learnerId: z.string().default(""),
  targetEndDate: z.string().default(""),
});

export async function createRoutePlan(
  _prev: BuilderResult | null,
  formData: FormData,
): Promise<BuilderResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "routes")) return deny();
  const parsed = createPlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const { name, scope, targetEndDate } = parsed.data;
  const sql = getSharedSql();

  let learningGroupId: string | null = null;
  let learnerId: string | null = null;
  let coursePeriodId: string | null = null;

  if (scope === "group") {
    if (!parsed.data.learningGroupId) {
      return { ok: false, message: "대상 반을 선택하세요." };
    }
    const [group] = await sql<{ id: string; course_period_id: string }[]>`
      select id, course_period_id from learning_groups
      where id = ${parsed.data.learningGroupId}
        and organization_id = ${user.organizationId}
    `;
    if (!group) return { ok: false, message: "반을 찾을 수 없습니다." };
    learningGroupId = group.id;
    coursePeriodId = group.course_period_id;
  } else {
    if (!parsed.data.learnerId) {
      return { ok: false, message: "대상 학생을 선택하세요." };
    }
    const [learner] = await sql<{ id: string }[]>`
      select id from learners
      where id = ${parsed.data.learnerId}
        and organization_id = ${user.organizationId}
    `;
    if (!learner) return { ok: false, message: "학생을 찾을 수 없습니다." };
    learnerId = learner.id;
  }

  const planId = uuidv7();
  const versionId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into route_plans (
        id, organization_id, kind, name, learning_group_id, learner_id,
        course_period_id, status, target_end_date
      ) values (
        ${planId}, ${user.organizationId},
        ${scope === "group" ? "group_route" : "learner_route"}, ${name},
        ${learningGroupId}, ${learnerId}, ${coursePeriodId}, 'draft',
        ${targetEndDate || null}
      )
    `;
    await tx`
      insert into route_versions (
        id, organization_id, route_plan_id, version_number, status, created_by
      ) values (
        ${versionId}, ${user.organizationId}, ${planId}, 1, 'draft', ${user.userId}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'route.create-plan', 'route_plan', ${planId},
        ${tx.json({ name, scope } as never)}
      )
    `;
  });

  revalidatePath("/app/routes");
  redirect(`/app/routes/${planId}`);
}

/** 편집 가능한 초안 버전 — draft·needs_fix·publishable만 (게시본 불변) */
async function findDraftVersion(
  organizationId: string,
  planId: string,
): Promise<{ id: string; version_number: number; status: string } | null> {
  const sql = getSharedSql();
  const [version] = await sql<
    { id: string; version_number: number; status: string }[]
  >`
    select id, version_number, status from route_versions
    where organization_id = ${organizationId} and route_plan_id = ${planId}
      and status in ('draft', 'needs_fix', 'publishable')
    order by version_number desc limit 1
  `;
  return version ?? null;
}

/** 노드 편집 후 검증 결과 무효화 — 다시 검증해야 게시할 수 있다 */
async function invalidateValidation(versionId: string): Promise<void> {
  const sql = getSharedSql();
  await sql`
    update route_versions
    set status = 'draft', validation_report = null, updated_at = now()
    where id = ${versionId} and status in ('needs_fix', 'publishable')
  `;
}

const NODE_KINDS = [
  "concept_lesson",
  "problem_solving",
  "book_range",
  "homework",
  "confirmation_test",
  "wrong_answer_review",
  "cumulative_review",
  "buffer",
] as const;

const addNodeSchema = z.object({
  planId: z.uuid(),
  kind: z.enum(NODE_KINDS),
  title: z.string().min(1, "노드 제목을 입력하세요."),
  expectedMinutes: z.coerce.number().int().min(5).max(480),
  expectedLockVersion: z.coerce.number().int().min(1),
});

export async function addRouteNode(
  _prev: BuilderResult | null,
  formData: FormData,
): Promise<BuilderResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "routes")) return deny();
  const parsed = addNodeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const conceptIds = formData
    .getAll("conceptIds")
    .map(String)
    .filter((v) => /^[0-9a-f-]{36}$/.test(v));

  const sql = getSharedSql();
  const [plan] = await sql<{ id: string }[]>`
    select id from route_plans
    where id = ${parsed.data.planId} and organization_id = ${user.organizationId}
  `;
  if (!plan) return { ok: false, message: "루트를 찾을 수 없습니다." };
  const version = await findDraftVersion(user.organizationId, plan.id);
  if (!version) {
    return { ok: false, message: "편집 가능한 초안 버전이 없습니다. 새 버전을 만드세요." };
  }
  if (
    !(await bumpLockOrConflict(
      plan.id,
      user.organizationId,
      parsed.data.expectedLockVersion,
    ))
  ) {
    return await conflictResult({
      planId: plan.id,
      organizationId: user.organizationId,
      expectedLockVersion: parsed.data.expectedLockVersion,
      baseline: baselineFrom(formData),
      intent: {
        type: "add",
        kind: parsed.data.kind,
        title: parsed.data.title,
        expectedMinutes: parsed.data.expectedMinutes,
        conceptIds,
      },
    });
  }

  await sql`
    insert into route_nodes (
      id, organization_id, route_version_id, kind, title, sort_order,
      concept_ids, expected_minutes
    ) values (
      ${uuidv7()}, ${user.organizationId}, ${version.id}, ${parsed.data.kind},
      ${parsed.data.title},
      (select coalesce(max(sort_order), 0) + 1 from route_nodes
        where route_version_id = ${version.id}),
      ${sql.json(conceptIds as never)}, ${parsed.data.expectedMinutes}
    )
  `;
  await invalidateValidation(version.id);
  revalidatePath(`/app/routes/${plan.id}`);
  return { ok: true, message: `노드 "${parsed.data.title}"을 추가했습니다.` };
}

const nodeOpSchema = z.object({
  planId: z.uuid(),
  nodeId: z.uuid(),
  expectedLockVersion: z.coerce.number().int().min(1),
});

export async function deleteRouteNode(
  _prev: BuilderResult | null,
  formData: FormData,
): Promise<BuilderResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "routes")) return deny();
  const parsed = nodeOpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상 노드가 지정되지 않았습니다." };

  const sql = getSharedSql();
  const version = await findDraftVersion(user.organizationId, parsed.data.planId);
  if (!version) return { ok: false, message: "편집 가능한 초안 버전이 없습니다." };
  if (
    !(await bumpLockOrConflict(
      parsed.data.planId,
      user.organizationId,
      parsed.data.expectedLockVersion,
    ))
  ) {
    return await conflictResult({
      planId: parsed.data.planId,
      organizationId: user.organizationId,
      expectedLockVersion: parsed.data.expectedLockVersion,
      baseline: baselineFrom(formData),
      intent: { type: "delete", nodeId: parsed.data.nodeId },
    });
  }
  const deleted = await sql`
    delete from route_nodes
    where id = ${parsed.data.nodeId}
      and organization_id = ${user.organizationId}
      and route_version_id = ${version.id}
  `;
  if (deleted.count === 0) return { ok: false, message: "노드를 찾을 수 없습니다." };
  await invalidateValidation(version.id);
  revalidatePath(`/app/routes/${parsed.data.planId}`);
  return { ok: true, message: "노드를 삭제했습니다." };
}

const moveNodeSchema = nodeOpSchema.extend({
  direction: z.enum(["up", "down"]),
});

export async function moveRouteNode(
  _prev: BuilderResult | null,
  formData: FormData,
): Promise<BuilderResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "routes")) return deny();
  const parsed = moveNodeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상 노드가 지정되지 않았습니다." };

  const sql = getSharedSql();
  const version = await findDraftVersion(user.organizationId, parsed.data.planId);
  if (!version) return { ok: false, message: "편집 가능한 초안 버전이 없습니다." };

  if (
    !(await bumpLockOrConflict(
      parsed.data.planId,
      user.organizationId,
      parsed.data.expectedLockVersion,
    ))
  ) {
    return await conflictResult({
      planId: parsed.data.planId,
      organizationId: user.organizationId,
      expectedLockVersion: parsed.data.expectedLockVersion,
      baseline: baselineFrom(formData),
      intent: {
        type: "move",
        nodeId: parsed.data.nodeId,
        direction: parsed.data.direction,
      },
    });
  }

  const [node] = await sql<{ id: string; sort_order: number }[]>`
    select id, sort_order from route_nodes
    where id = ${parsed.data.nodeId} and route_version_id = ${version.id}
  `;
  if (!node) return { ok: false, message: "노드를 찾을 수 없습니다." };

  const [neighbor] = parsed.data.direction === "up"
    ? await sql<{ id: string; sort_order: number }[]>`
        select id, sort_order from route_nodes
        where route_version_id = ${version.id} and sort_order < ${node.sort_order}
        order by sort_order desc limit 1
      `
    : await sql<{ id: string; sort_order: number }[]>`
        select id, sort_order from route_nodes
        where route_version_id = ${version.id} and sort_order > ${node.sort_order}
        order by sort_order asc limit 1
      `;
  if (!neighbor) return { ok: true, message: "이미 끝입니다." };

  await sql.begin(async (tx) => {
    await tx`update route_nodes set sort_order = ${neighbor.sort_order}, updated_at = now() where id = ${node.id}`;
    await tx`update route_nodes set sort_order = ${node.sort_order}, updated_at = now() where id = ${neighbor.id}`;
  });
  await invalidateValidation(version.id);
  revalidatePath(`/app/routes/${parsed.data.planId}`);
  return { ok: true, message: "순서를 바꿨습니다." };
}

const planOpSchema = z.object({ planId: z.uuid() });

/** 확인테스트 없이 허용되는 최대 연속 수업 노드 수 — 13장 기본 게이트 */
const MAX_NODES_BETWEEN_CHECKPOINTS = 4;

export async function validateDraft(
  _prev: BuilderResult | null,
  formData: FormData,
): Promise<BuilderResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "routes")) return deny();
  const parsed = planOpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상 루트가 지정되지 않았습니다." };

  const sql = getSharedSql();
  const [plan] = await sql<
    {
      id: string;
      learning_group_id: string | null;
      learner_id: string | null;
      target_end_date: string | null;
    }[]
  >`
    select id, learning_group_id, learner_id, target_end_date::text as target_end_date
    from route_plans
    where id = ${parsed.data.planId} and organization_id = ${user.organizationId}
  `;
  if (!plan) return { ok: false, message: "루트를 찾을 수 없습니다." };
  const version = await findDraftVersion(user.organizationId, plan.id);
  if (!version) return { ok: false, message: "검증할 초안 버전이 없습니다." };

  const nodes = await sql<
    {
      id: string;
      kind: string;
      sort_order: number;
      concept_ids: unknown;
      expected_minutes: number | null;
    }[]
  >`
    select id, kind, sort_order, concept_ids, expected_minutes
    from route_nodes where route_version_id = ${version.id}
    order by sort_order
  `;
  if (nodes.length === 0) {
    return { ok: false, message: "루트에 노드가 없습니다. 노드를 먼저 추가하세요." };
  }

  /* 캘린더 용량 — 대상 반(학생 독립 루트는 소속 반)의 수업 규칙에서 산출 */
  let capacityGroupId = plan.learning_group_id;
  if (!capacityGroupId && plan.learner_id) {
    const [membership] = await sql<{ learning_group_id: string }[]>`
      select learning_group_id from learning_group_memberships
      where organization_id = ${user.organizationId}
        and learner_id = ${plan.learner_id} and status = 'active'
      order by joined_on desc limit 1
    `;
    capacityGroupId = membership?.learning_group_id ?? null;
  }

  const today = todayInTimeZone(user.timezone);
  let horizonEnd = plan.target_end_date;
  if (capacityGroupId && !horizonEnd) {
    const [period] = await sql<{ ends_on: string }[]>`
      select p.ends_on::text from learning_groups g
      join course_periods p on p.id = g.course_period_id
      where g.id = ${capacityGroupId}
    `;
    horizonEnd = period?.ends_on ?? null;
  }

  let availableMinutes = 0;
  let weeklyAvailableMinutes = 0;
  let weeks = 1;
  let capacityNote = "";
  if (capacityGroupId && horizonEnd && horizonEnd >= today) {
    const rules = await sql<
      {
        weekday: number;
        start_time: string;
        end_time: string;
        effective_from: string;
        effective_to: string | null;
      }[]
    >`
      select weekday, start_time::text, end_time::text,
             effective_from::text, effective_to::text
      from calendar_rules
      where organization_id = ${user.organizationId}
        and subject_type = 'learning_group' and subject_id = ${capacityGroupId}
    `;
    const holidays = await sql<{ starts_on: string; ends_on: string }[]>`
      select starts_on::text, ends_on::text from holidays
      where organization_id = ${user.organizationId}
        and (learning_group_id is null or learning_group_id = ${capacityGroupId})
    `;
    const isHoliday = (d: string): boolean =>
      holidays.some((h) => h.starts_on <= d && h.ends_on >= d);
    weeklyAvailableMinutes = rules.reduce(
      (s, r) => s + minutesBetween(r.start_time, r.end_time),
      0,
    );
    let cursor = new Date(`${today}T00:00:00Z`);
    const end = new Date(`${horizonEnd}T00:00:00Z`);
    let dayCount = 0;
    while (cursor <= end) {
      const iso = cursor.toISOString().slice(0, 10);
      const wd = cursor.getUTCDay();
      if (!isHoliday(iso)) {
        for (const r of rules) {
          if (r.weekday !== wd) continue;
          if (iso < r.effective_from) continue;
          if (r.effective_to && iso > r.effective_to) continue;
          availableMinutes += minutesBetween(r.start_time, r.end_time);
        }
      }
      cursor = new Date(cursor.getTime() + 86_400_000);
      dayCount += 1;
    }
    weeks = Math.max(1, Math.ceil(dayCount / 7));
  } else {
    // 용량 근거가 없으면 검증에서 용량 게이트를 건너뛴다 — 통과로 위장하지 않는다
    const total = nodes.reduce((s, n) => s + (n.expected_minutes ?? 60), 0);
    availableMinutes = total;
    weeklyAvailableMinutes = total;
    capacityNote = " (수업 규칙·기간이 없어 용량 검증은 건너뜀)";
  }

  const edges = await sql<
    {
      from_concept_id: string;
      to_concept_id: string;
      kind: string;
      provenance: string;
      status: string;
    }[]
  >`
    select from_concept_id, to_concept_id, kind, provenance, status
    from concept_edges where kind in ('prerequisite', 'soft_prerequisite')
  `;
  const graphEdges: GraphEdge[] = edges.map((e) => ({
    fromConceptId: e.from_concept_id,
    toConceptId: e.to_concept_id,
    kind: e.kind as GraphEdge["kind"],
    provenance: e.provenance as GraphEdge["provenance"],
    status: e.status as GraphEdge["status"],
  }));

  const nodeInputs = nodes.map((n) => ({
    nodeId: n.id,
    kind: n.kind,
    sortOrder: n.sort_order,
    conceptIds: Array.isArray(n.concept_ids) ? (n.concept_ids as string[]) : [],
    expectedMinutes: n.expected_minutes ?? 60,
    isCheckpoint: n.kind === "confirmation_test",
  }));

  const report = validateRoute({
    nodes: nodeInputs,
    dependencies: [],
    conceptEdges: graphEdges,
    targetConceptIds: [...new Set(nodeInputs.flatMap((n) => n.conceptIds))],
    assumedKnownConceptIds: [],
    availableMinutes,
    weeklyAvailableMinutes,
    weeks,
    maxNodesBetweenCheckpoints: MAX_NODES_BETWEEN_CHECKPOINTS,
  });

  await sql`
    update route_versions
    set status = ${report.ok ? "publishable" : "needs_fix"},
        validation_report = ${sql.json(report as never)},
        updated_at = now()
    where id = ${version.id}
  `;
  revalidatePath(`/app/routes/${plan.id}`);
  return report.ok
    ? {
        ok: true,
        message: `검증 통과 — 총 ${report.summary.totalMinutes}분 / 가용 ${report.summary.availableMinutes}분${capacityNote}. 게시할 수 있습니다.`,
      }
    : {
        ok: false,
        message: `검증 실패 ${report.issues.length}건: ${report.issues
          .map((i) => i.message)
          .join(" · ")}`,
      };
}

const lockedPlanOpSchema = planOpSchema.extend({
  expectedLockVersion: z.coerce.number().int().min(1),
});

export async function publishRoute(
  _prev: BuilderResult | null,
  formData: FormData,
): Promise<BuilderResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "routes")) return deny();
  const parsed = lockedPlanOpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상 루트가 지정되지 않았습니다." };

  const sql = getSharedSql();
  const [plan] = await sql<
    { id: string; name: string; learning_group_id: string | null }[]
  >`
    select id, name, learning_group_id from route_plans
    where id = ${parsed.data.planId} and organization_id = ${user.organizationId}
  `;
  if (!plan) return { ok: false, message: "루트를 찾을 수 없습니다." };
  if (
    !(await bumpLockOrConflict(
      plan.id,
      user.organizationId,
      parsed.data.expectedLockVersion,
    ))
  ) {
    return await conflictResult({
      planId: plan.id,
      organizationId: user.organizationId,
      expectedLockVersion: parsed.data.expectedLockVersion,
      baseline: baselineFrom(formData),
      intent: { type: "publish" },
    });
  }

  const [version] = await sql<
    { id: string; version_number: number; validation_report: RouteValidationReport | null }[]
  >`
    select id, version_number, validation_report from route_versions
    where organization_id = ${user.organizationId} and route_plan_id = ${plan.id}
      and status = 'publishable'
    order by version_number desc limit 1
  `;
  if (!version || !version.validation_report?.ok) {
    return {
      ok: false,
      message: "게시하려면 먼저 검증을 통과해야 합니다 (publishable 버전 없음).",
    };
  }
  const validation = version.validation_report;

  const nodeCountRows = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from route_nodes where route_version_id = ${version.id}
  `;

  await sql.begin(async (tx) => {
    await tx`
      update route_versions set status = 'superseded', updated_at = now()
      where route_plan_id = ${plan.id} and status = 'published'
    `;
    await tx`
      update route_versions
      set status = 'published', published_at = now(), published_by = ${user.userId},
          updated_at = now()
      where id = ${version.id}
    `;
    await tx`
      update route_plans
      set status = 'published', active_version_id = ${version.id}, updated_at = now()
      where id = ${plan.id}
    `;
    await tx`
      insert into route_publications (
        id, organization_id, route_plan_id, route_version_id, impact_summary, published_by
      ) values (
        ${uuidv7()}, ${user.organizationId}, ${plan.id}, ${version.id},
        ${tx.json({
          nodeCount: nodeCountRows[0]?.cnt ?? 0,
          validation: validation.summary,
        } as never)},
        ${user.userId}
      )
    `;
    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'route', ${plan.id},
        ${version.version_number}, 'RoutePublished', now(),
        ${tx.json({
          routePlanId: plan.id,
          routeVersionId: version.id,
          learningGroupId: plan.learning_group_id,
          publishedBy: user.userId,
        } as never)}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'route.publish', 'route_version', ${version.id},
        ${tx.json({ plan: plan.name, version: version.version_number } as never)}
      )
    `;
  });

  revalidatePath("/app/routes");
  revalidatePath(`/app/routes/${plan.id}`);
  return {
    ok: true,
    message: `"${plan.name}" v${version.version_number}을 게시했습니다. 일정 실체화가 큐에 등록되었습니다.`,
  };
}

/** 게시된 루트의 다음 초안 버전 — 활성 버전의 노드를 복사해 시작 */
export async function createDraftVersion(
  _prev: BuilderResult | null,
  formData: FormData,
): Promise<BuilderResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "routes")) return deny();
  const parsed = planOpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상 루트가 지정되지 않았습니다." };

  const sql = getSharedSql();
  const [plan] = await sql<{ id: string; active_version_id: string | null }[]>`
    select id, active_version_id from route_plans
    where id = ${parsed.data.planId} and organization_id = ${user.organizationId}
  `;
  if (!plan?.active_version_id) {
    return { ok: false, message: "게시된 활성 버전이 없습니다." };
  }
  const existing = await findDraftVersion(user.organizationId, plan.id);
  if (existing) {
    return { ok: false, message: `이미 편집 중인 v${existing.version_number} 초안이 있습니다.` };
  }

  const newVersionId = uuidv7();
  await sql.begin(async (tx) => {
    const [next] = await tx<{ n: number }[]>`
      select coalesce(max(version_number), 0) + 1 as n from route_versions
      where route_plan_id = ${plan.id}
    `;
    await tx`
      insert into route_versions (
        id, organization_id, route_plan_id, version_number, status, created_by
      ) values (
        ${newVersionId}, ${user.organizationId}, ${plan.id}, ${next!.n}, 'draft',
        ${user.userId}
      )
    `;
    await tx`
      insert into route_nodes (
        id, organization_id, route_version_id, kind, title, sort_order,
        concept_ids, expected_minutes
      )
      select gen_random_uuid(), organization_id, ${newVersionId}, kind, title,
             sort_order, concept_ids, expected_minutes
      from route_nodes where route_version_id = ${plan.active_version_id}
    `;
  });
  revalidatePath(`/app/routes/${plan.id}`);
  return { ok: true, message: "새 초안 버전을 만들었습니다. 편집 후 검증·게시하세요." };
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0)));
}
