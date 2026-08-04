"use server";

import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getSharedSql } from "@su-maek/db";
import { executeLearnerErasure, reopenLearnerDay } from "@su-maek/db/domain";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import type { IsoDate } from "@su-maek/core/shared";
import { getCurrentUser } from "@/lib/auth/current-user";
import { todayInKst } from "@/lib/format";
import { materializeLearnerSchedule } from "@/lib/domain/schedule";
import {
  linkLearnerAccount,
  unlinkLearnerAccount,
} from "@/lib/domain/learner-account";

/* 학생 오버라이드 (13장·인수 4) — 반 공통 루트를 복사하지 않고 차이만
 * 버전으로 저장한다. 반 루트·다른 학생에게 어떤 영향도 주지 않는다
 * (불변 조건 4). */

export interface ActionResult {
  ok: boolean;
  message: string;
}

/* ── 학생 로그인 계정 연결 (4장) ──
 * 계정 발급은 워크스페이스 운영 행위라 **settings 쓰기 권한**으로 막는다
 * (기본 매트릭스에서 owner만 full). 교사가 학생을 등록하는 것과, 그 학생에게
 * 로그인 수단을 주는 것은 무게가 다르다. */

export interface AccountResult extends ActionResult {
  /** 새로 만든 경우에만. 화면에서 한 번 보여 주고 저장하지 않는다. */
  temporaryPassword?: string;
}

const linkSchema = z.object({
  learnerId: z.uuid(),
  email: z.string().min(3).max(255),
});

export async function linkLearnerAccountAction(
  _prev: AccountResult | null,
  formData: FormData,
): Promise<AccountResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "settings")) {
    return { ok: false, message: "학생 계정을 발급할 권한이 없습니다." };
  }
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "입력이 올바르지 않습니다." };

  const result = await linkLearnerAccount({
    organizationId: user.organizationId,
    learnerId: parsed.data.learnerId,
    email: parsed.data.email,
    actorUserId: user.userId,
  });
  revalidatePath(`/app/students/${parsed.data.learnerId}`);
  return result;
}

