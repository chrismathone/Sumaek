import { v7 as uuidv7 } from "uuid";
import type { Sql } from "postgres";
import type { IsoDate } from "@su-maek/core/shared";
import { appendOutboxEvent } from "../queue";

/* ─────────────────────────────────────────────────────────────
 * 반 수업 마감 (T4.2 · E-02 · G-03).
 *
 * `SessionCompleted` 계약은 0단계부터 있었고 소비자(schedule.recalculate ·
 * readmodel.refresh)까지 배선돼 있었지만 **발행하는 곳이 없었다.** 그래서
 * 수업은 영원히 `planned`에 머문다 — 실측으로 과거 `planned` 수업이 83건
 * 쌓여 있었다.
 *
 * 이것은 학생의 하루 완료(E-16)와 **다른 사건**이다 (I-21 · ADR-0017 §1):
 *   학생 완료 = 그 학생이 자기 몫을 끝냈다
 *   반 마감   = 교사가 이 차시에서 실제로 어디까지 나갔다고 확인했다
 * 한 명이 다 했다고 반이 끝나지 않고, 반이 끝났다고 학생 하루가 끝나지 않는다.
 * 이으면 한 사람의 클릭이 다른 스물아홉 명의 기록을 만든다.
 * ───────────────────────────────────────────────────────────── */

/** 마감 대상이 되는 상태 — 이미 끝났거나 취소된 것은 여기 없다. */
const CLOSEABLE = ["planned", "confirmed", "in_progress"] as const;

export type NodeProgress = "completed" | "partial" | "skipped";
export type SessionCoverage = "full" | "partial" | "not_started";

export interface SessionAwaitingClose {
  sessionId: string;
  sessionDate: string;
  startsAt: string;
  endsAt: string;
  status: string;
  learningGroupId: string;
  learningGroupName: string | null;
  teacherName: string | null;
  plannedNodeIds: string[];
  /** 그날 이 반에서 하루를 마친 학생 수 — **참고**이지 마감 조건이 아니다 */
  learnersCompleted: number;
  learnerCount: number;
}

function nodeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * 마감을 기다리는 수업 — **오늘까지** 것만.
 *
 * 내일 수업을 띄우면 교사가 하지도 않은 수업을 마감한다. 실제로 어디까지
 * 나갔는지는 수업이 끝나야 알 수 있고, 그것을 적는 것이 이 화면의 전부다.
 */
export async function listSessionsAwaitingClose(
  sql: Sql,
  input: {
    organizationId: string;
    learningGroupId?: string | null;
    today: IsoDate | string;
    limit?: number;
  },
): Promise<SessionAwaitingClose[]> {
  const rows = await sql<
    {
      id: string;
      session_date: string;
      starts_at: string;
      ends_at: string;
      status: string;
      learning_group_id: string;
      group_name: string | null;
      teacher_name: string | null;
      planned_node_ids: unknown;
      learner_count: number;
      learners_completed: number;
    }[]
  >`
    select s.id::text, s.session_date::text, s.starts_at::text, s.ends_at::text,
           s.status::text as status, s.learning_group_id::text,
           g.name as group_name, u.display_name as teacher_name,
           s.planned_node_ids,
           (select count(*)::int from learning_group_memberships m
             where m.learning_group_id = s.learning_group_id
               and m.status = 'active') as learner_count,
           (select count(*)::int from learner_day_plans p
             where p.organization_id = s.organization_id
               and p.learning_group_id = s.learning_group_id
               and p.plan_date = s.session_date
               and p.status = 'completed') as learners_completed
    from sessions s
    left join learning_groups g on g.id = s.learning_group_id
    left join users u on u.id = s.teacher_user_id
    where s.organization_id = ${input.organizationId}
      and (${input.learningGroupId ?? null}::uuid is null
           or s.learning_group_id = ${input.learningGroupId ?? null}::uuid)
      and s.session_date <= ${input.today}::date
      and s.status = any(${CLOSEABLE as unknown as string[]}::session_status[])
    order by s.starts_at desc
    limit ${input.limit ?? 30}
  `;

  return rows.map((r) => ({
    sessionId: r.id,
    sessionDate: r.session_date,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status,
    learningGroupId: r.learning_group_id,
    learningGroupName: r.group_name,
    teacherName: r.teacher_name,
    plannedNodeIds: nodeIdList(r.planned_node_ids),
    learnersCompleted: r.learners_completed,
    learnerCount: r.learner_count,
  }));
}

