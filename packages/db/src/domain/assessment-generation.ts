import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "../client";
import {
  selectQuestions,
  type PoolQuestion,
  type SelectionBucket,
} from "@su-maek/core/assessment";
import {
  DEFAULT_MASTERY_POLICY,
  predictedRetention,
  type MasteryPolicySpec,
} from "@su-maek/core/mastery";
import type { IsoDate } from "@su-maek/core/shared";
import {
  resolveAssessmentPolicy,
  type AssessmentPolicySource,
} from "./assessment-policy";

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

interface ObjectiveSnapshotRow {
  id: string;
  concept_id: string;
  statement: string;
  dimensions: unknown;
  evidences: Array<{ id: string; description: string }>;
}

/**
 * 블루프린트에 스냅샷할 학습 목표·기대 증거 (정렬 사슬 2N의 가운데 고리).
 * 전역 참조 데이터라 없을 수 있다 — 호출부는 공백(objectiveGaps)을 스펙에
 * 기록한다. 조용히 있는 척하지 않는다.
 */
async function loadObjectiveSnapshot(
  sql: ReturnType<typeof getSharedSql>,
  conceptIds: string[],
): Promise<ObjectiveSnapshotRow[]> {
  if (conceptIds.length === 0) return [];
  return sql<ObjectiveSnapshotRow[]>`
    select o.id::text as id, o.concept_id::text as concept_id, o.statement,
           o.dimensions,
           coalesce(
             jsonb_agg(jsonb_build_object('id', e.id, 'description', e.description)
                       order by e.id) filter (where e.id is not null),
             '[]'::jsonb
           ) as evidences
    from learning_objectives o
    left join assessment_evidences e on e.objective_id = o.id
    where o.concept_id = any(${conceptIds}::uuid[]) and o.status = 'active'
    group by o.id, o.concept_id, o.statement, o.dimensions
    order by o.concept_id, o.id
  `;
}

/**
 * 감사 행의 수행자 — 워커가 부르면 사람이 없다.
 *
 * `actor_type`을 `user`로 두고 `actor_id`만 null로 비우면 감사 기록이
 * "누군지 모르는 사람이 했다"가 된다. 자동 생성은 사람이 안 한 것이 사실이고,
 * 그 사실이 그대로 남아야 나중에 「왜 이 테스트가 있었나」에 답할 수 있다.
 */
function actorFields(actorUserId: string | null): {
  type: "user" | "automation";
  id: string | null;
} {
  return actorUserId
    ? { type: "user", id: actorUserId }
    : { type: "automation", id: null };
}

/** 무엇이 이 평가를 만들었는가 — 계획 연결 (T3.3) */
export interface PlanningSnapshot {
  planDate: IsoDate;
  sessionId: string | null;
  routeNodeId: string | null;
  policySource: AssessmentPolicySource;
}

/**
 * 생성 맥락에 남길 계획 연결.
 *
 * 이것이 없으면 생성된 평가만 남고 **근거가 없다.** 교사가 「이 시험은 왜
 * 있나 · 다음 주에 안 나오게 하려면 무엇을 고치나」에 답하려면 어느 수업의
 * 어느 노드가, 어느 정책으로 불렀는지가 필요하다. 교사가 화면에서 직접 누른
 * 생성에는 수업·노드가 없다 — 그때는 사람이 근거이고, null이 그 사실이다.
 */
function planningSnapshot(
  options: { sessionId?: string | null; routeNodeId?: string | null },
  planDate: IsoDate,
  policySource: AssessmentPolicySource,
): PlanningSnapshot {
  return {
    planDate,
    sessionId: options.sessionId ?? null,
    routeNodeId: options.routeNodeId ?? null,
    policySource,
  };
}

