import type postgres from "postgres";
import { todayInKst, type IsoDate } from "@su-maek/core/shared";
import {
  ASSESSMENT_GENERATE_TOPIC,
  ASSESSMENT_GENERATION_SWITCH,
} from "../kill-switch";
import { enqueueJob } from "../queue";

export { ASSESSMENT_GENERATE_TOPIC, ASSESSMENT_GENERATION_SWITCH };

/* ─────────────────────────────────────────────────────────────
 * 평가 자동 생성의 주기 생산자 (T3.2 · G-04 · ADR-0018 §5).
 *
 * 지금까지 일일·확인테스트는 **교사가 버튼을 눌러야만** 생겼다. 생성 서비스는
 * 처음부터 있었는데 부르는 곳이 화면 하나뿐이었다 — 선생님이 잊으면 학생은
 * 그날 시험 칸을 영원히 기다린다. 노드 실행기가 그것을
 * `assessment_not_generated`로 막아 결손이 보이기는 하지만, 보이는 것과
 * 낫는 것은 다른 일이다.
 *
 * 여기서 하는 일은 하나다: **곧 있을 수업 중 평가 노드가 있는데 아직 평가가
 * 없는 것**을 찾아 작업을 만든다. 생성 자체는 하지 않는다 — 작업으로 넘겨야
 * 재시도·리스·kill switch·체크포인트가 전부 큐의 것이 된다.
 *
 * ── 멱등은 두 겹이다 ──────────────────────────────────────
 *   ① `jobs`의 dedupe 키가 같은 작업의 중복 enqueue를 막는다 (여기)
 *   ② `assessment_instances`의 유니크 인덱스가 작업이 중복 실행돼도 평가가
 *      둘 생기는 것을 막는다 (0018a — G-15에서 실제로 걸리게 고쳤다)
 * 한 겹으로 줄이지 않는다. ①만 있으면 워커 재시작 중 클레임된 작업이 다시
 * 돌 때 평가가 둘 생기고, ②만 있으면 중복 작업이 매번 DB까지 가서 충돌하고
 * 실패 로그를 남긴다.
 *
 * ── 미리 만들지 않는다 ────────────────────────────────────
 * 학기 초에 전부 만들어 두면 출제가 **그때의** 숙련도·복습으로 굳는다.
 * 그래서 창(lookahead)과 생성 시점(generateBeforeHours)을 둘 다 좁게 잡고,
 * 실제 출제는 작업이 **실행되는 시점에** 최신 상태를 읽는다.
 * ───────────────────────────────────────────────────────────── */

/** 평가 노드 종류 → 평가 목적. 두 종류 외에는 자동 생성 대상이 아니다. */
export const ASSESSMENT_PURPOSE_BY_NODE_KIND = {
  daily_test: "formative",
  confirmation_test: "confirmation",
} as const;

export type GeneratedAssessmentPurpose =
  (typeof ASSESSMENT_PURPOSE_BY_NODE_KIND)[keyof typeof ASSESSMENT_PURPOSE_BY_NODE_KIND];

/**
 * 며칠 앞까지 훑을지. 기본 3일 — 「수업 하루 전 생성」이 출발점이므로
 * 창은 그보다 조금 넓어야 워커가 몇 시간 죽어 있어도 놓치지 않는다.
 */
export const ASSESSMENT_LOOKAHEAD_DAYS = Number(
  process.env.ASSESSMENT_LOOKAHEAD_DAYS ?? 3,
);

/** 수업 시작 몇 시간 전에 만들지. 기본 24시간 (ADR-0018 「수업 하루 전」) */
export const ASSESSMENT_GENERATE_BEFORE_HOURS = Number(
  process.env.ASSESSMENT_GENERATE_BEFORE_HOURS ?? 24,
);

/** 생산자를 몇 초마다 돌릴지. 매 회차 훑으면 폴링 간격(2초)마다 스캔한다 */
export const ASSESSMENT_PRODUCER_INTERVAL_MS = Number(
  process.env.ASSESSMENT_PRODUCER_INTERVAL_MS ?? 60_000,
);

/** 한 회차에 만들 작업 수 상한 — 첫 배포 직후의 몰림을 흩는다 */
export const ASSESSMENT_PRODUCER_BATCH = Number(
  process.env.ASSESSMENT_PRODUCER_BATCH ?? 50,
);

