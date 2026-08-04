import { getSharedSql } from "@su-maek/db";
import { BLOCK_REASONS } from "@su-maek/core/learning";
import { teacherBlockText } from "./learning-readiness";

/* ─────────────────────────────────────────────────────────────
 * 교사가 보는 오늘 — 반 단위 하루 진행 (T4.4).
 *
 * T4.1이 학생의 하루 완료를 기록으로 만들었지만, 그 기록을 **반 단위로**
 * 볼 곳이 없었다. 학습자 상세에 한 학생의 세로 기록만 있고 가로로 자르는
 * 화면은 없어서, 교사는 서른 명을 한 명씩 눌러 봐야 했다.
 *
 * 이 파일은 판정만 한다 — 질의도 문구도 여기 없다. 순수하게 두는 이유는
 * `/app/today`(전체)와 반 상세(한 반)가 **같은 규칙**으로 접어야 하기
 * 때문이다. 두 화면이 각자 세면 같은 반이 두 수를 갖는다.
 * ───────────────────────────────────────────────────────────── */

/**
 * 학생 한 명의 오늘 상태.
 *
 * `no_record`가 `not_started`와 따로 있는 것이 이 타입의 핵심이다.
 * 미시작은 계획이 있는데 아직 안 한 것이고, 기록 없음은 학생이 오늘 화면을
 * **한 번도 열지 않아** 계획 자체가 없는 것이다. 후자는 대개 로그인·계정
 * 문제이고 교사가 할 일이 다르다 — 합치면 계정이 안 열린 학생이 「게으른
 * 학생」이 된다.
 */
export type LearnerDayStatus =
  | "completed"
  | "in_progress"
  | "blocked"
  | "not_started"
  | "no_record";

export interface LearnerDayRow {
  learnerId: string;
  displayName: string;
  status: LearnerDayStatus;
  completedAt: string | null;
  requiredTotal: number;
  requiredSatisfied: number;
  requiredBlocked: number;
  /** 막힌 필수 항목의 사유 코드 (중복 가능 — 항목 단위로 온다) */
  blockedReasons: string[];
  lastActivityAt: string | null;
}

/**
 * 막힘 사유의 갈래.
 *
 * 「막힘 2명」만으로는 교사가 아무것도 못 한다. 자료를 올려야 하는 것과
 * 계정을 연결해야 하는 것은 가는 화면이 다르다.
 */
export type BlockCategory =
  /** 사람이 자료를 안 올렸다 */
  | "material"
  /** 문항이 없다 */
  | "question"
  /** 자동 생성이 못 따라왔다 — T3.4의 복구 화면이 있다 */
  | "assessment"
  /** 로그인 계정이 연결되지 않았다 */
  | "account"
  /** 교재 사용 권한이 끊겼다 */
  | "rights"
  | "unknown";

const CATEGORY_OF: Readonly<Record<string, BlockCategory>> = {
  [BLOCK_REASONS.materialMissing]: "material",
  [BLOCK_REASONS.noQuestions]: "question",
  [BLOCK_REASONS.bookRangeIncomplete]: "material",
  [BLOCK_REASONS.homeworkModeMissing]: "material",
  [BLOCK_REASONS.assessmentNotGenerated]: "assessment",
  no_assessment_policy: "assessment",
  account_unlinked: "account",
  rights_expired: "rights",
};

/** 모르는 코드를 조용히 자료 결손으로 뭉개지 않는다 — 갈래가 틀리면 교사가 엉뚱한 화면에 간다. */
export function blockCategory(code: string): BlockCategory {
  return CATEGORY_OF[code] ?? "unknown";
}

/** 교사 화면의 사유 문구 — 학생 문구와 다른 말을 쓴다 (할 일이 다르다). */
export function blockReasonText(code: string): string {
  return teacherBlockText(code);
}

export interface BlockedReasonTally {
  code: string;
  category: BlockCategory;
  /** 이 사유로 막힌 **학생 수** — 항목 수가 아니다 */
  learners: number;
}

