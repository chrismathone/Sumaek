import "server-only";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import {
  selectQuestions,
  type PoolQuestion,
  type SelectionBucket,
} from "@su-maek/core/assessment";
import type { IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 일일테스트 자동 생성 (시퀀스 3 · 17장 · 2I).
 *
 * - 출제 풀: 검수 완료 + 사용 권한 유효 + 자동 출제 가능 문항만 (원칙 9).
 * - 버킷: 오늘 개념 / 약점 / 오답·간격 복습 — 정책 비율. 부족은 조용히
 *   메우지 않고 결과에 표시한다.
 * - 게시 시 QuestionVersion·정답·배점·개념 가중치·선정 이유를 스냅샷으로
 *   고정한다 (불변 조건 8).
 * - 멱등: (조직·그룹·날짜·목적) 유니크 — 같은 요청 재실행은 기존 평가 반환.
 * ───────────────────────────────────────────────────────────── */

export interface GenerateResult {
  ok: boolean;
  message: string;
  assessmentId: string | null;
  questionCount: number;
  shortfalls: Array<{ reason: string; requested: number; selected: number }>;
  assignedLearners: number;
  deduplicated: boolean;
}

export async function generateDailyTest(options: {
  organizationId: string;
  learningGroupId: string;
  targetDate: IsoDate;
  actorUserId: string;
}): Promise<GenerateResult> {
  const sql = getSharedSql();
  const { organizationId, learningGroupId, targetDate } = options;

  /* 멱등 검사 — 이미 있으면 그대로 반환 (17장) */
  const [existing] = await sql<{ id: string; cnt: number }[]>`
    select a.id,
      (select count(*)::int from assessment_questions q where q.assessment_id = a.id) as cnt
    from assessment_instances a
    where a.organization_id = ${organizationId}
      and a.learning_group_id = ${learningGroupId}
      and a.scheduled_date = ${targetDate}
      and a.purpose = 'formative'
      and a.status <> 'cancelled'
    limit 1
  `;
  if (existing) {
    return {
      ok: true,
      message: `이미 생성된 일일테스트가 있습니다 (${existing.cnt}문항). 같은 요청은 중복 생성하지 않습니다.`,
      assessmentId: existing.id,
      questionCount: existing.cnt,
      shortfalls: [],
      assignedLearners: 0,
      deduplicated: true,
    };
  }

  /* 정책 */
  const [policy] = await sql<
    {
      id: string;
      version: number;
      question_count: number;
      time_limit_minutes: number | null;
      pool_weights: Record<string, number>;
      constraints: {
        difficultyDistribution?: { low: number; mid: number; high: number };
        noRepeatWithinDays?: number;
      };
    }[]
  >`
    select id, version, question_count, time_limit_minutes, pool_weights, constraints
    from assessment_policies
    where organization_id = ${organizationId} and purpose = 'formative' and is_active = true
    order by version desc limit 1
  `;
  if (!policy) {
    return fail("활성 일일테스트 정책이 없습니다. 설정에서 평가 정책을 만드세요.");
  }

  /* 해당 날짜 수업의 개념 (오늘 학습 버킷 기준) */
  const [session] = await sql<{ planned_node_ids: unknown }[]>`
    select planned_node_ids from sessions
    where organization_id = ${organizationId}
      and learning_group_id = ${learningGroupId}
      and session_date = ${targetDate}
    limit 1
  `;
  if (!session) {
    return fail(
      `${targetDate}에 예정된 수업이 없습니다. 먼저 학습 루트에서 일정을 생성하세요.`,
    );
  }
  const nodeIds = Array.isArray(session.planned_node_ids)
    ? (session.planned_node_ids as string[])
    : [];
  const todayConcepts = await sql<{ concept_id: string }[]>`
    select distinct jsonb_array_elements_text(concept_ids) as concept_id
    from route_nodes where id = any(${nodeIds})
  `;
  const todayConceptIds = todayConcepts.map((c) => c.concept_id);

  /* 출제 풀 — 자동 출제 조건 (16장): 게시·권한·게이트 통과 문항만 */
  const pool = await sql<
    {
      question_id: string;
      version_id: string;
      concept_ids: string[];
      band: string | null;
      last_used_on: string | null;
      exposure: number;
    }[]
  >`
    select q.id as question_id, q.current_version_id as version_id,
           coalesce(array_agg(a.concept_id::text) filter (where a.concept_id is not null), '{}') as concept_ids,
           v.difficulty->>'band' as band,
           (select max(aq.created_at)::date::text from assessment_questions aq
             where aq.question_id = q.id) as last_used_on,
           (select count(*)::int from assessment_questions aq
             where aq.question_id = q.id) as exposure
    from questions q
    join question_versions v on v.id = q.current_version_id
    join content_rights r on r.id = q.content_right_id and r.status = 'usable'
    left join question_alignments a on a.question_id = q.id
    where q.organization_id = ${organizationId}
      and q.review_status = 'published'
      and q.is_auto_assignable = true
    group by q.id, q.current_version_id, v.difficulty
  `;

  const toPoolQuestion = (row: (typeof pool)[number]): PoolQuestion => ({
    questionId: row.question_id,
    questionVersionId: row.version_id,
    conceptIds: row.concept_ids,
    difficultyBand: (row.band ?? "mid") as "low" | "mid" | "high",
    lastUsedOn: row.last_used_on,
    exposureCount: row.exposure,
  });

  const todaySet = new Set(todayConceptIds);
  const todayPool = pool.filter((r) => r.concept_ids.some((c) => todaySet.has(c)));
  const otherPool = pool.filter((r) => !r.concept_ids.some((c) => todaySet.has(c)));

  /* 약점·복습 풀 — 숙련도 낮은 개념·기한 도래 복습 항목 (그룹 학습자 기준) */
  const weakConcepts = await sql<{ concept_id: string }[]>`
    select distinct cm.concept_id::text as concept_id
    from concept_masteries cm
    join learning_group_memberships m
      on m.learner_id = cm.learner_id and m.learning_group_id = ${learningGroupId} and m.status = 'active'
    where cm.organization_id = ${organizationId}
      and cm.state in ('exploring', 'partial', 'recheck_needed')
  `;
  const weakSet = new Set(weakConcepts.map((w) => w.concept_id));
  const weaknessPool = otherPool.filter((r) =>
    r.concept_ids.some((c) => weakSet.has(c)),
  );

  const reviewQuestionRows = await sql<{ question_id: string }[]>`
    select distinct ri.question_id::text as question_id
    from review_items ri
    join learning_group_memberships m
      on m.learner_id = ri.learner_id and m.learning_group_id = ${learningGroupId} and m.status = 'active'
    where ri.organization_id = ${organizationId}
      and ri.status = 'scheduled' and ri.due_on <= ${targetDate}
      and ri.question_id is not null
  `;
  const reviewSet = new Set(reviewQuestionRows.map((r) => r.question_id));
  const reviewPool = pool.filter((r) => reviewSet.has(r.question_id));
  // 복습 풀이 비면 누적 복습으로 폴백 (오늘 개념 밖 전체)
  const cumulativePool = reviewPool.length > 0 ? reviewPool : otherPool;

  /* 버킷 수량 — 정책 비율을 문항 수로 환산 (큰 몫부터) */
  const weights = policy.pool_weights;
  const total = policy.question_count;
  const wToday = weights.today_concept ?? 50;
  const wWeak = weights.weakness ?? 30;
  const wReview = weights.review ?? 20;
  const wSum = wToday + wWeak + wReview;
  const nToday = Math.round((wToday / wSum) * total);
  const nWeak = Math.round((wWeak / wSum) * total);
  const nReview = Math.max(0, total - nToday - nWeak);

  const buckets: SelectionBucket[] = [
    { reason: "today_concept", count: nToday, candidates: todayPool.map(toPoolQuestion) },
    { reason: "weakness", count: nWeak, candidates: weaknessPool.map(toPoolQuestion) },
    {
      reason: reviewPool.length > 0 ? "wrong_answer_review" : "cumulative",
      count: nReview,
      candidates: cumulativePool.map(toPoolQuestion),
    },
  ];

  const excludeUsedSince = policy.constraints.noRepeatWithinDays
    ? shiftDate(targetDate, -policy.constraints.noRepeatWithinDays)
    : undefined;

  const seed = `daily:${learningGroupId}:${targetDate}:${policy.id}:v${policy.version}`;
  const selection = selectQuestions(
    buckets,
    {
      ...(policy.constraints.difficultyDistribution
        ? { difficultyDistribution: policy.constraints.difficultyDistribution }
        : {}),
      ...(excludeUsedSince ? { excludeUsedSince } : {}),
      maxPerConcept: 3,
    },
    seed,
  );

  if (selection.selected.length === 0) {
    return fail(
      "선정 가능한 문항이 없습니다. 문제은행의 검수·사용 권한 상태를 확인하세요.",
    );
  }

  /* 학습자 명단 */
  const learners = await sql<{ learner_id: string }[]>`
    select learner_id from learning_group_memberships
    where organization_id = ${organizationId}
      and learning_group_id = ${learningGroupId} and status = 'active'
  `;

  /* 게시 — 스냅샷 고정 (원자적) */
  const assessmentId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into assessment_instances (
        id, organization_id, policy_id, policy_version, purpose, title,
        learning_group_id, scheduled_date, status, generation_seed,
        generation_context, time_limit_minutes, total_points,
        published_at, published_by
      ) values (
        ${assessmentId}, ${organizationId}, ${policy.id}, ${policy.version},
        'formative', ${`일일테스트 · ${targetDate}`},
        ${learningGroupId}, ${targetDate}, 'published', ${seed},
        ${tx.json({
          inputHash: selection.inputHash,
          outputHash: selection.outputHash,
          shortfalls: selection.shortfalls,
          todayConceptIds,
        } as never)},
        ${policy.time_limit_minutes}, ${selection.selected.length * 10},
        now(), ${options.actorUserId}
      )
    `;

    let order = 1;
    for (const sel of selection.selected) {
      const [version] = await tx<
        {
          answer: unknown;
          rubric: unknown;
          points: string | null;
          content_checksum: string;
        }[]
      >`
        select answer, rubric, points, content_checksum
        from question_versions where id = ${sel.questionVersionId}
      `;
      const weights = await tx<{ concept_id: string; weight: string }[]>`
        select concept_id::text, weight::text from question_alignments
        where question_id = ${sel.questionId}
      `;
      await tx`
        insert into assessment_questions (
          id, organization_id, assessment_id, question_id, question_version_id,
          content_checksum, sort_order, points, answer_snapshot, rubric_snapshot,
          concept_weights, selection_reason
        ) values (
          ${uuidv7()}, ${organizationId}, ${assessmentId}, ${sel.questionId},
          ${sel.questionVersionId}, ${version?.content_checksum ?? ""},
          ${order}, ${version?.points ?? "10"},
          ${tx.json((version?.answer ?? null) as never)},
          ${tx.json((version?.rubric ?? null) as never)},
          ${tx.json(Object.fromEntries(weights.map((w) => [w.concept_id, Number(w.weight)])) as never)},
          ${sel.reason}
        )
      `;
      order++;
    }

    for (const l of learners) {
      await tx`
        insert into assignments (id, organization_id, assessment_id, learner_id, mode, assigned_by)
        values (${uuidv7()}, ${organizationId}, ${assessmentId}, ${l.learner_id}, 'online', ${options.actorUserId})
        on conflict (assessment_id, learner_id) do nothing
      `;
    }

    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${organizationId}, 'assessment', ${assessmentId}, 1,
        'AssessmentPublished', now(),
        ${tx.json({
          assessmentId,
          purpose: "formative",
          learningGroupId,
          learnerId: null,
          questionCount: selection.selected.length,
        } as never)}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, reason, after
      ) values (
        ${uuidv7()}, ${organizationId}, 'user', ${options.actorUserId},
        'assessment.generate-publish', 'assessment', ${assessmentId},
        '일일테스트 자동 생성·게시',
        ${tx.json({ seed, count: selection.selected.length, shortfalls: selection.shortfalls } as never)}
      )
    `;
  });

  return {
    ok: true,
    message: `일일테스트 ${selection.selected.length}문항을 생성·게시하고 ${learners.length}명에게 배정했습니다.`,
    assessmentId,
    questionCount: selection.selected.length,
    shortfalls: selection.shortfalls.map((s) => ({
      reason: s.reason,
      requested: s.requested,
      selected: s.selected,
    })),
    assignedLearners: learners.length,
    deduplicated: false,
  };
}

