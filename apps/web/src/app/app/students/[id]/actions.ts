"use server";

import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";

/* 학생 오버라이드 (13장·인수 4) — 반 공통 루트를 복사하지 않고 차이만
 * 버전으로 저장한다. 반 루트·다른 학생에게 어떤 영향도 주지 않는다
 * (불변 조건 4). */

export interface ActionResult {
  ok: boolean;
  message: string;
}

const OVERRIDE_KINDS = [
  "remediation",
  "absence_makeup",
  "temporary_advance",
  "retest_relearn",
  "skip",
] as const;

const createSchema = z.object({
  learnerId: z.uuid(),
  kind: z.enum(OVERRIDE_KINDS),
  reason: z.string().min(1, "오버라이드 사유를 입력하세요."),
  goal: z.string().default(""),
  effectiveFrom: z.string().default(""),
  effectiveTo: z.string().default(""),
  insertTitle: z.string().default(""),
  insertMinutes: z.coerce.number().int().min(5).max(480).default(60),
});

export async function createOverride(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "learners")) {
    return { ok: false, message: "학생 경로를 변경할 권한이 없습니다." };
  }
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const skipNodeIds = formData
    .getAll("skipNodeIds")
    .map(String)
    .filter((v) => /^[0-9a-f-]{36}$/.test(v));

  const sql = getSharedSql();
  const [learner] = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from learners
    where id = ${parsed.data.learnerId} and organization_id = ${user.organizationId}
  `;
  if (!learner) return { ok: false, message: "학생을 찾을 수 없습니다." };

  /* 기준: 학생 소속 반의 게시된 활성 루트 버전 */
  const [base] = await sql<{ version_id: string; group_name: string }[]>`
    select p.active_version_id as version_id, g.name as group_name
    from learning_group_memberships m
    join learning_groups g on g.id = m.learning_group_id
    join route_plans p on p.learning_group_id = g.id and p.status = 'published'
    where m.organization_id = ${user.organizationId}
      and m.learner_id = ${learner.id} and m.status = 'active'
      and p.active_version_id is not null
    order by m.joined_on desc limit 1
  `;
  if (!base) {
    return {
      ok: false,
      message: "기준이 될 게시된 반 루트가 없습니다. 반 루트를 먼저 게시하세요.",
    };
  }

  if (skipNodeIds.length > 0) {
    const valid = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from route_nodes
      where route_version_id = ${base.version_id}
        and id = any(${skipNodeIds}::uuid[])
    `;
    if ((valid[0]?.cnt ?? 0) !== skipNodeIds.length) {
      return { ok: false, message: "건너뛸 노드가 기준 루트 버전에 없습니다." };
    }
  }

  const delta: Record<string, unknown> = { skipNodeIds };
  if (parsed.data.insertTitle) {
    delta.insertBefore = {
      anchorNodeId: null,
      nodes: [
        {
          title: parsed.data.insertTitle,
          kind: "remediation",
          expectedMinutes: parsed.data.insertMinutes,
        },
      ],
    };
  }
  if (skipNodeIds.length === 0 && !parsed.data.insertTitle) {
    return { ok: false, message: "건너뛸 노드를 고르거나 보충 노드를 입력하세요." };
  }

  const overrideId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into student_route_overrides (
        id, organization_id, learner_id, base_route_version_id, kind, version,
        status, reason, goal, delta, created_by, effective_from, effective_to
      ) values (
        ${overrideId}, ${user.organizationId}, ${learner.id}, ${base.version_id},
        ${parsed.data.kind}, 1, 'active', ${parsed.data.reason},
        ${parsed.data.goal || null}, ${tx.json(delta as never)}, ${user.userId},
        ${parsed.data.effectiveFrom || null}, ${parsed.data.effectiveTo || null}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'route.create-override', 'student_route_override', ${overrideId},
        ${parsed.data.reason},
        ${tx.json({ learner: learner.display_name, kind: parsed.data.kind, delta } as never)}
      )
    `;
  });

  revalidatePath(`/app/students/${learner.id}`);
  return {
    ok: true,
    message: `${learner.display_name}의 개별 경로 오버라이드를 만들었습니다 (기준: ${base.group_name} 루트). 반 공통 일정은 변경되지 않습니다.`,
  };
}

const cancelSchema = z.object({
  overrideId: z.uuid(),
  learnerId: z.uuid(),
});

export async function cancelOverride(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "learners")) {
    return { ok: false, message: "학생 경로를 변경할 권한이 없습니다." };
  }
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상이 지정되지 않았습니다." };

  const sql = getSharedSql();
  const updated = await sql`
    update student_route_overrides
    set status = 'cancelled', updated_at = now()
    where id = ${parsed.data.overrideId}
      and organization_id = ${user.organizationId}
      and status = 'active'
  `;
  if (updated.count === 0) {
    return { ok: false, message: "활성 오버라이드를 찾을 수 없습니다." };
  }
  await sql`
    insert into audit_events (
      id, organization_id, actor_type, actor_id, action, target_type, target_id
    ) values (
      ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
      'route.cancel-override', 'student_route_override', ${parsed.data.overrideId}
    )
  `;
  revalidatePath(`/app/students/${parsed.data.learnerId}`);
  return { ok: true, message: "오버라이드를 취소했습니다." };
}