/**
 * 작업 멱등 키 — **인덱스와 같은 모양이어야 한다** (ADR-0018 §5).
 *
 * `{topic}:{org}:{group ?? '-'}:{learner ?? '-'}:{date}:{purpose}`
 *
 * 학생 자리를 두는 이유: 학생 개별 보충 평가와 반 공통 일일테스트가 같은 날
 * 같은 반에 공존할 수 있다. 반 공통은 학생 자리가 `-`로 접힌다 —
 * `assessments_group_idempotent_uq`가 덮는 범위와 정확히 같다.
 */
export function assessmentJobKey(input: {
  organizationId: string;
  learningGroupId: string | null;
  learnerId: string | null;
  planDate: string;
  purpose: string;
}): string {
  return [
    ASSESSMENT_GENERATE_TOPIC,
    input.organizationId,
    input.learningGroupId ?? "-",
    input.learnerId ?? "-",
    input.planDate,
    input.purpose,
  ].join(":");
}

export interface DueAssessmentSession {
  sessionId: string;
  organizationId: string;
  learningGroupId: string;
  planDate: IsoDate;
  routeNodeId: string;
  nodeKind: keyof typeof ASSESSMENT_PURPOSE_BY_NODE_KIND;
  purpose: GeneratedAssessmentPurpose;
  /** 이 수업에 실제로 적용된 생성 선행 시간 (정책이 조정할 수 있다) */
  beforeHours: number;
  /** 이 조직의 자동 생성이 꺼져 있는가 — 꺼져 있으면 작업을 만들지 않는다 */
  switchedOff: boolean;
}

export interface FindDueAssessmentOptions {
  /** 한 조직으로 한정 — 테스트·단일 테넌트 재처리용. 기본은 전역 */
  organizationId?: string | null | undefined;
  today?: IsoDate | undefined;
  lookaheadDays?: number | undefined;
  generateBeforeHours?: number | undefined;
  limit?: number | undefined;
}

/**
 * 생성할 때가 된 수업×평가노드를 찾는다.
 *
 * 빠지는 것과 그 이유:
 *  - 취소·완료된 수업 — 할 일이 없다. `planned`와 `confirmed`만 본다.
 *    (ADR-0018 §5는 `planned`만 적었는데, 교사가 확정한 수업도 앞으로 있을
 *     수업이다. `confirmed`를 빼면 확정할수록 평가가 안 생긴다.)
 *  - 이미 (조직·반·날짜·목적) 평가가 있는 수업 — 만들 것이 없다. 이 조건이
 *    없으면 생성이 끝난 뒤에도 매 회차 같은 행을 훑는다.
 *  - `planned_node_ids`의 UUID가 아닌 항목 — 학습자 오버라이드의 자리표시자
 *    (`override:{id}:0`)가 여기 섞일 수 있고, 그대로 캐스팅하면 쿼리 전체가
 *    터진다. 한 학원의 오버라이드 하나가 **모든 조직의** 생성을 멈춘다.
 */
export async function findDueAssessmentSessions(
  sql: postgres.Sql,
  options: FindDueAssessmentOptions = {},
): Promise<DueAssessmentSession[]> {
  const today = options.today ?? todayInKst();
  const lookahead = options.lookaheadDays ?? ASSESSMENT_LOOKAHEAD_DAYS;
  const defaultHours =
    options.generateBeforeHours ?? ASSESSMENT_GENERATE_BEFORE_HOURS;
  const limit = options.limit ?? ASSESSMENT_PRODUCER_BATCH;
  const orgFilter = options.organizationId ?? null;

  const rows = await sql<
    {
      session_id: string;
      organization_id: string;
      learning_group_id: string;
      plan_date: string;
      route_node_id: string;
      node_kind: string;
      purpose: string;
      before_hours: number;
      switched_off: boolean;
    }[]
  >`
    select s.id::text as session_id,
           s.organization_id::text as organization_id,
           s.learning_group_id::text as learning_group_id,
           s.session_date::text as plan_date,
           n.id::text as route_node_id,
           n.kind::text as node_kind,
           pu.purpose,
           bh.before_hours,
           exists (
             select 1 from kill_switches k
             where k.key = ${ASSESSMENT_GENERATION_SWITCH}
               and k.enabled = false
               and (k.expires_at is null or k.expires_at > now())
               and (k.organization_id is null or k.organization_id = s.organization_id)
           ) as switched_off
    from sessions s
    join lateral jsonb_array_elements_text(s.planned_node_ids) as pn(node_id) on true
    join route_nodes n
      on n.id = pn.node_id::uuid
     and n.kind in ('daily_test', 'confirmation_test')
    cross join lateral (
      select case n.kind::text
               when 'daily_test' then 'formative'
               else 'confirmation'
             end as purpose
    ) pu
    cross join lateral (
      select coalesce((
        select (ap.constraints->>'generateBeforeHours')::numeric
        from assessment_policies ap
        where ap.organization_id = s.organization_id
          and ap.purpose::text = pu.purpose
          and ap.is_active = true
        order by ap.version desc
        limit 1
      ), ${defaultHours}::numeric) as before_hours
    ) bh
    where s.status in ('planned', 'confirmed')
      and s.session_date between ${today}::date
                             and ${today}::date + ${lookahead}::int
      and pn.node_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and now() >= s.starts_at - make_interval(mins => (bh.before_hours * 60)::int)
      and (${orgFilter}::uuid is null or s.organization_id = ${orgFilter}::uuid)
      and not exists (
        select 1 from assessment_instances a
        where a.organization_id = s.organization_id
          and a.learning_group_id = s.learning_group_id
          and a.scheduled_date = s.session_date
          and a.purpose::text = pu.purpose
          and a.learner_id is null
          and a.status <> 'cancelled'
      )
    order by s.starts_at, n.sort_order
    limit ${limit}
  `;

  return rows.map((r) => ({
    sessionId: r.session_id,
    organizationId: r.organization_id,
    learningGroupId: r.learning_group_id,
    planDate: r.plan_date as IsoDate,
    routeNodeId: r.route_node_id,
    nodeKind: r.node_kind as DueAssessmentSession["nodeKind"],
    purpose: r.purpose as GeneratedAssessmentPurpose,
    beforeHours: Number(r.before_hours),
    switchedOff: r.switched_off,
  }));
}

