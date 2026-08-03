import { config } from "dotenv";
config({ path: [".env", "../../.env"] });
import { drizzle } from "drizzle-orm/postgres-js";
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../client";
import * as schema from "../schema";
import { KST } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 합성 시드 — 실제 학생 개인정보를 절대 사용하지 않는다 (3장).
 * 랜딩 데모와 동일한 합성 인물(박서윤·이도윤·정하린)로 E2E 핵심 순환을
 * 검증할 수 있는 최소 완결 데이터셋을 만든다. 멱등 실행 가능.
 * ───────────────────────────────────────────────────────────── */

const ORG_ID = "00000000-0000-7000-8000-000000000001";
const TEACHER_USER_ID = "00000000-0000-7000-8000-0000000000a1";
const GROUP_ID = "00000000-0000-7000-8000-000000000010";
const PERIOD_ID = "00000000-0000-7000-8000-000000000011";
const ROUTE_PLAN_ID = "00000000-0000-7000-8000-000000000020";
const ROUTE_VERSION_ID = "00000000-0000-7000-8000-000000000021";
const POLICY_ID = "00000000-0000-7000-8000-000000000030";
const MASTERY_POLICY_ID = "00000000-0000-7000-8000-000000000031";
const RIGHT_ID = "00000000-0000-7000-8000-000000000040";

const LEARNERS = [
  { id: "00000000-0000-7000-8000-000000000101", name: "박서윤" },
  { id: "00000000-0000-7000-8000-000000000102", name: "이도윤" },
  { id: "00000000-0000-7000-8000-000000000103", name: "정하린" },
  { id: "00000000-0000-7000-8000-000000000104", name: "김시우" },
  { id: "00000000-0000-7000-8000-000000000105", name: "최하준" },
] as const;

/** 중2 연립방정식 단원 주변의 canonical 개념 (내부 해석 — 공식 성취기준 아님) */
const CONCEPTS = [
  { slug: "m2-linear-eq-review", name: "일차방정식 복습" },
  { slug: "m2-simeq-intro", name: "연립일차방정식의 뜻" },
  { slug: "m2-simeq-substitution", name: "대입법" },
  { slug: "m2-simeq-elimination", name: "가감법" },
  { slug: "m2-simeq-application", name: "연립방정식의 활용" },
  { slug: "m2-linear-fn-intro", name: "일차함수의 뜻" },
] as const;

const CONCEPT_EDGES: Array<[string, string]> = [
  ["m2-linear-eq-review", "m2-simeq-intro"],
  ["m2-simeq-intro", "m2-simeq-substitution"],
  ["m2-simeq-intro", "m2-simeq-elimination"],
  ["m2-simeq-substitution", "m2-simeq-application"],
  ["m2-simeq-elimination", "m2-simeq-application"],
  ["m2-simeq-application", "m2-linear-fn-intro"],
];