export async function generateDailyTest(options: {
  organizationId: string;
  learningGroupId: string;
  targetDate: IsoDate;
  /** 워커가 부르면 null — 감사 행이 `automation`으로 남는다 */
  actorUserId: string | null;
  /**
   * 이 평가를 부른 계획 — 수업과 루트 노드.
   *
   * 「이 시험은 왜 있나」에 답하려면 생성물만으로는 부족하다. 어느 수업의
   * 어느 노드가 불렀는지가 남아야 교사가 루트를 고쳐 다음 생성을 바꿀 수
   * 있다. 교사가 화면에서 직접 누른 생성에는 없다(그때는 사람이 근거다).
   */
  sessionId?: string | null;
  routeNodeId?: string | null;
  /**
   * 무반복 기간을 넘겨 최근 출제분도 후보로 쓴다.
   * 문항 수가 적은 학원에서는 연속 수업일마다 후보가 0이 되어 테스트를
   * 아예 만들 수 없다. 정책 편집 화면이 아직 없으므로, 선생님이 **그 사실을
   * 알고 명시적으로** 넘어갈 수단을 둔다. 조용히 넘어가지 않는다 —
   * 결과의 shortfalls에 남는다.
   */
  allowRecentlyUsed?: boolean;
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

  /* 정책 — 반 → 조직. 준비도 게이트가 보는 것과 **같은 해석**이다
   * (assessment-policy.ts). 게이트가 통과시킨 조건과 여기서 실패하는 조건이
   * 다르면, 교사는 게이트가 시킨 일을 하고도 여전히 실패한다. */
  const resolved = await resolveAssessmentPolicy(sql, {
    organizationId,
    learningGroupId,
    purpose: "formative",
  });
  if (!resolved) {
    return fail(
      "이 반에 적용할 일일테스트 정책이 없습니다. 반 설정의 평가 정책을 지정하거나 학원 기본 정책을 만드세요.",
    );
  }
  const policy = resolved.policy;
  const policySource: AssessmentPolicySource = resolved.source;

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
    left join question_alignments a
      on a.question_id = q.id
      /* ai_suggested(미검수 제안)는 개념 축이 아니다 — 승인돼야 풀에 잡힌다 */
      and a.provenance <> 'ai_suggested'
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

  /* 목표 유지율 θ는 조직 정책이 정한다 (ADR-0009 — 임계값 코드 상수 금지).
   * 정렬만 하는 값이라 정책이 없으면 기본값으로 계속 진행한다. */
  const [masteryPolicy] = await sql<{ spec: MasteryPolicySpec }[]>`
    select spec from mastery_policy_versions
    where organization_id = ${organizationId} and is_active = true
    order by version desc limit 1
  `;
  const masterySpec = masteryPolicy?.spec ?? DEFAULT_MASTERY_POLICY;

  /* 복습 후보 — **예측 기억률이 낮은 것부터**.
   *
   * 기한이 지났는지(due_on)는 예/아니오뿐이라 순서를 못 매긴다. 망각곡선의
   * R = exp(-t·ln(1/θ)/S)는 "얼마나 잊혔는가"로 줄을 세운다. 한 문항이 여러
   * 학습자에게 걸려 있으면 **가장 많이 잊은 학습자 기준**을 쓴다 — 반에 내는
   * 문제이므로 가장 급한 사람에게 맞춘다.
   *
   * 경과일의 기준점은 마지막 복습일이고, 아직 한 번도 안 봤으면
   * `due_on - interval_days`(= 항목이 생긴 날)다. `due_on`을 그대로 쓰면
   * **오늘 기한인 항목이 전부 경과 0일 → R=1**이 되어 정렬이 통째로 뭉개진다. */
  const reviewQuestionRows = await sql<
    {
      question_id: string;
      stability_days: string | null;
      days_since: number;
    }[]
  >`
    select ri.question_id::text as question_id,
           min(ri.stability_days)::text as stability_days,
           max(${targetDate}::date - coalesce(ri.last_reviewed_on, ri.due_on - coalesce(ri.interval_days, 1)))::int as days_since
    from review_items ri
    join learning_group_memberships m
      on m.learner_id = ri.learner_id and m.learning_group_id = ${learningGroupId} and m.status = 'active'
    where ri.organization_id = ${organizationId}
      and ri.status = 'scheduled' and ri.due_on <= ${targetDate}
      and ri.question_id is not null
    group by ri.question_id
  `;
  const retentionByQuestion = new Map<string, number>();
  for (const r of reviewQuestionRows) {
    retentionByQuestion.set(
      r.question_id,
      predictedRetention({
        stabilityDays: r.stability_days === null ? 1 : Number(r.stability_days),
        daysSinceReview: r.days_since,
        ...(masterySpec.targetRetention !== undefined
          ? { targetRetention: masterySpec.targetRetention }
          : {}),
      }),
    );
  }
  const reviewPool = pool
    .filter((r) => retentionByQuestion.has(r.question_id))
    .sort(
      (a, b) =>
        (retentionByQuestion.get(a.question_id) ?? 1) -
        (retentionByQuestion.get(b.question_id) ?? 1),
    );
  // 복습 풀이 비면 누적 복습으로 폴백 (오늘 개념 밖 전체)
  const cumulativePool = reviewPool.length > 0 ? reviewPool : otherPool;

  /* 버킷 수량 — 정책 비율을 문항 수로 환산 (큰 몫부터) */
  const weights = policy.poolWeights;
  const total = policy.questionCount;
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
      /* 복습일 때만: 기억률 순서를 지키고, 재출제 제한에서 면제한다.
       * 면제가 없으면 이 버킷은 구조적으로 언제나 0건이다 — 복습 항목은
       * "최근에 그 문항을 틀려서" 생기므로 lastUsedOn이 반드시 창 안이다. */
      ...(reviewPool.length > 0
        ? { preserveOrder: true, allowRecentlyUsed: true }
        : {}),
    },
  ];

  const excludeUsedSince =
    policy.constraints.noRepeatWithinDays && !options.allowRecentlyUsed
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
    /* 원인을 구분해서 말한다.
     *
     * 예전 문구는 무조건 "문제은행의 검수·사용 권한 상태를 확인하세요"였는데,
     * 실제로 가장 흔한 원인은 **무반복 창**이다(실측: 사용 가능한 문항이
     * 159개나 있는데 오늘 개념의 문항이 전부 최근 14일 안에 쓰여 0건이 됐다).
     * 선생님을 검수 화면으로 보내 놓고 거기서 아무 이상도 못 찾게 만드는 건
     * 없는 화면보다 나쁘다 — 잘못된 곳을 짚어 시간을 버리게 한다. */
    const candidates = buckets.reduce((n, b) => n + b.candidates.length, 0);
    if (candidates === 0) {
      return fail(
        "이 수업 개념에 연결된 출제 가능한 문항이 없습니다. 문항의 개념 정렬과 검수·사용 권한 상태를 확인하세요.",
      );
    }
    return fail(
      excludeUsedSince
        ? `후보 ${candidates}개가 모두 최근 출제분입니다 (${excludeUsedSince} 이후 사용). 무반복 기간(${policy.constraints.noRepeatWithinDays}일)을 줄이거나 이 개념의 문항을 늘리세요.`
        : `후보 ${candidates}개가 있으나 난이도 배분 조건을 만족하는 조합이 없습니다. 정책의 난이도 배분을 확인하세요.`,
    );
  }

  /* 학습자 명단 */
  const learners = await sql<{ learner_id: string }[]>`
    select learner_id from learning_group_memberships
    where organization_id = ${organizationId}
      and learning_group_id = ${learningGroupId} and status = 'active'
  `;

  /* 블루프린트 재료 — 오늘 개념의 학습 목표·기대 증거 (정렬 사슬 2N:
   * 성취기준 → 개념 → 학습 목표 → 기대 증거 → 블루프린트 → 문항) */
  const objectiveRows = await loadObjectiveSnapshot(sql, todayConceptIds);
  const conceptsWithObjectives = new Set(objectiveRows.map((o) => o.concept_id));
  const selectedIds = selection.selected.map((s) => s.questionId);
  const kindRows = await sql<{ id: string; kind: string }[]>`
    select id::text as id, kind::text as kind from questions
    where id = any(${selectedIds}::uuid[])
  `;
  const humanGradedKinds = new Set(["essay"]);
  const humanGraded = kindRows.filter((k) => humanGradedKinds.has(k.kind)).length;

  /* 게시 — 스냅샷 고정 (원자적) */
  const actor = actorFields(options.actorUserId);
  const planningLink = planningSnapshot(options, targetDate, policySource);
  const assessmentId = uuidv7();
  const blueprintId = uuidv7();
  await sql.begin(async (tx) => {
    /* 블루프린트 — 무엇을 왜 재려 했는지의 기록. 인스턴스보다 먼저 쓴다 */
    await tx`
      insert into assessment_blueprints (
        id, organization_id, policy_id, purpose, version, spec, grading_split, created_by
      ) values (
        ${blueprintId}, ${organizationId}, ${policy.id}, 'formative', ${policy.version},
        ${tx.json({
          targetDate,
          buckets: [
            { reason: "today_concept", count: nToday },
            { reason: "weakness", count: nWeak },
            { reason: "review", count: nReview },
          ],
          difficultyDistribution:
            policy.constraints.difficultyDistribution ?? null,
          conceptIds: todayConceptIds,
          objectives: objectiveRows.map((o) => ({
            id: o.id,
            conceptId: o.concept_id,
            statement: o.statement,
            dimensions: o.dimensions,
            evidences: o.evidences,
          })),
          /* 목표가 정의되지 않은 오늘 개념 — 사슬 공백의 정직한 기록 */
          objectiveGaps: todayConceptIds.filter(
            (c) => !conceptsWithObjectives.has(c),
          ),
          plannedFrom: planningLink,
        } as never)},
        ${tx.json({
          autoGradable: kindRows.length - humanGraded,
          humanGraded,
          humanGradedKinds: [...humanGradedKinds],
        } as never)},
        ${actor.id}
      )
    `;
    await tx`
      insert into assessment_instances (
        id, organization_id, blueprint_id, policy_id, policy_version, purpose, title,
        learning_group_id, scheduled_date, status, generation_seed,
        generation_context, time_limit_minutes, total_points,
        published_at, published_by
      ) values (
        ${assessmentId}, ${organizationId}, ${blueprintId}, ${policy.id}, ${policy.version},
        'formative', ${`일일테스트 · ${targetDate}`},
        ${learningGroupId}, ${targetDate}, 'published', ${seed},
        ${tx.json({
          inputHash: selection.inputHash,
          outputHash: selection.outputHash,
          shortfalls: selection.shortfalls,
          todayConceptIds,
          ...planningLink,
        } as never)},
        ${policy.timeLimitMinutes}, ${selection.selected.length * 10},
        now(), ${actor.id}
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
          /* 미검수 AI 제안은 숙련도 증거로 스냅샷하지 않는다 — 틀린 정렬이
           * 여기로 들어오면 학생 화면 어디에도 안 보인 채 출제만 틀어진다 */
          and provenance <> 'ai_suggested'
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
        values (${uuidv7()}, ${organizationId}, ${assessmentId}, ${l.learner_id}, 'online', ${actor.id})
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
        ${uuidv7()}, ${organizationId}, ${actor.type}, ${actor.id},
        'assessment.generate-publish', 'assessment', ${assessmentId},
        ${actor.type === "automation" ? "일일테스트 자동 생성·게시 (워커)" : "일일테스트 자동 생성·게시"},
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
  /** 워커가 부르면 null — 감사 행이 `automation`으로 남는다 */
  actorUserId: string | null;
  /** 이 평가를 부른 계획 — 수업과 루트 노드 (generateDailyTest와 같은 뜻) */
  sessionId?: string | null;
  routeNodeId?: string | null;
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

  /* 정책 — 일일테스트와 같은 해석(반 → 조직). 준비도 게이트가 보는 것과 같다 */
  const resolved = await resolveAssessmentPolicy(sql, {
    organizationId,
    learningGroupId,
    purpose: "confirmation",
  });
  if (!resolved) {
    return fail(
      "이 반에 적용할 확인테스트 정책이 없습니다. 반 설정의 평가 정책을 지정하거나 학원 기본 정책을 만드세요.",
    );
  }
  const policy = resolved.policy;
  const policySource: AssessmentPolicySource = resolved.source;

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
    left join question_alignments a
      on a.question_id = q.id
      /* ai_suggested(미검수 제안)는 개념 축이 아니다 — 승인돼야 풀에 잡힌다 */
      and a.provenance <> 'ai_suggested'
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
    [{ reason: "anchor", count: policy.questionCount, candidates: unitPool }],
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

  /* 블루프린트 — 단원 개념 전체가 앵커 커버 대상 (2N 공통 앵커) */
  const unitConceptIds = unitConcepts.map((c) => c.concept_id);
  const objectiveRows = await loadObjectiveSnapshot(sql, unitConceptIds);
  const conceptsWithObjectives = new Set(objectiveRows.map((o) => o.concept_id));
  const coveredConcepts = new Set(
    selection.selected.flatMap(
      (s) => unitPool.find((p) => p.questionId === s.questionId)?.conceptIds ?? [],
    ),
  );

  const actor = actorFields(options.actorUserId);
  const planningLink = planningSnapshot(options, targetDate, policySource);
  const assessmentId = uuidv7();
  const blueprintId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into assessment_blueprints (
        id, organization_id, policy_id, purpose, version, spec, anchor_spec, created_by
      ) values (
        ${blueprintId}, ${organizationId}, ${policy.id}, 'confirmation', ${policy.version},
        ${tx.json({
          targetDate,
          conceptIds: unitConceptIds,
          objectives: objectiveRows.map((o) => ({
            id: o.id,
            conceptId: o.concept_id,
            statement: o.statement,
            dimensions: o.dimensions,
            evidences: o.evidences,
          })),
          objectiveGaps: unitConceptIds.filter(
            (c) => !conceptsWithObjectives.has(c),
          ),
          passingRules: policy.passingRules,
          plannedFrom: planningLink,
        } as never)},
        ${tx.json({
          anchorCount: policy.questionCount,
          /* 앵커가 실제로 덮은/못 덮은 단원 개념 — 커버 공백의 정직한 기록 */
          coveredConceptIds: unitConceptIds.filter((c) => coveredConcepts.has(c)),
          uncoveredConceptIds: unitConceptIds.filter((c) => !coveredConcepts.has(c)),
        } as never)},
        ${actor.id}
      )
    `;
    await tx`
      insert into assessment_instances (
        id, organization_id, blueprint_id, policy_id, policy_version, purpose, title,
        learning_group_id, scheduled_date, status, generation_seed,
        generation_context, time_limit_minutes, total_points,
        published_at, published_by
      ) values (
        ${assessmentId}, ${organizationId}, ${blueprintId}, ${policy.id}, ${policy.version},
        'confirmation', ${`확인테스트 · ${targetDate}`},
        ${learningGroupId}, ${targetDate}, 'published', ${seed},
        ${tx.json({
          inputHash: selection.inputHash,
          outputHash: selection.outputHash,
          shortfalls: selection.shortfalls,
          passingRules: policy.passingRules,
          ...planningLink,
        } as never)},
        ${policy.timeLimitMinutes}, ${selection.selected.length * 10},
        now(), ${actor.id}
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
          /* 미검수 AI 제안은 숙련도 증거로 스냅샷하지 않는다 — 틀린 정렬이
           * 여기로 들어오면 학생 화면 어디에도 안 보인 채 출제만 틀어진다 */
          and provenance <> 'ai_suggested'
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
        values (${uuidv7()}, ${organizationId}, ${assessmentId}, ${l.learner_id}, 'online', ${actor.id})
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
        ${uuidv7()}, ${organizationId}, ${actor.type}, ${actor.id},
        'assessment.generate-publish', 'assessment', ${assessmentId},
        ${actor.type === "automation" ? "확인테스트 생성·게시 (워커)" : "확인테스트 생성·게시"},
        ${tx.json({ seed, count: selection.selected.length } as never)}
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