export interface DayProgressSummary {
  total: number;
  counts: Record<LearnerDayStatus, number>;
  /** 많은 것부터, 같으면 코드 사전순 */
  blocked: BlockedReasonTally[];
  /**
   * 교사가 먼저 볼 학생.
   *
   * 완주·진행 중은 오지 않는다 — 교사가 할 일이 없다. 서른 줄을 그냥
   * 늘어놓으면 완주한 스물여덟 명이 막힌 두 명을 덮는다.
   */
  attention: LearnerDayRow[];
}

/** 먼저 볼 순서 — 막힘 > 기록 없음 > 미시작. 나머지는 목록에 오지 않는다. */
const ATTENTION_ORDER: Readonly<Record<string, number>> = {
  blocked: 0,
  no_record: 1,
  not_started: 2,
};

export function summarizeDayProgress(
  rows: readonly LearnerDayRow[],
): DayProgressSummary {
  const counts: Record<LearnerDayStatus, number> = {
    completed: 0,
    in_progress: 0,
    blocked: 0,
    not_started: 0,
    no_record: 0,
  };

  /* 사유별 **학생** 집합. 항목 수로 세면 같은 학생이 두 항목 막혔을 때 두
   * 명이 되고, 「막힘 2명」이 학생 수보다 커진다 — 그 순간 교사는 이 수를
   * 믿지 않는다. */
  const byReason = new Map<string, Set<string>>();
  const attention: LearnerDayRow[] = [];

  for (const r of rows) {
    counts[r.status] += 1;
    for (const code of r.blockedReasons) {
      const set = byReason.get(code) ?? new Set<string>();
      set.add(r.learnerId);
      byReason.set(code, set);
    }
    if (r.status in ATTENTION_ORDER) attention.push(r);
  }

  const blocked = [...byReason.entries()]
    .map(([code, learners]) => ({
      code,
      category: blockCategory(code),
      learners: learners.size,
    }))
    .sort((a, b) =>
      a.learners !== b.learners
        ? b.learners - a.learners
        : a.code < b.code
          ? -1
          : 1,
    );

  attention.sort((a, b) => {
    const ao = ATTENTION_ORDER[a.status]!;
    const bo = ATTENTION_ORDER[b.status]!;
    if (ao !== bo) return ao - bo;
    /* 같은 상태끼리는 이름순 — 볼 때마다 순서가 바뀌면 교사가 어제 본 줄을
     * 다시 찾지 못한다. */
    if (a.displayName !== b.displayName) {
      return a.displayName < b.displayName ? -1 : 1;
    }
    return a.learnerId < b.learnerId ? -1 : 1;
  });

  return { total: rows.length, counts, blocked, attention };
}

/* ── 읽기 모델 ─────────────────────────────────────────────
 *
 * 질의를 판정과 같은 파일에 두되 아래에 몰아 둔다 — 위쪽 순수 함수는 DB
 * 없이 테스트되고(`test/ui/teacher-day-progress.test.ts`), 아래쪽은 그
 * 함수가 먹을 행을 만드는 일만 한다.
 * ────────────────────────────────────────────────────────── */

/** 반 하나의 하루 — 학생별 상태와 반 수업 마감 여부를 함께 낸다. */
export interface GroupDayProgress {
  learningGroupId: string;
  learningGroupName: string;
  learners: LearnerDayRow[];
  summary: DayProgressSummary;
  /**
   * 그날 이 반의 수업 상태.
   *
   * 학생 완료와 **다른 상태로** 보여야 한다 (I-21 · ADR-0017 §1). 서른 명이
   * 다 끝냈어도 교사가 마감하지 않았으면 반 수업은 끝나지 않은 것이고,
   * 반이 마감됐어도 학생 하루는 각자다.
   */
  session: {
    sessionId: string;
    status: string;
    closedAt: string | null;
  } | null;
}

/**
 * 날짜 하나에 대한 반별 학생 진행.
 *
 * `learning_group_memberships`에서 시작한다 — `learner_day_plans`에서
 * 시작하면 **오늘 화면을 한 번도 열지 않은 학생이 목록에서 통째로 빠진다.**
 * 그 학생이야말로 교사가 가장 먼저 봐야 할 사람이다(`no_record`).
 */