export interface CloseSessionResult {
  ok: boolean;
  message: string;
  sessionId: string | null;
  coverage: SessionCoverage | null;
  eventId: string | null;
}

function fail(message: string, sessionId: string | null = null): CloseSessionResult {
  return { ok: false, message, sessionId, coverage: null, eventId: null };
}

/** 노드별 진행 → 차시 전체의 진도 판정. */
function decideCoverage(
  values: readonly NodeProgress[],
): SessionCoverage {
  if (values.length === 0) return "not_started";
  if (values.every((v) => v === "completed")) return "full";
  if (values.every((v) => v === "skipped")) return "not_started";
  return "partial";
}

const PROGRESS_KIND: Record<NodeProgress, string> = {
  completed: "node_completed",
  partial: "node_partial",
  skipped: "node_skipped",
};

/**
 * 교사가 실제 진행을 확인하고 수업을 마감한다.
 *
 * `sessions.status`, `progress_events`, `SessionCompleted`가 **같은
 * 트랜잭션**이다. 갈라 두면 「완료라고 표시됐는데 무엇을 했는지 기록이 없는
 * 수업」이 생기고, 그것은 I-21이 「학생 완료가 넘어온 것」으로 읽는 모양과
 * 정확히 같다 — 사고와 정상을 구분할 수 없게 된다.
 *
 * 자동 마감은 하지 않는다. 실제로 어디까지 나갔는지는 사람만 안다.
 */