export async function unlinkLearnerAccountAction(
  _prev: AccountResult | null,
  formData: FormData,
): Promise<AccountResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "settings")) {
    return { ok: false, message: "학생 계정을 관리할 권한이 없습니다." };
  }
  const parsed = z
    .object({ learnerId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상이 지정되지 않았습니다." };

  const result = await unlinkLearnerAccount({
    organizationId: user.organizationId,
    learnerId: parsed.data.learnerId,
    actorUserId: user.userId,
  });
  revalidatePath(`/app/students/${parsed.data.learnerId}`);
  return result;
}

/* ── 학습자 스코프 일정 실체화 (인수 4) ──
 * 오버라이드를 소비해 이 학생의 개별 차시를 만든다. sessions(반 공통)는
 * 한 줄도 건드리지 않는다 — 실체화 구현이 그것을 보장한다.
 *
 * 워커 자동 재계산이 kill switch로 멈춰 있어도 **이 버튼은 동작한다**:
 * 스위치의 집행 지점은 자동화(워커 토픽)뿐이고 사람의 명시적 실행은 막지
 * 않는다 (kill-switch.ts 머리말). */

export interface LearnerScheduleResult extends ActionResult {
  createdItems: number;
  divergingItems: number;
  rejoinDate: string | null;
  conflicts: number;
}

function scheduleDeny(message: string): LearnerScheduleResult {
  return {
    ok: false,
    message,
    createdItems: 0,
    divergingItems: 0,
    rejoinDate: null,
    conflicts: 0,
  };
}

const materializeSchema = z.object({ learnerId: z.uuid() });

export async function materializeLearnerScheduleAction(
  _prev: LearnerScheduleResult | null,
  formData: FormData,
): Promise<LearnerScheduleResult> {
  const user = await getCurrentUser();
  // 쓰기 게이트 — 읽기 게이트를 쓰면 readonly 역할이 샌다
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "learners")) {
    return scheduleDeny("학생 개별 일정을 계산할 권한이 없습니다.");
  }
  const parsed = materializeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return scheduleDeny("대상 학생이 지정되지 않았습니다.");

  /* 기준 날짜는 조직 시간대의 오늘 — UTC로 뽑으면 KST 00:00~09:00 사이에
   * 하루가 어제로 밀려 오늘 차시가 "과거 보존" 대상이 된다. */
  const result = await materializeLearnerSchedule({
    organizationId: user.organizationId,
    learnerId: parsed.data.learnerId,
    /* 감사 주체 — 실체화가 audit_events에 actor_type='user'로 남긴다
     * (null이면 automation). 여기가 그 기록의 유일한 주입점이다. */
    actorUserId: user.userId,
    today: todayInKst(),
  });

  revalidatePath(`/app/students/${parsed.data.learnerId}`);
  revalidatePath("/app/today");
  return {
    ok: result.ok,
    message: result.message,
    createdItems: result.createdItems,
    divergingItems: result.divergingItems,
    rejoinDate: result.rejoinDate,
    conflicts: result.conflicts,
  };
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
  /* 재합류 지점 — "이 학생이 어느 차시에서 반 진도로 돌아오는가"의 답.
   * 비우면 재합류 없음(계속 갈라진 채로 진행). */
  rejoinNodeId: z.string().default(""),
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

  /* 재합류 노드도 기준 버전의 것이어야 한다 — 다른 버전의 노드 ID를 넣으면
   * 실체화가 재합류 지점을 찾지 못하고 조용히 무시한다. */
  const rejoinNodeId = /^[0-9a-f-]{36}$/.test(parsed.data.rejoinNodeId)
    ? parsed.data.rejoinNodeId
    : null;
  if (rejoinNodeId) {
    const [valid] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from route_nodes
      where route_version_id = ${base.version_id} and id = ${rejoinNodeId}
    `;
    if ((valid?.cnt ?? 0) !== 1) {
      return { ok: false, message: "재합류 노드가 기준 루트 버전에 없습니다." };
    }
    if (skipNodeIds.includes(rejoinNodeId)) {
      return {
        ok: false,
        message: "건너뛸 노드를 재합류 지점으로 지정할 수 없습니다.",
      };
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
        status, reason, goal, delta, created_by, effective_from, effective_to,
        rejoin_node_id
      ) values (
        ${overrideId}, ${user.organizationId}, ${learner.id}, ${base.version_id},
        ${parsed.data.kind}, 1, 'active', ${parsed.data.reason},
        ${parsed.data.goal || null}, ${tx.json(delta as never)}, ${user.userId},
        ${parsed.data.effectiveFrom || null}, ${parsed.data.effectiveTo || null},
        ${rejoinNodeId}
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
        ${tx.json({
          learner: learner.display_name,
          kind: parsed.data.kind,
          delta,
          rejoinNodeId,
        } as never)}
      )
    `;
    /* Outbox — 오버라이드 저장과 **같은 트랜잭션** (2D). 워커가 소비해
     * 이 학생의 개별 일정을 자동으로 다시 실체화한다. */
    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'student_route_override',
        ${overrideId}, 1, 'LearnerRouteOverrideChanged', now(),
        ${tx.json({
          overrideId,
          learnerId: learner.id,
          kind: parsed.data.kind,
          changedTo: "active",
          changedBy: user.userId,
        } as never)}
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

/* ── 개인정보 삭제 요청 (ADR-0015 §5 · 인수 39) ──
 * 소유자 전용 위험 작업 (data.delete). 요청 기록 → 이름 확인 후 집행. */

const requestDeletionSchema = z.object({
  learnerId: z.uuid(),
  reason: z.string().min(1, "삭제 요청 사유를 입력하세요."),
});

export async function requestDeletion(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "settings")) {
    return { ok: false, message: "삭제 요청은 소유자만 접수할 수 있습니다." };
  }
  const parsed = requestDeletionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const sql = getSharedSql();
  const [learner] = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from learners
    where id = ${parsed.data.learnerId} and organization_id = ${user.organizationId}
  `;
  if (!learner) return { ok: false, message: "학습자를 찾을 수 없습니다." };

  const [open] = await sql<{ id: string }[]>`
    select id from data_deletion_requests
    where organization_id = ${user.organizationId}
      and learner_id = ${learner.id}
      and status in ('received', 'processing')
  `;
  if (open) return { ok: false, message: "이미 접수된 삭제 요청이 있습니다." };

  const requestId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into data_deletion_requests (
        id, organization_id, subject_type, learner_id, requested_by, reason, status, due_on
      ) values (
        ${requestId}, ${user.organizationId}, 'learner', ${learner.id},
        ${user.userId}, ${parsed.data.reason}, 'received',
        (now() + interval '14 days')::date
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, reason
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'privacy.request', 'learner', ${learner.id}, ${parsed.data.reason}
      )
    `;
  });
  revalidatePath(`/app/students/${learner.id}`);
  return {
    ok: true,
    message: "삭제 요청을 접수했습니다. 처리 기한은 영업일 10일입니다 (달력 14일로 기록).",
  };
}

const executeDeletionSchema = z.object({
  requestId: z.uuid(),
  learnerId: z.uuid(),
  confirmName: z.string().default(""),
});

