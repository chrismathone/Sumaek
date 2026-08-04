import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 학습 준비도 게이트 (T2.4) — 라이브 DB 통합 테스트.
 *
 * 결손이 학생 화면에서 처음 드러나면 이미 수업 당일이다. 문항 0개 연습
 * 자료를 게시할 수 있었고(G-06), 자료가 없는 개념 차시를 담은 루트를
 * 게시할 수 있었다. 학생은 「할 차례」를 눌러 빈 화면을 보고 자기가
 * 잘못한 줄 안다.
 *
 * 겨누는 것:
 *  1. 게시 **전에** 막힌다
 *  2. 무엇이·왜·어디서 고치는지 함께 말한다
 *  3. 선택 결손(계정 미연결)은 막지 않고 경고로 남는다
 *  4. 교사가 보는 사유와 학생이 보는 사유가 **같은 레지스트리**에서 온다
 * ───────────────────────────────────────────────────────────── */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { getSharedSql } = await import("@su-maek/db");
const { BLOCK_REASONS } = await import("@su-maek/core/learning");
const {
  checkMaterialReadiness,
  checkRouteReadiness,
  studentBlockText,
  blockingMessage,
  READINESS_CODES,
} = await import("@/lib/domain/learning-readiness");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";

let sql: ReturnType<typeof getSharedSql>;
const CONCEPT = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const LEARNER = uuidv7();
const EMPTY_PRACTICE = uuidv7();
const GOOD_READING = uuidv7();