export async function closeSession(
  sql: Sql,
  input: {
    organizationId: string;
    sessionId: string;
    actorUserId: string;
    nodeProgress: Record<string, NodeProgress>;
    note?: string | null;
  },
): Promise<CloseSessionResult> {
  return sql.begin(async (tx) => {
    const [session] = await tx<
      {
        id: string;
        status: string;
        session_date: string;
        learning_group_id: string;
        teacher_user_id: string | null;
        timezone: string;
        starts_at: string;
        planned_node_ids: unknown;
      }[]
    >`
      select id::text, status::text as status, session_date::text,
             learning_group_id::text, teacher_user_id::text, timezone,
             starts_at::text, planned_node_ids
      from sessions
      where id = ${input.sessionId} and organization_id = ${input.organizationId}
      for update
    `;
    if (!session) return fail("수업을 찾을 수 없습니다.");

    if (session.status === "completed") {
      /* 두 번째 마감이 진도를 덮어쓰면 실제로 나간 곳이 사라진다. 그리고
       * progress_events는 append-only라 되돌릴 수도 없다. */
      return fail("이미 마감한 수업입니다.", session.id);
    }
    if (!(CLOSEABLE as readonly string[]).includes(session.status)) {
      return fail(
        `마감할 수 없는 상태입니다 (${session.status}).`,
        session.id,
      );
    }

    const planned = nodeIdList(session.planned_node_ids);
    const reported = Object.keys(input.nodeProgress);

    /* 실제 진행은 planned 노드 집합과 **대조**돼야 한다. 대조하지 않으면
     * 진도 기록이 루트와 무관해지고, 그것을 먹는 일정 엔진(T4.3)도 함께
     * 어긋난다. 양쪽 방향을 다 본다. */
    const stray = reported.filter((id) => !planned.includes(id));
    if (stray.length > 0) {
      return fail("계획에 없는 노드는 진도로 적을 수 없습니다.", session.id);
    }
    const missing = planned.filter((id) => !(id in input.nodeProgress));
    if (missing.length > 0) {
      /* 빠뜨린 것을 조용히 「건너뜀」으로 만들지 않는다 — 교사가 말하지 않은
       * 것과 「안 했다」고 말한 것은 다르고, 후자만 일정 재계획의 근거다. */
      return fail(
        `계획된 노드 ${missing.length}개의 진행을 적지 않았습니다.`,
        session.id,
      );
    }

    const values = planned.map((id) => input.nodeProgress[id]!);
    const coverage = decideCoverage(values);
    const bucket = (want: NodeProgress) =>
      planned.filter((id) => input.nodeProgress[id] === want);

    const [updated] = await tx<{ id: string }[]>`
      update sessions
      set status = 'completed', updated_at = now()
      where id = ${session.id} and status <> 'completed'
      returning id::text
    `;
    if (!updated) return fail("이미 마감한 수업입니다.", session.id);

    const occurredAt = new Date();

    /* 차시 단위 기록을 **항상** 하나 남긴다. 노드가 0개인 수업도 있고, 그때
     * 노드별 기록만 쓰면 progress_events가 비어 I-21('교사 마감 기록 없이
     * 완료된 수업')에 걸린다 — 정상 마감이 사고로 보인다. */
    await tx`
      insert into progress_events (
        id, organization_id, learner_id, learning_group_id, session_id,
        route_node_id, kind, detail, occurred_at, recorded_by
      ) values (
        ${uuidv7()}, ${input.organizationId}, null, ${session.learning_group_id},
        ${session.id}, null, 'session_closed',
        ${tx.json({
          coverage,
          plannedNodeIds: planned,
          note: input.note ?? null,
        } as never)},
        ${occurredAt}, ${input.actorUserId}
      )
    `;
    for (const nodeId of planned) {
      await tx`
        insert into progress_events (
          id, organization_id, learner_id, learning_group_id, session_id,
          route_node_id, kind, detail, occurred_at, recorded_by
        ) values (
          ${uuidv7()}, ${input.organizationId}, null, ${session.learning_group_id},
          ${session.id}, ${nodeId},
          ${PROGRESS_KIND[input.nodeProgress[nodeId]!]},
          ${tx.json({ progress: input.nodeProgress[nodeId] } as never)},
          ${occurredAt}, ${input.actorUserId}
        )
      `;
    }

    const eventId = uuidv7();
    await appendOutboxEvent(tx, {
      eventId,
      organizationId: input.organizationId,
      aggregateType: "session",
      aggregateId: session.id,
      aggregateVersion: 1,
      eventType: "SessionCompleted",
      occurredAt,
      payload: {
        sessionId: session.id,
        learningGroupId: session.learning_group_id,
        sessionDate: session.session_date,
        timezoneId: session.timezone,
        teacherId: session.teacher_user_id,
        closedBy: input.actorUserId,
        startedAt: session.starts_at,
        completedAt: occurredAt.toISOString(),
        coverage,
        note: input.note ?? null,
        progressSummary: {
          completedNodeIds: bucket("completed"),
          partialNodeIds: bucket("partial"),
          skippedNodeIds: bucket("skipped"),
        },
      },
    });

    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, after
      ) values (
        ${uuidv7()}, ${input.organizationId}, 'user', ${input.actorUserId},
        'session.close', 'session', ${session.id}, ${input.note ?? null},
        ${tx.json({ coverage, progress: input.nodeProgress } as never)}
      )
    `;

    return {
      ok: true,
      message:
        coverage === "full"
          ? "수업을 마감했습니다."
          : "수업을 마감했습니다 — 남은 진도는 다음 일정에 반영됩니다.",
      sessionId: session.id,
      coverage,
      eventId,
    };
  }) as Promise<CloseSessionResult>;
}