export async function executeDeletion(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "settings")) {
    return { ok: false, message: "익명화 집행은 소유자만 할 수 있습니다." };
  }
  const parsed = executeDeletionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "대상 요청이 지정되지 않았습니다." };
  }
  const sql = getSharedSql();
  const [learner] = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from learners
    where id = ${parsed.data.learnerId} and organization_id = ${user.organizationId}
  `;
  if (!learner) return { ok: false, message: "학습자를 찾을 수 없습니다." };

  // 위험 작업 재확인 (4장 data.delete) — 표시명을 정확히 입력해야 집행
  if (parsed.data.confirmName.trim() !== learner.display_name) {
    return {
      ok: false,
      message: `확인을 위해 학습자 표시명("${learner.display_name}")을 정확히 입력하세요.`,
    };
  }

  const result = await executeLearnerErasure({
    organizationId: user.organizationId,
    requestId: parsed.data.requestId,
    executedBy: user.userId,
  });
  revalidatePath(`/app/students/${learner.id}`);
  revalidatePath("/app/students");
  revalidatePath("/app/classes");
  return { ok: result.ok, message: result.message };
}

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
  /* 대상의 학습자·종류를 먼저 읽는다 — 취소 이벤트의 payload는 폼이 아니라
   * 저장된 행에서 나와야 한다 (폼의 learnerId는 조작될 수 있다). */
  const [target] = await sql<{ learner_id: string; kind: string }[]>`
    select learner_id::text as learner_id, kind::text as kind
    from student_route_overrides
    where id = ${parsed.data.overrideId}
      and organization_id = ${user.organizationId}
      and status = 'active'
  `;
  if (!target) {
    return { ok: false, message: "활성 오버라이드를 찾을 수 없습니다." };
  }

  let cancelled = false;
  await sql.begin(async (tx) => {
    const updated = await tx`
      update student_route_overrides
      set status = 'cancelled', updated_at = now()
      where id = ${parsed.data.overrideId}
        and organization_id = ${user.organizationId}
        and status = 'active'
    `;
    // 경합 — 다른 요청이 먼저 취소했다. 감사·이벤트를 남기지 않는다.
    if (updated.count === 0) return;
    cancelled = true;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'route.cancel-override', 'student_route_override', ${parsed.data.overrideId}
      )
    `;
    /* Outbox — 취소도 같은 트랜잭션에서 알린다. 오버라이드가 빠지면 학생
     * 경로는 반 공통으로 되돌아가야 하고, 그 재계산은 워커가 한다. */
    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'student_route_override',
        ${parsed.data.overrideId}, 2, 'LearnerRouteOverrideChanged', now(),
        ${tx.json({
          overrideId: parsed.data.overrideId,
          learnerId: target.learner_id,
          kind: target.kind,
          changedTo: "cancelled",
          changedBy: user.userId,
        } as never)}
      )
    `;
  });
  if (!cancelled) {
    return { ok: false, message: "활성 오버라이드를 찾을 수 없습니다." };
  }

  revalidatePath(`/app/students/${target.learner_id}`);
  return { ok: true, message: "오버라이드를 취소했습니다." };
}

/* ── 하루 완료 취소 (ADR-0017 §6 · T4.1) ──
 *
 * 자동 완료가 잘못 걸린 하루를 교사가 되돌린다. 완료 시각은 **지우지
 * 않는다** — 지우고 다시 채우면 숙련도·일정 엔진에 같은 날이 두 번 흘러가고,
 * DB 트리거도 그 변경을 거부한다.
 *
 * 취소의 실제 효과는 **재투영이 다시 도는 것**이다. 완료된 계획은 투영기가
 * 통째로 건너뛰므로, 잘못 완료된 하루는 원본을 고쳐도 계획이 갱신되지 않는다.
 *
 * 권한은 `learners` 쓰기다. 학생 기록을 되돌리는 일이고 담당 교사의 일상
 * 업무이므로, 계정 발급(settings)만큼 무겁게 잠그지 않는다.
 */
const reopenDaySchema = z.object({
  learnerId: z.uuid(),
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(1).max(500),
});

export async function reopenLearnerDayAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "learners")) {
    return { ok: false, message: "하루 완료를 취소할 권한이 없습니다." };
  }

  const parsed = reopenDaySchema.safeParse({
    learnerId: formData.get("learnerId"),
    planDate: formData.get("planDate"),
    reason: String(formData.get("reason") ?? "").trim(),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "취소 사유를 적어 주세요 — 완료 기록을 되돌리는 유일한 근거입니다.",
    };
  }

  const result = await reopenLearnerDay(getSharedSql(), {
    organizationId: user.organizationId,
    learnerId: parsed.data.learnerId,
    planDate: parsed.data.planDate as IsoDate,
    actorUserId: user.userId,
    reason: parsed.data.reason,
  });

  if (result.ok) revalidatePath(`/app/students/${parsed.data.learnerId}`);
  return { ok: result.ok, message: result.message };
}