/**
 * 확인테스트 생성 (2N) — 루트 단원 개념 전체를 커버하는 공통 앵커 +
 * 누적 연결 문항. 통과·재시험 규칙은 정책(passing_rules) 버전으로 고정된다.
 */
export async function generateConfirmationTest(options: {
  organizationId: string;
  learningGroupId: string;
  targetDate: IsoDate;
  actorUserId: string;
}): Promise<GenerateResult> {
  const sql = getSharedSql();
  const { organizationId, learningGroupId, targetDate } = options;

  const [existing] = await sql<{ id: string; cnt: number }[]>`
    select a.id,
      (select count(*)::int from assessment_questions q where q.assessment_id = a.id) as cnt
    from assessment_instances a
    where a.organization_id = ${organizationId}
      and a.learning_group_id = ${learningGroupId}
      and a.scheduled_date = ${targetDate}
      and a.purpose = 'confirmation'
      and a.status <> 'cancelled'
    limit 1
  `;
  if (existing) {
    return {
      ok: true,
      message: `이미 생성된 확인테스트가 있습니다 (${existing.cnt}문항).`,
      assessmentId: existing.id,
      questionCount: existing.cnt,
      shortfalls: [],
      assignedLearners: 0,
      deduplicated: true,
    };
  }

  const [policy] = await sql<
    {
      id: string;
      version: number;
      question_count: number;
      time_limit_minutes: number | null;
      constraints: { noRepeatWithinDays?: number };
      passing_rules: { passRatio?: number; maxAttempts?: number } | null;
    }[]
  >`
    select id, version, question_count, time_limit_minutes, constraints, passing_rules
    from assessment_policies
    where organization_id = ${organizationId} and purpose = 'confirmation' and is_active = true
    order by version desc limit 1
  `;
  if (!policy) {
    return fail("활성 확인테스트 정책이 없습니다.");
  }

  /* 단원 개념 전체 — 게시된 루트 버전의 모든 노드 개념 */
  const [plan] = await sql<{ active_version_id: string | null }[]>`
    select active_version_id from route_plans
    where organization_id = ${organizationId}
      and learning_group_id = ${learningGroupId} and status = 'published'
    order by updated_at desc limit 1
  `;
  if (!plan?.active_version_id) {
    return fail("게시된 루트가 없습니다.");
  }
  const unitConcepts = await sql<{ concept_id: string }[]>`
    select distinct jsonb_array_elements_text(concept_ids) as concept_id
    from route_nodes where route_version_id = ${plan.active_version_id}
  `;
  const unitSet = new Set(unitConcepts.map((c) => c.concept_id));

  const pool = await sql<
    {
      question_id: string;
      version_id: string;
      concept_ids: string[];
      band: string | null;
      last_used_on: string | null;
      exposure: number;
    }[]
  >`
    select q.id as question_id, q.current_version_id as version_id,
           coalesce(array_agg(a.concept_id::text) filter (where a.concept_id is not null), '{}') as concept_ids,
           v.difficulty->>'band' as band,
           (select max(aq.created_at)::date::text from assessment_questions aq
             where aq.question_id = q.id) as last_used_on,
           (select count(*)::int from assessment_questions aq
             where aq.question_id = q.id) as exposure
    from questions q
    join question_versions v on v.id = q.current_version_id
    join content_rights r on r.id = q.content_right_id and r.status = 'usable'
    left join question_alignments a on a.question_id = q.id
    where q.organization_id = ${organizationId}
      and q.review_status = 'published'
      and q.is_auto_assignable = true
    group by q.id, q.current_version_id, v.difficulty
  `;
  const unitPool = pool
    .filter((r) => r.concept_ids.some((c) => unitSet.has(c)))
    .map((row) => ({
      questionId: row.question_id,
      questionVersionId: row.version_id,
      conceptIds: row.concept_ids,
      difficultyBand: (row.band ?? "mid") as "low" | "mid" | "high",
      lastUsedOn: row.last_used_on,
      exposureCount: row.exposure,
    }));

  const seed = `confirmation:${learningGroupId}:${targetDate}:v${policy.version}`;
  const selection = selectQuestions(
    [{ reason: "anchor", count: policy.question_count, candidates: unitPool }],
    { maxPerConcept: 2 },
    seed,
  );
  if (selection.selected.length === 0) {
    return fail("선정 가능한 문항이 없습니다.");
  }

  const learners = await sql<{ learner_id: string }[]>`
    select learner_id from learning_group_memberships
    where organization_id = ${organizationId}
      and learning_group_id = ${learningGroupId} and status = 'active'
  `;

  const assessmentId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into assessment_instances (
        id, organization_id, policy_id, policy_version, purpose, title,
        learning_group_id, scheduled_date, status, generation_seed,
        generation_context, time_limit_minutes, total_points,
        published_at, published_by
      ) values (
        ${assessmentId}, ${organizationId}, ${policy.id}, ${policy.version},
        'confirmation', ${`확인테스트 · ${targetDate}`},
        ${learningGroupId}, ${targetDate}, 'published', ${seed},
        ${tx.json({
          inputHash: selection.inputHash,
          outputHash: selection.outputHash,
          shortfalls: selection.shortfalls,
          passingRules: policy.passing_rules,
        } as never)},
        ${policy.time_limit_minutes}, ${selection.selected.length * 10},
        now(), ${options.actorUserId}
      )
    `;
    let order = 1;
    for (const sel of selection.selected) {
      const [version] = await tx<
        { answer: unknown; rubric: unknown; points: string | null; content_checksum: string }[]
      >`
        select answer, rubric, points, content_checksum
        from question_versions where id = ${sel.questionVersionId}
      `;
      const weights = await tx<{ concept_id: string; weight: string }[]>`
        select concept_id::text, weight::text from question_alignments
        where question_id = ${sel.questionId}
      `;
      await tx`
        insert into assessment_questions (
          id, organization_id, assessment_id, question_id, question_version_id,
          content_checksum, sort_order, points, answer_snapshot, rubric_snapshot,
          concept_weights, selection_reason, is_anchor
        ) values (
          ${uuidv7()}, ${organizationId}, ${assessmentId}, ${sel.questionId},
          ${sel.questionVersionId}, ${version?.content_checksum ?? ""},
          ${order}, ${version?.points ?? "10"},
          ${tx.json((version?.answer ?? null) as never)},
          ${tx.json((version?.rubric ?? null) as never)},
          ${tx.json(Object.fromEntries(weights.map((w) => [w.concept_id, Number(w.weight)])) as never)},
          'anchor', true
        )
      `;
      order++;
    }
    for (const l of learners) {
      await tx`
        insert into assignments (id, organization_id, assessment_id, learner_id, mode, assigned_by)
        values (${uuidv7()}, ${organizationId}, ${assessmentId}, ${l.learner_id}, 'online', ${options.actorUserId})
        on conflict (assessment_id, learner_id) do nothing
      `;
    }
    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${organizationId}, 'assessment', ${assessmentId}, 1,
        'AssessmentPublished', now(),
        ${tx.json({ assessmentId, purpose: "confirmation", learningGroupId, learnerId: null, questionCount: selection.selected.length } as never)}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, reason, after
      ) values (
        ${uuidv7()}, ${organizationId}, 'user', ${options.actorUserId},
        'assessment.generate-publish', 'assessment', ${assessmentId},
        '확인테스트 생성·게시', ${tx.json({ seed, count: selection.selected.length } as never)}
      )
    `;
  });

  return {
    ok: true,
    message: `확인테스트 ${selection.selected.length}문항을 생성·게시하고 ${learners.length}명에게 배정했습니다.`,
    assessmentId,
    questionCount: selection.selected.length,
    shortfalls: selection.shortfalls.map((s) => ({
      reason: s.reason,
      requested: s.requested,
      selected: s.selected,
    })),
    assignedLearners: learners.length,
    deduplicated: false,
  };
}

function fail(message: string): GenerateResult {
  return {
    ok: false,
    message,
    assessmentId: null,
    questionCount: 0,
    shortfalls: [],
    assignedLearners: 0,
    deduplicated: false,
  };
}

function shiftDate(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
