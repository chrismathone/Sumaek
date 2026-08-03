import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import {
  generateConfirmationTest,
  generateDailyTest,
} from "@/lib/domain/assessment";

/* ─────────────────────────────────────────────────────────────
 * 평가 블루프린트 (2N · 인수 48 뒤 고리) — 라이브 DB.
 *
 * assessment_blueprints는 컬럼만 있고 쓰는 곳이 0곳이었다 — 인수 4·37과
 * 같은 형태의 죽은 자리. 이제 generateDailyTest가 생성 시점에 블루프린트를
 * 만들어 인스턴스에 잇고, 오늘 개념의 학습 목표·기대 증거를 스냅샷하며,
 * 목표가 없는 개념은 objectiveGaps로 정직하게 기록하는 것을 검증한다.
 *
 * 픽스처 관례는 review-selection.test.ts와 동일 — 전용 조직·정책은 고정
 * id로 재사용, 반·문항은 실행마다 새로 만들어 멱등 검사를 피한다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
const FIXTURE_ORG_ID = "00000000-0000-7000-8000-0000000000b1";
const FIXTURE_POLICY_ID = "00000000-0000-7000-8000-0000000000b2";
const FIXTURE_CONFIRMATION_POLICY_ID = "00000000-0000-7000-8000-0000000000b7";
/* 개념·목표·증거도 고정 — 전역 테이블을 실행마다 불리지 않는다 */
const CONCEPT_WITH_OBJECTIVE = "00000000-0000-7000-8000-0000000000b3";
const CONCEPT_WITHOUT_OBJECTIVE = "00000000-0000-7000-8000-0000000000b4";
const OBJECTIVE_ID = "00000000-0000-7000-8000-0000000000b5";
const EVIDENCE_ID = "00000000-0000-7000-8000-0000000000b6";
const TZ = "Asia/Seoul";
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