async function main(): Promise<void> {
  const sql = createSql();
  const db = drizzle(sql, { schema });

  console.log("[seed] 합성 데이터 시드 시작 (멱등)");

  /* 1. 워크스페이스·구성원 */
  await db
    .insert(schema.organizations)
    .values({
      id: ORG_ID,
      name: "수맥 데모 학원",
      slug: "su-maek-demo",
      timezone: KST,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.users)
    .values({
      id: TEACHER_USER_ID,
      email: "demo-teacher@su-maek.example",
      displayName: "데모 선생님",
      defaultOrganizationId: ORG_ID,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.memberships)
    .values({
      id: uuidv7(),
      organizationId: ORG_ID,
      userId: TEACHER_USER_ID,
      role: "owner",
    })
    .onConflictDoNothing();

  /* 2. canonical 개념 + 선수 그래프 (검토 완료 상태의 내부 해석) */
  const conceptIdBySlug = new Map<string, string>();
  for (const c of CONCEPTS) {
    const rows = await db
      .insert(schema.canonicalConcepts)
      .values({
        id: uuidv7(),
        slug: c.slug,
        name: c.name,
        schoolLevel: "middle",
        gradeBand: "middle-2",
        domainName: "변화와 관계",
        status: "active",
        evidence: [{ kind: "seed", note: "합성 시드 — 내부 해석" }],
      })
      .onConflictDoNothing()
      .returning({ id: schema.canonicalConcepts.id });
    if (rows[0]) {
      conceptIdBySlug.set(c.slug, rows[0].id);
    } else {
      const existing = await sql<{ id: string }[]>`
        select id from canonical_concepts where slug = ${c.slug}
      `;
      if (existing[0]) conceptIdBySlug.set(c.slug, existing[0].id);
    }
  }
  for (const [from, to] of CONCEPT_EDGES) {
    const fromId = conceptIdBySlug.get(from);
    const toId = conceptIdBySlug.get(to);
    if (!fromId || !toId) continue;
    await db
      .insert(schema.conceptEdges)
      .values({
        id: uuidv7(),
        fromConceptId: fromId,
        toConceptId: toId,
        kind: "prerequisite",
        provenance: "human",
        status: "active",
        rationale: "합성 시드 — 단원 내 표준 선수 관계",
        evidence: [{ kind: "seed" }],
      })
      .onConflictDoNothing();
  }

  /* 3. 과정 기간·수업 시간·휴일 */
  await db
    .insert(schema.coursePeriods)
    .values({
      id: PERIOD_ID,
      organizationId: ORG_ID,
      name: "2026학년도 2학기",
      academicYear: 2026,
      startsOn: "2026-08-03",
      endsOn: "2026-12-31",
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.learningGroups)
    .values({
      id: GROUP_ID,
      organizationId: ORG_ID,
      coursePeriodId: PERIOD_ID,
      name: "중2 심화 A",
      courseName: "중등 2-2 심화",
      homeTeacherUserId: TEACHER_USER_ID,
      status: "operating",
    })
    .onConflictDoNothing();

  for (const weekday of [1, 3, 5]) {
    await db
      .insert(schema.calendarRules)
      .values({
        // 고정 ID — 시드 재실행 멱등성 (무작위 ID + onConflictDoNothing은 중복을 만든다)
        id: `00000000-0000-7000-8000-00000000005${weekday}`,
        organizationId: ORG_ID,
        subjectType: "learning_group",
        subjectId: GROUP_ID,
        weekday,
        startTime: "16:00",
        endTime: "18:00",
        effectiveFrom: "2026-08-01",
      })
      .onConflictDoNothing();
  }

  await db
    .insert(schema.holidays)
    .values({
      id: "00000000-0000-7000-8000-000000000060",
      organizationId: ORG_ID,
      coursePeriodId: PERIOD_ID,
      kind: "national",
      name: "광복절",
      startsOn: "2026-08-15",
      endsOn: "2026-08-15",
    })
    .onConflictDoNothing();

  /* 4. 학습자·소속 */
  for (const learner of LEARNERS) {
    await db
      .insert(schema.learners)
      .values({
        id: learner.id,
        organizationId: ORG_ID,
        displayName: learner.name,
        gradeLevel: "middle-2",
        status: "active",
      })
      .onConflictDoNothing();
    await db
      .insert(schema.learningGroupMemberships)
      .values({
        id: uuidv7(),
        organizationId: ORG_ID,
        learningGroupId: GROUP_ID,
        learnerId: learner.id,
        joinedOn: "2026-08-01",
      })
      .onConflictDoNothing();
  }

  /* 5. 정책 (평가·숙련도) */
  await db
    .insert(schema.assessmentPolicies)
    .values({
      id: POLICY_ID,
      organizationId: ORG_ID,
      name: "일일테스트 기본",
      purpose: "formative",
      poolWeights: { today_concept: 50, weakness: 30, review: 20 },
      questionCount: 8,
      timeLimitMinutes: 15,
      constraints: {
        difficultyDistribution: { low: 2, mid: 5, high: 1 },
        noRepeatWithinDays: 14,
      },
      automationLevel: "approve_first",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.assessmentPolicies)
    .values({
      id: "00000000-0000-7000-8000-000000000032",
      organizationId: ORG_ID,
      name: "확인테스트 기본",
      purpose: "confirmation",
      poolWeights: { anchor: 70, cumulative: 30 },
      questionCount: 5,
      timeLimitMinutes: 20,
      constraints: { noRepeatWithinDays: 7 },
      passingRules: {
        passRatio: 0.7,
        maxAttempts: 2,
        // 재시험은 동일 문항 재노출 금지 — 같은 개념의 동등 문항 (2N)
        retryExcludesSameQuestions: true,
      },
      automationLevel: "approve_first",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.masteryPolicyVersions)
    .values({
      id: MASTERY_POLICY_ID,
      organizationId: ORG_ID,
      name: "기본 숙련도 정책",
      version: 1,
      appliesTo: { gradeBand: "middle" },
      spec: {
        minEvidenceCount: 3,
        minDistinctDays: 2,
        recencyHalfLifeDays: 30,
        stableThreshold: 0.8,
        partialThreshold: 0.4,
        recheckAfterDays: 45,
        transferEvidenceCount: 1,
        hintPenalty: 0.6,
        requiredDimensions: ["conceptual", "procedural"],
        reviewIntervalsDays: [1, 3, 7, 14, 30],
      },
      algorithmVersion: "mastery-engine/1.0.0",
      isActive: true,
    })
    .onConflictDoNothing();

  /* 6. 사용 권한 + 합성 문항 8개 (검수 완료·출제 가능) */
  await db
    .insert(schema.contentRights)
    .values({
      id: RIGHT_ID,
      organizationId: ORG_ID,
      rightsHolder: "수맥 합성 콘텐츠 (자체 제작)",
      allowedUses: { transform: true, ai: true, print: true, online: true },
      status: "usable",
    })
    .onConflictDoNothing();

  const questionSeeds = [
    {
      concept: "m2-simeq-elimination",
      band: "low",
      body: "연립방정식 $\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}$ 의 해를 구하시오.",
      answer: "x=3, y=2",
      accepted: [{ value: "x=3, y=2", form: "expression" as const, allowEquivalence: true }],
    },
    {
      concept: "m2-simeq-substitution",
      band: "mid",
      body: "연립방정식 $\\begin{cases} y=2x-1 \\\\ 3x+y=9 \\end{cases}$ 를 대입법으로 풀 때, $x$의 값을 구하시오.",
      answer: "2",
      accepted: [{ value: "2", form: "number" as const, allowEquivalence: true }],
    },
    {
      concept: "m2-simeq-application",
      band: "mid",
      body: "합이 $27$이고 차가 $5$인 두 자연수 중 큰 수를 구하시오.",
      answer: "16",
      accepted: [{ value: "16", form: "number" as const, allowEquivalence: true }],
    },
    {
      concept: "m2-linear-eq-review",
      band: "low",
      body: "일차방정식 $3x-4=5$ 의 해를 구하시오.",
      answer: "3",
      accepted: [{ value: "3", form: "number" as const, allowEquivalence: true }],
    },
    {
      concept: "m2-simeq-elimination",
      band: "mid",
      body: "연립방정식 $\\begin{cases} 2x+3y=12 \\\\ x-y=1 \\end{cases}$ 의 해가 $(a, b)$일 때, $a+b$의 값을 구하시오.",
      answer: "5",
      accepted: [{ value: "5", form: "number" as const, allowEquivalence: true }],
    },
    {
      concept: "m2-simeq-application",
      band: "high",
      body: "농도가 $5\\%$인 소금물과 $10\\%$인 소금물을 섞어 농도가 $8\\%$인 소금물 $300\\,\\mathrm{g}$을 만들려고 한다. $5\\%$ 소금물의 양을 구하시오.",
      answer: "120g",
      accepted: [{ value: "120", form: "number" as const, unit: "g", allowEquivalence: true }],
    },
    {
      concept: "m2-simeq-intro",
      band: "low",
      body: "다음 중 미지수가 2개인 일차방정식인 것을 고르시오.",
      answer: "c2",
      choices: [
        { choiceId: "c1", order: 1, text: "$x^2+y=3$" },
        { choiceId: "c2", order: 2, text: "$2x+y=7$" },
        { choiceId: "c3", order: 3, text: "$x+3=8$" },
        { choiceId: "c4", order: 4, text: "$xy=6$" },
      ],
    },
    {
      concept: "m2-simeq-application",
      band: "mid",
      body: "한 자루에 $800$원인 연필과 한 권에 $1200$원인 공책을 합하여 $10$개를 사고 $9200$원을 지불했다. 연필의 수를 구하시오.",
      answer: "7",
      accepted: [{ value: "7", form: "number" as const, allowEquivalence: true }],
    },
  ];

  const questionIds: string[] = [];
  for (const [index, seed] of questionSeeds.entries()) {
    const questionId = `00000000-0000-7000-8000-0000000002${String(index).padStart(2, "0")}`;
    const versionId = `00000000-0000-7000-8000-0000000003${String(index).padStart(2, "0")}`;
    questionIds.push(questionId);

    const isChoice = "choices" in seed && seed.choices;
    await db
      .insert(schema.questions)
      .values({
        id: questionId,
        organizationId: ORG_ID,
        kind: isChoice ? "multiple_choice" : "short_answer",
        reviewStatus: "published",
        contentRightId: RIGHT_ID,
        isAutoAssignable: true,
        currentVersionId: versionId,
      })
      .onConflictDoNothing();

    await db
      .insert(schema.questionVersions)
      .values({
        id: versionId,
        organizationId: ORG_ID,
        questionId,
        versionNumber: 1,
        body: [{ type: "text", text: seed.body }],
        choices: isChoice
          ? seed.choices?.map((c) => ({
              choiceId: c.choiceId,
              order: c.order,
              content: [{ kind: "text", text: c.text }],
              hasTallMath: false,
            }))
          : null,
        answer: isChoice
          ? { kind: "multiple_choice", correctChoiceIds: [seed.answer] }
          : { kind: "short_answer", accepted: seed.accepted },
        points: "10",
        difficulty: { band: seed.band, source: "seed" },
        contentChecksum: `seed-${index}`,
        createdBy: TEACHER_USER_ID,
      })
      .onConflictDoNothing();

    const conceptId = conceptIdBySlug.get(seed.concept);
    if (conceptId) {
      await db
        .insert(schema.questionAlignments)
        .values({
          id: uuidv7(),
          organizationId: ORG_ID,
          questionId,
          conceptId,
          weight: "1",
          provenance: "human",
          reviewedBy: TEACHER_USER_ID,
        })
        .onConflictDoNothing();
    }
  }

  /* 7. 반 루트 (게시 버전) */
  await db
    .insert(schema.routePlans)
    .values({
      id: ROUTE_PLAN_ID,
      organizationId: ORG_ID,
      kind: "group_route",
      name: "중2 심화 A — 연립방정식 단원",
      learningGroupId: GROUP_ID,
      coursePeriodId: PERIOD_ID,
      status: "published",
      activeVersionId: ROUTE_VERSION_ID,
      targetEndDate: "2026-09-30",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.routeVersions)
    .values({
      id: ROUTE_VERSION_ID,
      organizationId: ORG_ID,
      routePlanId: ROUTE_PLAN_ID,
      versionNumber: 1,
      status: "published",
      publishedAt: new Date("2026-08-01T00:00:00Z"),
      publishedBy: TEACHER_USER_ID,
      createdBy: TEACHER_USER_ID,
    })
    .onConflictDoNothing();

  const routeNodes = [
    { title: "일차방정식 복습", concept: "m2-linear-eq-review", kind: "concept_lesson" },
    { title: "연립방정식의 뜻", concept: "m2-simeq-intro", kind: "concept_lesson" },
    { title: "대입법", concept: "m2-simeq-substitution", kind: "concept_lesson" },
    { title: "가감법", concept: "m2-simeq-elimination", kind: "concept_lesson" },
    { title: "연립방정식 활용 ①", concept: "m2-simeq-application", kind: "concept_lesson" },
    { title: "확인테스트 — 연립방정식", concept: "m2-simeq-application", kind: "confirmation_test" },
  ] as const;

  for (const [index, rn] of routeNodes.entries()) {
    const conceptId = conceptIdBySlug.get(rn.concept);
    await db
      .insert(schema.routeNodes)
      .values({
        id: `00000000-0000-7000-8000-0000000004${String(index).padStart(2, "0")}`,
        organizationId: ORG_ID,
        routeVersionId: ROUTE_VERSION_ID,
        kind: rn.kind,
        title: rn.title,
        sortOrder: index + 1,
        conceptIds: conceptId ? [conceptId] : [],
        expectedMinutes: 60,
      })
      .onConflictDoNothing();
  }

  /* 8. 학습 자료 (개념 공부 · 인강 · 연습문제)
   *
   * 지금까지 시드에 자료가 한 건도 없어서, 시드만 돌린 상태의 학생 화면은
   * 「개념 공부·인강·연습문제」 세 단계가 전부 「없음」이었다 — 제품의 절반이
   * 빈 채로 데모되고, 저작→소비 왕복이 자동 검증된 적도 없었다.
   *
   * 가감법(m2-simeq-elimination)에 붙인다. 이 개념에는 시드 문항이 2개 있어
   * 연습문제가 실제로 출제되고, 루트 노드로도 존재해 오늘 일정에 실릴 수 있다. */
  const materialConceptId = conceptIdBySlug.get("m2-simeq-elimination");
  if (materialConceptId) {
    await db
      .insert(schema.learningMaterials)
      .values({
        id: "00000000-0000-7000-8000-000000000070",
        organizationId: ORG_ID,
        conceptId: materialConceptId,
        kind: "reading",
        title: "가감법 — 한 문자를 없애는 법",
        body: [
          {
            type: "text",
            text: "두 식을 더하거나 빼서 한 문자를 없애는 방법을 가감법이라고 합니다.\n\n$\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}$ 에서 두 식을 더하면 $2x=6$ 이 되어 $x=3$ 입니다. 구한 $x$를 아무 식에나 넣으면 $y=2$ 입니다.\n\n계수가 맞지 않을 때는 한쪽 또는 양쪽에 적당한 수를 곱해 계수를 맞춘 뒤 더하거나 뺍니다.",
          },
        ],
        sortOrder: 1,
        status: "published",
        createdBy: TEACHER_USER_ID,
      })
      .onConflictDoNothing();

    await db
      .insert(schema.learningMaterials)
      .values({
        id: "00000000-0000-7000-8000-000000000071",
        organizationId: ORG_ID,
        conceptId: materialConceptId,
        kind: "video",
        title: "가감법 5분 정리",
        /* 합성 영상 ID — 형식은 유튜브 그대로(11자)지만 실재하는 영상이
         * 아니다. 실제 영상을 걸면 시드가 남의 콘텐츠에 의존하게 된다. */
        videoUrl: "https://www.youtube.com/watch?v=SUMAEKDEMO1",
        videoSeconds: 312,
        /* AI 고지 — 파이프라인 meta.json의 disclosure가 여기까지 오는 경로를
         * 시드에서도 보여 준다. 학생 화면(watch)에 그대로 표시된다. */
        disclosure: "선생님이 검수한 AI 보충 강의입니다.",
        sourceJobId: "20260722-0953-d093ce3f",
        sortOrder: 2,
        status: "published",
        createdBy: TEACHER_USER_ID,
      })
      .onConflictDoNothing();

    /* 연습문제 — 문항을 **지정**한다. 자동 선정만 시드하면 큐레이션 경로가
     * 여전히 한 번도 실행되지 않는다. 지정 순서는 생성순의 역순으로 둔다:
     * 순서가 실제로 지켜지는지 눈으로 확인할 수 있어야 한다. */
    await db
      .insert(schema.learningMaterials)
      .values({
        id: "00000000-0000-7000-8000-000000000072",
        organizationId: ORG_ID,
        conceptId: materialConceptId,
        kind: "practice",
        title: "가감법 연습 2문항",
        questionIds: [
          "00000000-0000-7000-8000-000000000204", // a+b 구하기 (생성순 5번째)
          "00000000-0000-7000-8000-000000000200", // x+y=5, x-y=1 (생성순 1번째)
        ],
        sortOrder: 3,
        status: "published",
        createdBy: TEACHER_USER_ID,
      })
      .onConflictDoNothing();

    /* 데모 학생(박서윤)의 **오늘** 개별 일정.
     *
     * 학생 화면의 자료·연습문제는 "오늘 차시의 노드 → 그 노드의 개념"으로만
     * 찾아온다. 반 공통 수업은 월·수·금에만 생기므로 실행 요일에 따라
     * 학생 화면이 비었다 찼다 한다 — 저작→소비 왕복을 자동 검증할 수 없다.
     * 개별 일정은 반 일정을 건드리지 않으면서(불변 조건 4) 오늘을 고정한다.
     *
     * 시드를 다시 돌리면 날짜가 오늘로 갱신되어야 한다. 그래서 여기만
     * onConflictDoNothing이 아니라 갱신 upsert다.
     * 09–10시로 두는 이유: 반 수업(16–18시)과 겹치면
     * learner_schedule_items_no_overlap(학생 시간 배타)에 걸린다.
     *
     * jsonb를 `sql.json()`이 아니라 JSON.stringify + ::jsonb 로 넘기는 이유:
     * 이 파일은 같은 postgres.js 클라이언트를 drizzle로도 감싸 쓰는데
     * (`drizzle(sql)`), 그 순간 클라이언트의 json 직렬화기가 바뀌어
     * `sql.json(배열)`이 배열을 그대로 흘려보낸다 — Bind 단계에서
     * "Buffer.byteLength가 Array를 받았다"로 터진다. 같은 문장을 drizzle 없이
     * 단독 실행하면 멀쩡해서 원인을 찾기 어렵다(실측으로 확인). 다른 파일에서
     * `sql.json()`이 잘 도는 이유는 그쪽엔 drizzle이 없기 때문이다. */
    const eliminationNodeId = "00000000-0000-7000-8000-000000000403"; // 가감법

    /* `on conflict (id)`는 **배타 제약을 막지 못한다** — 중재는 id 하나에만
     * 걸리고, learner_schedule_items_no_overlap 위반(23P01)은 그대로 던져진다.
     * 다른 도구가 같은 학습자의 오늘에 더 넓은 칸을 잡아 두면(예:
     * `seed-unit1-demo`가 09–22시를 쓴다) 시드가 통째로 죽고, 그 뒤의
     * 어떤 시드도 실행되지 않는다 — 실측으로 확인했다.
     *
     * 그래서 **겹치는 칸이 이미 있으면 조용히 비켜선다.** 남의 행을 지우지
     * 않는 쪽을 고른 이유: 이 일정은 데모 편의용이고, 09–22시를 잡은 쪽은
     * 사람이 일부러 만든 검증 세팅이다. 시드가 그걸 말없이 되돌리면
     * 「분명히 세팅했는데 사라졌다」가 된다. 자기 행(같은 id)은 제외하므로
     * 날이 바뀌면 아래 do update가 정상적으로 오늘로 옮긴다. */
    const upsertDemoItem = (id: string, learnerId: string) => sql`
      with want as (
        select ${id}::uuid as id,
               (now() at time zone ${KST})::date as d,
               ((now() at time zone ${KST})::date + time '09:00')
                 at time zone ${KST} as s,
               ((now() at time zone ${KST})::date + time '10:00')
                 at time zone ${KST} as e
      )
      insert into learner_schedule_items (
        id, organization_id, learner_id, learning_group_id, session_id,
        item_date, timezone, starts_at, ends_at, planned_node_ids,
        reason_codes, matches_group, is_rejoin
      )
      select w.id, ${ORG_ID}, ${learnerId}, ${GROUP_ID}, null,
             w.d, ${KST}, w.s, w.e,
             ${JSON.stringify([eliminationNodeId])}::jsonb,
             ${JSON.stringify(["seed_demo"])}::jsonb,
             false, false
      from want w
      where not exists (
        select 1 from learner_schedule_items x
         where x.organization_id = ${ORG_ID} and x.learner_id = ${learnerId}
           and x.id <> w.id
           and tstzrange(x.starts_at, x.ends_at) && tstzrange(w.s, w.e)
      )
      on conflict (id) do update set
        item_date = excluded.item_date,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        planned_node_ids = excluded.planned_node_ids,
        updated_at = now()
    `;

    await upsertDemoItem(
      "00000000-0000-7000-8000-000000000080",
      LEARNERS[0].id,
    );

    /* 이도윤에게도 같은 오늘 일정. 사람이 손으로 확인하는 학생 계정
     * (st2000424)이 이 학습자에 붙어 있어서, 여기 일정이 없으면 로그인해도
     * 「오늘은 수업이 없습니다」만 보인다. 박서윤 것과 갈라 두는 이유는
     * E2E가 박서윤 일정을 지웠다 만들었다 하기 때문이다 — 사람이 보는 화면이
     * 테스트 진행 상황에 따라 달라지면 안 된다.
     * 시간 배타 제약은 학습자별이라 같은 09–10시를 써도 겹치지 않는다. */
    await upsertDemoItem(
      "00000000-0000-7000-8000-000000000081",
      LEARNERS[1].id,
    );
  }

  console.log(
    `[seed] 완료 — 조직 1, 개념 ${CONCEPTS.length}, 학습자 ${LEARNERS.length}, 문항 ${questionIds.length}, 루트 노드 ${routeNodes.length}, 학습 자료 3`,
  );
  await sql.end();
}

main().catch((error) => {
  console.error("[seed] 실패", error);
  process.exit(1);
});