/** 작업 payload — 핸들러가 읽는 것과 정확히 같은 모양 */
export interface AssessmentGenerateJobPayload {
  organizationId: string;
  learningGroupId: string | null;
  learnerId: string | null;
  planDate: IsoDate;
  purpose: GeneratedAssessmentPurpose;
  sessionId?: string;
  routeNodeId?: string;
}

export interface ProduceAssessmentJobsResult {
  /** 훑어서 나온 due 수업×노드 수 */
  scanned: number;
  enqueued: number;
  /** 이미 같은 키의 작업이 있어 만들지 않은 수 */
  deduplicated: number;
  /** kill switch로 만들지 않은 수 — 0이 아니면 누군가 자동화를 껐다 */
  suppressed: number;
  /** 그 스위치가 걸린 조직 — 운영자가 어디인지 알아야 한다 */
  suppressedOrganizationIds: string[];
}

/**
 * due 수업을 훑어 생성 작업을 만든다.
 *
 * kill switch가 꺼진 조직은 **작업을 만들지 않고 건너뛴다.** 만들어 두고
 * 핸들러에서 미루는 방식과 다른 이유: 스위치를 끈 동안 큐에 작업이 계속
 * 쌓이면 복구 순간에 몇백 건이 한꺼번에 돈다. 이미 만들어진 작업은 그대로
 * 두므로(지우지 않는다) 유실은 없다.
 */
export async function produceAssessmentJobs(
  sql: postgres.Sql,
  options: FindDueAssessmentOptions = {},
): Promise<ProduceAssessmentJobsResult> {
  const due = await findDueAssessmentSessions(sql, options);
  const result: ProduceAssessmentJobsResult = {
    scanned: due.length,
    enqueued: 0,
    deduplicated: 0,
    suppressed: 0,
    suppressedOrganizationIds: [],
  };
  const suppressedOrgs = new Set<string>();

  for (const row of due) {
    if (row.switchedOff) {
      result.suppressed += 1;
      suppressedOrgs.add(row.organizationId);
      continue;
    }
    const payload: AssessmentGenerateJobPayload = {
      organizationId: row.organizationId,
      learningGroupId: row.learningGroupId,
      learnerId: null,
      planDate: row.planDate,
      purpose: row.purpose,
      sessionId: row.sessionId,
      routeNodeId: row.routeNodeId,
    };
    const { deduplicated } = await enqueueJob(sql, {
      topic: ASSESSMENT_GENERATE_TOPIC,
      organizationId: row.organizationId,
      payload,
      /* 실시간 채점(10)보다는 뒤, 일반 작업(100)보다는 앞. 수업 전에 끝나야
       * 의미가 있는 일이라 대량 반입에 밀리면 안 된다. */
      priority: 60,
      idempotencyKey: assessmentJobKey({
        organizationId: row.organizationId,
        learningGroupId: row.learningGroupId,
        learnerId: null,
        planDate: row.planDate,
        purpose: row.purpose,
      }),
    });
    if (deduplicated) result.deduplicated += 1;
    else result.enqueued += 1;
  }

  result.suppressedOrganizationIds = [...suppressedOrgs].sort();
  return result;
}