describe.skipIf(!hasDb)("평가 블루프린트 생성 (라이브 DB)", () => {
  let sql: ReturnType<typeof getSharedSql>;
  const ids = {
    org: FIXTURE_ORG_ID,
    policy: FIXTURE_POLICY_ID,
    teacher: uuidv7(),
    group: uuidv7(),
    learner: uuidv7(),
    right: uuidv7(),
    routePlan: uuidv7(),
    routeVersion: uuidv7(),
    routeNode: uuidv7(),
    session: uuidv7(),
    questionA: uuidv7(),
    versionA: uuidv7(),
    questionB: uuidv7(),
    versionB: uuidv7(),
  };
  let generatedAssessmentId: string | null = null;

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ids.org}, '블루프린트 통합테스트', 'itest-blueprint-chain', ${TZ})
      on conflict (id) do nothing
    `;
    /* 오늘 개념만 내는 정책 — 블루프린트의 개념·목표 스냅샷을 곧장 본다 */
    await sql`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, constraints, is_active
      ) values (
        ${ids.policy}, ${ids.org}, '오늘 개념 전용(테스트)', 'formative', 1,
        ${sql.json({ today_concept: 100, weakness: 0, review: 0 } as never)},
        2, ${sql.json({} as never)}, true
      )
      on conflict (id) do nothing
    `;
    await sql`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, constraints, passing_rules, is_active
      ) values (
        ${FIXTURE_CONFIRMATION_POLICY_ID}, ${ids.org}, '확인테스트(테스트)',
        'confirmation', 1, ${sql.json({} as never)}, 2, ${sql.json({} as never)},
        ${sql.json({ passRatio: 0.7 } as never)}, true
      )
      on conflict (id) do nothing
    `;
    /* 전역 참조: 개념 2종 — 하나만 학습 목표·기대 증거 보유 */
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values
        (${CONCEPT_WITH_OBJECTIVE}, 'itest-blueprint-with-objective',
         '블루프린트 개념(목표 있음)', 'active', '[]'::jsonb),
        (${CONCEPT_WITHOUT_OBJECTIVE}, 'itest-blueprint-without-objective',
         '블루프린트 개념(목표 없음)', 'active', '[]'::jsonb)
      on conflict (id) do nothing
    `;
    await sql`
      insert into learning_objectives (
        id, concept_id, statement, dimensions, success_evidence, status
      ) values (
        ${OBJECTIVE_ID}, ${CONCEPT_WITH_OBJECTIVE},
        'ITEST 개념의 절차를 오류 없이 수행할 수 있다.',
        ${sql.json(["procedural_fluency"] as never)},
        ${sql.json({ success: "표준 절차 수행", allowedErrors: "단발 계산 실수" } as never)},
        'active'
      )
      on conflict (id) do nothing
    `;
    await sql`
      insert into assessment_evidences (id, objective_id, description, observable_via)
      values (
        ${EVIDENCE_ID}, ${OBJECTIVE_ID}, 'ITEST 절차 수행을 단답으로 관찰',
        ${sql.json({ questionKinds: ["short_answer"] } as never)}
      )
      on conflict (id) do nothing
    `;

    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${ids.group}, ${ids.org}, ${uuidv7()}, '블루프린트 테스트반', 'operating')
    `;
    await sql`
      insert into learners (id, organization_id, display_name, grade_level)
      values (${ids.learner}, ${ids.org}, '블루프린트 학습자', 'middle-1')
    `;
    await sql`
      insert into learning_group_memberships (
        id, organization_id, learning_group_id, learner_id, status, joined_on
      ) values (
        ${uuidv7()}, ${ids.org}, ${ids.group}, ${ids.learner}, 'active', ${TODAY}::date
      )
    `;
    /* 오늘 수업 — 계획 노드가 개념 2종을 가리킨다 */
    await sql`
      insert into route_plans (id, organization_id, kind, name, learning_group_id, status, active_version_id)
      values (${ids.routePlan}, ${ids.org}, 'group_route', '블루프린트 루트', ${ids.group}, 'published', ${ids.routeVersion})
    `;
    await sql`
      insert into route_versions (id, organization_id, route_plan_id, version_number, status)
      values (${ids.routeVersion}, ${ids.org}, ${ids.routePlan}, 1, 'published')
    `;
    await sql`
      insert into route_nodes (
        id, organization_id, route_version_id, kind, title, sort_order, concept_ids
      ) values (
        ${ids.routeNode}, ${ids.org}, ${ids.routeVersion}, 'concept_lesson',
        '블루프린트 차시', 1,
        ${sql.json([CONCEPT_WITH_OBJECTIVE, CONCEPT_WITHOUT_OBJECTIVE] as never)}
      )
    `;
    await sql`
      insert into sessions (
        id, organization_id, learning_group_id, session_date, timezone,
        starts_at, ends_at, status, planned_node_ids
      ) values (
        ${ids.session}, ${ids.org}, ${ids.group}, ${TODAY}::date, ${TZ},
        ${`${TODAY}T09:00:00+09:00`}, ${`${TODAY}T10:00:00+09:00`}, 'planned',
        ${sql.json([ids.routeNode] as never)}
      )
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${ids.right}, ${ids.org}, '통합테스트', 'usable')
    `;
    /* 문항 2건 — 단답(자동 채점) + 서술(사람 채점): gradingSplit을 가른다 */
    for (const [question, version, kind, concept] of [
      [ids.questionA, ids.versionA, "short_answer", CONCEPT_WITH_OBJECTIVE],
      [ids.questionB, ids.versionB, "essay", CONCEPT_WITHOUT_OBJECTIVE],
    ] as const) {
      await sql`
        insert into questions (id, organization_id, kind, review_status, content_right_id, is_auto_assignable, current_version_id)
        values (${question}, ${ids.org}, ${kind}, 'published', ${ids.right}, true, ${version})
      `;
      await sql`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, answer, points, difficulty, content_checksum
        ) values (
          ${version}, ${ids.org}, ${question}, 1,
          ${sql.json([{ type: "text", text: `블루프린트 ${kind} 문항` }] as never)},
          ${sql.json({ kind, accepted: [{ value: "7", form: "number" }] } as never)},
          '10', ${sql.json({ band: "mid" } as never)}, ${`itest-bp-${question}`}
        )
      `;
      await sql`
        insert into question_alignments (id, organization_id, question_id, concept_id, weight)
        values (${uuidv7()}, ${ids.org}, ${question}, ${concept}, 1)
      `;
    }
  });

  afterAll(async () => {
    if (generatedAssessmentId) {
      await sql`
        delete from outbox_events
        where organization_id = ${ids.org} and aggregate_id = ${generatedAssessmentId}
      `;
    }
  });

  it("일일테스트 생성이 블루프린트를 만들어 인스턴스에 잇는다", async () => {
    const result = await generateDailyTest({
      organizationId: ids.org,
      learningGroupId: ids.group,
      targetDate: TODAY as never,
      actorUserId: ids.teacher,
    });
    expect(result.ok).toBe(true);
    generatedAssessmentId = result.assessmentId;

    const [instance] = await sql<{ blueprint_id: string | null }[]>`
      select blueprint_id from assessment_instances where id = ${result.assessmentId}
    `;
    expect(instance!.blueprint_id).not.toBeNull();

    const [blueprint] = await sql<
      { purpose: string; policy_id: string | null; created_by: string | null }[]
    >`
      select purpose::text as purpose, policy_id, created_by
      from assessment_blueprints where id = ${instance!.blueprint_id}
    `;
    expect(blueprint!.purpose).toBe("formative");
    expect(blueprint!.policy_id).toBe(ids.policy);
    expect(blueprint!.created_by).toBe(ids.teacher);
  });

  it("블루프린트 스펙이 학습 목표·기대 증거를 스냅샷하고 공백을 기록한다", async () => {
    const [row] = await sql<
      {
        spec: {
          conceptIds: string[];
          objectives: Array<{
            id: string;
            conceptId: string;
            statement: string;
            evidences: Array<{ id: string; description: string }>;
          }>;
          objectiveGaps: string[];
        };
      }[]
    >`
      select b.spec from assessment_blueprints b
      join assessment_instances a on a.blueprint_id = b.id
      where a.id = ${generatedAssessmentId}
    `;
    const spec = row!.spec;
    expect(spec.conceptIds).toContain(CONCEPT_WITH_OBJECTIVE);
    expect(spec.conceptIds).toContain(CONCEPT_WITHOUT_OBJECTIVE);

    // 목표 스냅샷 — 사슬: 개념 → 목표 → 기대 증거
    const objective = spec.objectives.find((o) => o.id === OBJECTIVE_ID);
    expect(objective).toBeDefined();
    expect(objective!.conceptId).toBe(CONCEPT_WITH_OBJECTIVE);
    expect(objective!.evidences.map((e) => e.id)).toContain(EVIDENCE_ID);

    // 목표 없는 개념은 공백으로 기록 — 있는 척하지 않는다
    expect(spec.objectiveGaps).toContain(CONCEPT_WITHOUT_OBJECTIVE);
    expect(spec.objectiveGaps).not.toContain(CONCEPT_WITH_OBJECTIVE);
  });

  it("gradingSplit이 자동·사람 채점 영역을 실제 선정 문항으로 가른다", async () => {
    const [row] = await sql<
      { grading_split: { autoGradable: number; humanGraded: number } }[]
    >`
      select b.grading_split from assessment_blueprints b
      join assessment_instances a on a.blueprint_id = b.id
      where a.id = ${generatedAssessmentId}
    `;
    // 단답 1 + 서술 1
    expect(row!.grading_split.autoGradable).toBe(1);
    expect(row!.grading_split.humanGraded).toBe(1);
  });

  it("확인테스트도 블루프린트를 만든다 — 앵커 커버리지를 anchor_spec에 기록", async () => {
    const result = await generateConfirmationTest({
      organizationId: ids.org,
      learningGroupId: ids.group,
      targetDate: TODAY as never,
      actorUserId: ids.teacher,
    });
    expect(result.ok).toBe(true);

    const [row] = await sql<
      {
        spec: { objectives: Array<{ id: string }>; objectiveGaps: string[] };
        anchor_spec: {
          anchorCount: number;
          coveredConceptIds: string[];
          uncoveredConceptIds: string[];
        };
      }[]
    >`
      select b.spec, b.anchor_spec from assessment_blueprints b
      join assessment_instances a on a.blueprint_id = b.id
      where a.id = ${result.assessmentId}
    `;
    expect(row).toBeDefined();
    expect(row!.spec.objectives.map((o) => o.id)).toContain(OBJECTIVE_ID);
    expect(row!.spec.objectiveGaps).toContain(CONCEPT_WITHOUT_OBJECTIVE);
    // 문항 2건이 단원 개념 2종을 하나씩 덮는다 — 공백 0의 실측
    expect(row!.anchor_spec.anchorCount).toBe(2);
    expect(row!.anchor_spec.coveredConceptIds.sort()).toEqual(
      [CONCEPT_WITH_OBJECTIVE, CONCEPT_WITHOUT_OBJECTIVE].sort(),
    );
    expect(row!.anchor_spec.uncoveredConceptIds).toEqual([]);

    await sql`
      delete from outbox_events
      where organization_id = ${ids.org} and aggregate_id = ${result.assessmentId}
    `;
  });
});