async function addNode(fields: {
  id: string;
  kind: string;
  title: string;
  order: number;
  conceptIds?: string[];
  bookEditionId?: string | null;
  pageRange?: unknown;
  homework?: unknown;
  blueprintId?: string | null;
}) {
  await sql`
    insert into route_nodes
      (id, organization_id, route_version_id, kind, title, sort_order, concept_ids,
       book_edition_id, page_range, homework, blueprint_id)
    values (${fields.id}, ${ORG}, ${VERSION}, ${fields.kind}, ${fields.title},
            ${fields.order}, ${sql.json(fields.conceptIds ?? [])},
            ${fields.bookEditionId ?? null},
            ${fields.pageRange ? sql.json(fields.pageRange as never) : null},
            ${fields.homework ? sql.json(fields.homework as never) : null},
            ${fields.blueprintId ?? null})
  `;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();

  await sql`
    insert into canonical_concepts (id, slug, name, status, evidence)
    values (${CONCEPT}, ${`rtest-${CONCEPT.slice(-12)}`}, '준비도 테스트 개념',
            'active', '[]'::jsonb)
  `;
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '준비도 기간', 2026, '2026-01-01', '2026-12-31', 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '준비도 반', 'operating')
  `;
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${LEARNER}, ${ORG}, ${"계정 없는 학생"}, 'active')
  `;
  await sql`
    insert into learning_group_memberships
      (id, organization_id, learning_group_id, learner_id, joined_on, status)
    values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER}, '2026-01-01', 'active')
  `;
  await sql`
    insert into route_plans (id, organization_id, kind, name, status, learning_group_id)
    values (${PLAN}, ${ORG}, 'group_route', ${"준비도 루트"}, 'draft', ${GROUP})
  `;
  await sql`
    insert into route_versions
      (id, organization_id, route_plan_id, version_number, status)
    values (${VERSION}, ${ORG}, ${PLAN}, 1, 'draft')
  `;
  await sql`
    insert into learning_materials
      (id, organization_id, concept_id, kind, title, question_ids, status)
    values (${EMPTY_PRACTICE}, ${ORG}, ${CONCEPT}, 'practice', ${"빈 연습"},
            '[]'::jsonb, 'draft')
  `;
  await sql`
    insert into learning_materials
      (id, organization_id, concept_id, kind, title, body, status)
    values (${GOOD_READING}, ${ORG}, ${CONCEPT}, 'reading', ${"정상 읽기"},
            ${sql.json([{ type: "paragraph", text: "본문" }])}, 'published')
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`delete from learning_materials where id in (${EMPTY_PRACTICE}, ${GOOD_READING})`;
  await sql`delete from route_nodes where route_version_id = ${VERSION}`;
  await sql`delete from route_versions where id = ${VERSION}`;
  await sql`delete from route_plans where id = ${PLAN}`;
  await sql`delete from learning_group_memberships where learner_id = ${LEARNER}`;
  await sql`delete from learners where id = ${LEARNER}`;
  await sql`delete from learning_groups where id = ${GROUP}`;
  await sql`delete from course_periods where id = ${PERIOD}`;
  await sql`delete from canonical_concepts where id = ${CONCEPT}`;
});

async function clearNodes() {
  await sql`delete from route_nodes where route_version_id = ${VERSION}`;
}

const routeReport = () =>
  checkRouteReadiness({
    organizationId: ORG,
    routeVersionId: VERSION,
    learningGroupId: GROUP,
  });

describe.skipIf(!hasDb)("자료 게시", () => {
  it("문항 0개 연습 자료는 게시할 수 없다", async () => {
    const r = await checkMaterialReadiness({
      organizationId: ORG,
      materialId: EMPTY_PRACTICE,
    });
    expect(r.ok).toBe(false);
    expect(r.blocking[0]!.code).toBe(BLOCK_REASONS.noQuestions);
    expect(r.blocking[0]!.label).toBe("빈 연습");
  });

  it("차단 문구가 무엇이·왜·어디서 고치는지 함께 말한다", async () => {
    const r = await checkMaterialReadiness({
      organizationId: ORG,
      materialId: EMPTY_PRACTICE,
    });
    const msg = blockingMessage(r);
    expect(msg).toContain("빈 연습");
    expect(msg).toContain("문항이 0개");
    expect(r.blocking[0]!.href).toBe("/app/content/materials");
  });

  it("읽기 자료는 막지 않는다", async () => {
    const r = await checkMaterialReadiness({
      organizationId: ORG,
      materialId: GOOD_READING,
    });
    expect(r.ok).toBe(true);
  });
});

describe.skipIf(!hasDb)("루트 게시", () => {
  it("자료 없는 개념 차시를 막는다", async () => {
    await clearNodes();
    await addNode({
      id: uuidv7(),
      kind: "concept_lesson",
      title: "자료 없는 차시",
      order: 1,
      conceptIds: [uuidv7()], // 자료가 붙지 않은 개념
    });

    const r = await routeReport();
    expect(r.ok).toBe(false);
    expect(r.blocking.map((f) => f.code)).toContain(BLOCK_REASONS.materialMissing);
  });

  it("쪽 범위가 빈 교재 노드를 막는다", async () => {
    await clearNodes();
    await addNode({ id: uuidv7(), kind: "book_range", title: "빈 교재 범위", order: 1 });

    const r = await routeReport();
    expect(r.blocking.map((f) => f.code)).toContain(
      BLOCK_REASONS.bookRangeIncomplete,
    );
  });

  it("방식 없는 숙제를 막는다", async () => {
    await clearNodes();
    await addNode({ id: uuidv7(), kind: "homework", title: "방식 없는 숙제", order: 1 });

    const r = await routeReport();
    expect(r.blocking.map((f) => f.code)).toContain(
      BLOCK_REASONS.homeworkModeMissing,
    );
  });

  it("적용할 평가 정책이 없으면 막는다 — 그때 생성이 실제로 실패한다", async () => {
    /* **뒤집힌 단언이다** (T3.3). 예전에는 두 가지를 봤다.
     *   - 노드에 `blueprint_id`가 있는가 → 없앴다. 교사가 고를 목록도 만들
     *     화면도 없는데 요구하고 있었고, 넣어도 생성기가 읽지 않았다.
     *   - `learning_groups.assessment_policy_id`가 비었는가 → 그 컬럼은
     *     실측으로 **모든 조직에서 100% NULL**이었다. 즉 평가 노드가 든
     *     루트는 무조건 막혔다. 막는 이유와 실제 실패 이유가 달랐다.
     *
     * 이제 생성기와 **같은 함수**(resolveAssessmentPolicy)로 묻는다.
     * 반 지정도 학원 기본도 없을 때만 막는다. */
    await clearNodes();
    await addNode({ id: uuidv7(), kind: "daily_test", title: "참조 없는 일일테스트", order: 1 });

    /* 이 조직에는 기본 정책이 있다(시드). 「없을 때」를 보려면 꺼야 한다 —
     * 지우지 않는다. 되돌리지 못하면 다른 스펙의 전제가 무너진다. */
    await sql`
      update assessment_policies set is_active = false
      where organization_id = ${ORG} and purpose = 'formative'
    `;
    try {
      const r = await routeReport();
      expect(r.blocking.map((f) => f.code)).toContain("no_assessment_policy");
      /* 평가가 아직 생성되지 않은 것 자체는 게시를 막지 않는다 — 워커가
       * 수업일 전에 만든다. 그것까지 막으면 루트를 영원히 게시할 수 없다. */
      expect(r.blocking.map((f) => f.code)).not.toContain(
        BLOCK_REASONS.assessmentNotGenerated,
      );
    } finally {
      await sql`
        update assessment_policies set is_active = true
        where organization_id = ${ORG} and purpose = 'formative'
      `;
    }
  });

  it("학원 기본 정책만 있어도 통과한다 — 반 지정은 선택이다", async () => {
    /* 반마다 정책을 걸도록 강제하면 학원 하나에 반이 스물이어도 스무 번
     * 지정해야 한다. 기본값이 있으면 그대로 쓰고, 다르게 낼 반만 지정한다.
     * 이 반의 `assessment_policy_id`는 NULL이다 — 그래도 통과해야 한다. */
    await clearNodes();
    await addNode({ id: uuidv7(), kind: "daily_test", title: "정책 있는 일일테스트", order: 1 });

    const [group] = await sql<{ assessment_policy_id: string | null }[]>`
      select assessment_policy_id::text from learning_groups where id = ${GROUP}
    `;
    expect(group?.assessment_policy_id).toBeNull();

    const r = await routeReport();
    expect(r.blocking.map((f) => f.code)).not.toContain("no_assessment_policy");
  });

  it("문항 0개 연습 자료가 게시돼 있으면 루트도 막는다", async () => {
    await sql`update learning_materials set status = 'published' where id = ${EMPTY_PRACTICE}`;
    await clearNodes();
    await addNode({
      id: uuidv7(),
      kind: "concept_lesson",
      title: "빈 연습이 붙은 차시",
      order: 1,
      conceptIds: [CONCEPT],
    });

    const r = await routeReport();
    expect(r.blocking.map((f) => f.code)).toContain(BLOCK_REASONS.noQuestions);
    await sql`update learning_materials set status = 'draft' where id = ${EMPTY_PRACTICE}`;
  });

  it("정상 루트는 통과한다", async () => {
    await clearNodes();
    await addNode({
      id: uuidv7(),
      kind: "concept_lesson",
      title: "정상 차시",
      order: 1,
      conceptIds: [CONCEPT],
    });
    await addNode({ id: uuidv7(), kind: "buffer", title: "버퍼", order: 2 });

    const r = await routeReport();
    expect(r.blocking).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe.skipIf(!hasDb)("경고와 차단은 다르다", () => {
  it("계정 미연결은 경고로만 남고 게시를 막지 않는다", async () => {
    /* 루트는 계정보다 먼저 준비될 수 있다. 막으면 교사가 순서를 강제당하고,
     * 안 보이면 학생 로그인 날 처음 안다. */
    await clearNodes();
    await addNode({
      id: uuidv7(),
      kind: "concept_lesson",
      title: "정상 차시",
      order: 1,
      conceptIds: [CONCEPT],
    });

    const r = await routeReport();
    expect(r.ok).toBe(true);
    expect(r.warnings.map((f) => f.code)).toContain("account_unlinked");
    expect(r.warnings[0]!.label).toBe("계정 없는 학생");
  });

  it("같은 결손을 두 번 말하지 않는다", async () => {
    await clearNodes();
    for (const i of [1, 2, 3]) {
      await addNode({
        id: uuidv7(),
        kind: "book_range",
        title: "같은 이름 노드",
        order: i,
      });
    }

    const r = await routeReport();
    const same = r.blocking.filter(
      (f) => f.code === BLOCK_REASONS.bookRangeIncomplete,
    );
    expect(same).toHaveLength(1);
  });
});

describe("사유 레지스트리는 하나다", () => {
  it("학생 문구와 교사 문구가 같은 표에서 나온다", () => {
    /* 갈리면 교사가 고쳐야 할 것과 학생이 본 것이 다른 말이 되고,
     * 복구 링크를 이을 수 없다. */
    for (const code of Object.keys(READINESS_CODES)) {
      const entry = READINESS_CODES[code as keyof typeof READINESS_CODES];
      expect(entry.student.length).toBeGreaterThan(0);
      expect(entry.teacher.length).toBeGreaterThan(0);
      expect(entry.href.startsWith("/app")).toBe(true);
      expect(studentBlockText(code)).toBe(entry.student);
    }
  });

  it("실행기의 차단 코드가 모두 레지스트리에 있다", () => {
    /* 실행기에 사유를 더하고 문구를 잊으면 학생 화면에 코드가 그대로 뜬다. */
    for (const reason of Object.values(BLOCK_REASONS)) {
      expect(READINESS_CODES[reason], `${reason} 문구 없음`).toBeDefined();
    }
  });

  it("모르는 코드는 삼키지 않고 기본 문구를 준다", () => {
    expect(studentBlockText("듣도보도못한코드")).toBe(
      READINESS_CODES[BLOCK_REASONS.unknownNodeKind].student,
    );
  });
});