export async function listGroupDayProgress(input: {
  organizationId: string;
  date: string;
  learningGroupId?: string | null;
}): Promise<GroupDayProgress[]> {
  const sql = getSharedSql();
  const rows = await sql<
    {
      learning_group_id: string;
      group_name: string;
      learner_id: string;
      display_name: string;
      plan_status: string | null;
      completed_at: string | null;
      required_total: number;
      required_satisfied: number;
      required_blocked: number;
      blocked_reasons: string[] | null;
      last_activity_at: string | null;
      session_id: string | null;
      session_status: string | null;
      session_closed_at: string | null;
    }[]
  >`
    select g.id::text        as learning_group_id,
           g.name            as group_name,
           l.id::text        as learner_id,
           l.display_name,
           p.status::text    as plan_status,
           p.completed_at::text,
           coalesce(i.required_total, 0)     as required_total,
           coalesce(i.required_satisfied, 0) as required_satisfied,
           coalesce(i.required_blocked, 0)   as required_blocked,
           i.blocked_reasons,
           i.last_activity_at::text,
           s.id::text        as session_id,
           s.status::text    as session_status,
           pe.occurred_at::text as session_closed_at
    from learning_group_memberships m
    join learning_groups g on g.id = m.learning_group_id
    join learners l on l.id = m.learner_id
    left join learner_day_plans p
      on p.organization_id = m.organization_id
     and p.learner_id = m.learner_id
     and p.plan_date = ${input.date}::date
    left join lateral (
      select count(*) filter (where it.required)::int as required_total,
             count(*) filter (
               where it.required and it.status in ('completed', 'exempted')
             )::int as required_satisfied,
             count(*) filter (where it.required and it.status = 'blocked')::int
               as required_blocked,
             array_remove(
               array_agg(distinct it.blocked_reason)
                 filter (where it.status = 'blocked'),
               null
             ) as blocked_reasons,
             max(it.updated_at) as last_activity_at
      from learner_day_plan_items it
      where it.learner_day_plan_id = p.id
    ) i on true
    left join lateral (
      select ss.id, ss.status
      from sessions ss
      where ss.organization_id = m.organization_id
        and ss.learning_group_id = g.id
        and ss.session_date = ${input.date}::date
        and ss.status <> 'cancelled'
      order by ss.starts_at
      limit 1
    ) s on true
    left join lateral (
      select p2.occurred_at from progress_events p2
      where p2.session_id = s.id and p2.kind = 'session_closed'
      order by p2.occurred_at desc limit 1
    ) pe on true
    where m.organization_id = ${input.organizationId}
      and m.status = 'active'
      and g.status = 'operating'
      and (${input.learningGroupId ?? null}::uuid is null
           or g.id = ${input.learningGroupId ?? null}::uuid)
    order by g.name, l.display_name, l.id
  `;

  const byGroup = new Map<string, GroupDayProgress>();
  for (const r of rows) {
    let entry = byGroup.get(r.learning_group_id);
    if (!entry) {
      entry = {
        learningGroupId: r.learning_group_id,
        learningGroupName: r.group_name,
        learners: [],
        summary: summarizeDayProgress([]),
        session: r.session_id
          ? {
              sessionId: r.session_id,
              status: r.session_status ?? "planned",
              closedAt: r.session_closed_at,
            }
          : null,
      };
      byGroup.set(r.learning_group_id, entry);
    }
    entry.learners.push({
      learnerId: r.learner_id,
      displayName: r.display_name,
      /* 계획 행이 없으면 「미시작」이 아니라 「기록 없음」이다 — 학생이
       * 오늘 화면을 한 번도 열지 않았다는 뜻이고, 대개 로그인 문제다. */
      status: (r.plan_status ?? "no_record") as LearnerDayStatus,
      completedAt: r.completed_at,
      requiredTotal: r.required_total,
      requiredSatisfied: r.required_satisfied,
      requiredBlocked: r.required_blocked,
      blockedReasons: r.blocked_reasons ?? [],
      lastActivityAt: r.last_activity_at,
    });
  }

  for (const entry of byGroup.values()) {
    entry.summary = summarizeDayProgress(entry.learners);
  }
  return [...byGroup.values()];
}
