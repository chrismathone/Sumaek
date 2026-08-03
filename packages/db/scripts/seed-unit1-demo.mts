/**
 * 데모 계정 1단원(소인수분해) 검증 세팅 — 멱등.
 *
 *   pnpm --filter @su-maek/db seed-unit1-demo
 *
 * 학생 화면의 사슬은 「오늘 세션 → planned_node_ids → route_nodes.concept_ids
 * → 그 개념의 published 자료」다. 이 스크립트는 그 사슬을 데모 조직에
 * 끝까지 잇는다:
 *
 * 1. 검증용 반 「1단원 검증반 (중1)」 + demo-student 소속
 * 2. 루트(발행) + 차시 노드(1단원 개념 5종) + **오늘**(Asia/Seoul) 세션
 * 3. 정제본(draft) 게시 — 추출본은 절대 게시하지 않는다 (게시 게이트와
 *    같은 기준: source_ref.extractedBy가 있으면 건너뛴다)
 *
 * 몇 번을 다시 돌려도 같은 상태로 수렴한다 (E2E 멱등 원칙). 세션 날짜만
 * 실행일로 이동한다 — "오늘"이어야 학생 화면에 나오기 때문이다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import { v7 as uuidv7 } from "uuid";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 4 });

const ORG = "00000000-0000-7000-8000-000000000001"; // 수맥 데모 학원
const GROUP_NAME = "1단원 검증반 (중1)";
const ROUTE_NAME = "1단원 검증 루트";
const NODE_TITLE = "소인수분해 — 1단원 개념 차시";
const TZ = "Asia/Seoul";
/** kwr-2022 매핑 표(KWR_M11_CH1_TARGETS)와 같은 정본 개념들 */
const CONCEPT_SLUGS = [
  "m1-prime-composite",
  "m1-prime-factorization",
  "m1-divisors",
  "m1-gcd",
  "m1-lcm",
];

const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
  new Date(),
);

/* ── 계정·개념 확인 (없으면 세팅이 아니라 시드가 먼저다) ─────── */
const [teacher] = await sql<{ id: string }[]>`
  select id::text from users where email = 'demo-teacher@su-maek.app'
`;
const [student] = await sql<{ id: string }[]>`
  select id::text from users where email = 'demo-student@su-maek.app'
`;
if (!teacher || !student) {
  console.error("데모 계정이 없습니다 — 먼저 pnpm --filter @su-maek/db demo-account");
  process.exit(1);
}
const [learner] = await sql<{ id: string; name: string }[]>`
  select id::text, display_name as name from learners
  where organization_id = ${ORG} and user_id = ${student.id}
`;
if (!learner) {
  console.error("demo-student에 연결된 학습자가 없습니다 — demo-account 시드를 확인하세요.");
  process.exit(1);
}

const concepts = await sql<{ id: string; slug: string; name: string }[]>`
  select id::text, slug, name from canonical_concepts
  where slug = any(${CONCEPT_SLUGS})
`;
const missing = CONCEPT_SLUGS.filter((s) => !concepts.some((c) => c.slug === s));
if (missing.length > 0) {
  console.error(`정본 개념이 없습니다: ${missing.join(", ")} — load-concepts를 먼저 돌리세요.`);
  process.exit(1);
}
const conceptIds = CONCEPT_SLUGS.map(
  (s) => concepts.find((c) => c.slug === s)!.id,
);

/* ── 반 · 소속 ────────────────────────────────────────────────── */
const [existingGroup] = await sql<{ id: string }[]>`
  select id::text from learning_groups
  where organization_id = ${ORG} and name = ${GROUP_NAME}
`;
const groupId = existingGroup?.id ?? uuidv7();
if (!existingGroup) {
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${groupId}, ${ORG}, ${uuidv7()}, ${GROUP_NAME}, 'operating')
  `;
}
const [membership] = await sql<{ id: string }[]>`
  select id::text from learning_group_memberships
  where learning_group_id = ${groupId} and learner_id = ${learner.id}
`;
if (!membership) {
  await sql`
    insert into learning_group_memberships (
      id, organization_id, learning_group_id, learner_id, status, joined_on
    ) values (${uuidv7()}, ${ORG}, ${groupId}, ${learner.id}, 'active', ${today}::date)
  `;
} else {
  await sql`
    update learning_group_memberships set status = 'active', updated_at = now()
    where id = ${membership.id}
  `;
}

/* ── 루트(발행) + 차시 노드 ───────────────────────────────────── */
const [existingPlan] = await sql<{ id: string; active_version_id: string | null }[]>`
  select id::text, active_version_id::text from route_plans
  where organization_id = ${ORG} and name = ${ROUTE_NAME}
`;
let nodeId: string;
if (existingPlan?.active_version_id) {
  const [node] = await sql<{ id: string }[]>`
    select id::text from route_nodes
    where route_version_id = ${existingPlan.active_version_id}
      and title = ${NODE_TITLE}
  `;
  nodeId = node?.id ?? uuidv7();
  if (node) {
    // 개념 목록은 최신으로 수렴시킨다 — 개념이 늘면 다시 돌리면 된다
    await sql`
      update route_nodes set concept_ids = ${sql.json(conceptIds as never)},
             updated_at = now()
      where id = ${nodeId}
    `;
  } else {
    await sql`
      insert into route_nodes (
        id, organization_id, route_version_id, kind, title, sort_order, concept_ids
      ) values (
        ${nodeId}, ${ORG}, ${existingPlan.active_version_id}, 'concept_lesson',
        ${NODE_TITLE}, 1, ${sql.json(conceptIds as never)}
      )
    `;
  }
} else {
  const planId = existingPlan?.id ?? uuidv7();
  const versionId = uuidv7();
  nodeId = uuidv7();
  if (!existingPlan) {
    await sql`
      insert into route_plans (
        id, organization_id, kind, name, learning_group_id, status, active_version_id
      ) values (
        ${planId}, ${ORG}, 'group_route', ${ROUTE_NAME}, ${groupId}, 'published', ${versionId}
      )
    `;
  } else {
    await sql`
      update route_plans set active_version_id = ${versionId}, status = 'published',
             updated_at = now()
      where id = ${planId}
    `;
  }
  await sql`
    insert into route_versions (id, organization_id, route_plan_id, version_number, status)
    values (${versionId}, ${ORG}, ${planId}, 1, 'published')
  `;
  await sql`
    insert into route_nodes (
      id, organization_id, route_version_id, kind, title, sort_order, concept_ids
    ) values (
      ${nodeId}, ${ORG}, ${versionId}, 'concept_lesson', ${NODE_TITLE}, 1,
      ${sql.json(conceptIds as never)}
    )
  `;
}

/* ── 오늘 세션 — 검증반의 세션 날짜는 실행일로 이동한다 ───────── */
const [existingSession] = await sql<{ id: string }[]>`
  select id::text from sessions
  where organization_id = ${ORG} and learning_group_id = ${groupId}
    and session_date = ${today}::date
`;
const sessionId = existingSession?.id ?? uuidv7();
if (existingSession) {
  await sql`
    update sessions set planned_node_ids = ${sql.json([nodeId] as never)},
           status = 'planned', updated_at = now()
    where id = ${sessionId}
  `;
} else {
  // 지난 날짜의 검증 세션은 치운다 — 세션이 쌓이면 교사 「오늘」 화면이 어지럽다
  await sql`
    delete from learner_schedule_items
    where organization_id = ${ORG} and learning_group_id = ${groupId}
      and item_date <> ${today}::date
  `;
  await sql`
    delete from sessions
    where organization_id = ${ORG} and learning_group_id = ${groupId}
      and session_date <> ${today}::date
  `;
  await sql`
    insert into sessions (
      id, organization_id, learning_group_id, session_date, timezone,
      starts_at, ends_at, status, planned_node_ids
    ) values (
      ${sessionId}, ${ORG}, ${groupId}, ${today}::date, ${TZ},
      ${`${today}T09:00:00+09:00`}, ${`${today}T22:00:00+09:00`}, 'planned',
      ${sql.json([nodeId] as never)}
    )
  `;
}

/* ── 개별 일정에도 얹는다 — 학생의 「오늘」은 개별 일정(learner_schedule_
 * items)이 있으면 반 세션을 **무시한다** (today-context의 우선순위). 데모
 * 학생에게는 기존 데모 일정이 이미 있어서, 여기 안 얹으면 1단원이 학생
 * 화면에 영영 안 나온다 — 실제 화면으로 확인한 함정이다. */
const [existingItem] = await sql<{ id: string }[]>`
  select id::text from learner_schedule_items
  where organization_id = ${ORG} and learner_id = ${learner.id}
    and learning_group_id = ${groupId} and item_date = ${today}::date
`;
if (existingItem) {
  await sql`
    update learner_schedule_items
    set planned_node_ids = ${sql.json([nodeId] as never)},
        session_id = ${sessionId}, updated_at = now()
    where id = ${existingItem.id}
  `;
} else {
  await sql`
    insert into learner_schedule_items (
      id, organization_id, learner_id, learning_group_id, session_id,
      item_date, timezone, starts_at, ends_at, planned_node_ids,
      reason_codes, matches_group
    ) values (
      ${uuidv7()}, ${ORG}, ${learner.id}, ${groupId}, ${sessionId},
      ${today}::date, ${TZ}, ${`${today}T09:00:00+09:00`},
      ${`${today}T22:00:00+09:00`}, ${sql.json([nodeId] as never)},
      ${sql.json(["demo_unit1_verification"] as never)}, true
    )
  `;
}

/* ── 정제본 게시 — 게시 게이트와 같은 기준 ────────────────────── */
const refinedDrafts = await sql<{ id: string; title: string }[]>`
  select m.id::text, m.title from learning_materials m
  where m.organization_id = ${ORG} and m.kind = 'reading' and m.status = 'draft'
    and m.derived_from_material_id is not null
    and m.source_ref ? 'refineReport'
    and not (m.source_ref ? 'extractedBy')   -- 추출본은 어떤 경로로도 게시 금지
    and m.concept_id = any(${conceptIds}::uuid[])
`;
for (const m of refinedDrafts) {
  await sql.begin(async (tx) => {
    await tx`
      update learning_materials set status = 'published', updated_at = now()
      where id = ${m.id} and organization_id = ${ORG}
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, before, after
      ) values (
        ${uuidv7()}, ${ORG}, 'user', ${teacher.id},
        'material.publish', 'learning_material', ${m.id},
        ${`${m.title} — 데모 1단원 검증 세팅(seed-unit1-demo)`},
        ${tx.json({ status: "draft" } as never)}, ${tx.json({ status: "published" } as never)}
      )
    `;
  });
}

/* ── 연습문제 상태 보고 (자동으로 바꾸지 않는다) ──────────────── */
const [practice] = await sql<{ usable: number; total: number }[]>`
  select
    count(*) filter (
      where q.review_status = 'published' and r.status = 'usable'
    )::int as usable,
    count(*)::int as total
  from questions q
  join content_rights r on r.id = q.content_right_id
  where q.organization_id = ${ORG}
    and exists (
      select 1 from question_alignments a
      where a.question_id = q.id and a.concept_id = any(${conceptIds}::uuid[])
    )
`;

const publishedNow = await sql<{ cnt: number }[]>`
  select count(*)::int as cnt from learning_materials
  where organization_id = ${ORG} and kind = 'reading' and status = 'published'
    and concept_id = any(${conceptIds}::uuid[])
`;

console.log(`오늘(${TZ}) = ${today}`);
console.log(`반 «${GROUP_NAME}» · 학습자 «${learner.name}» 소속 active`);
console.log(`차시 노드 개념 ${conceptIds.length}종 → 오늘 세션 연결`);
console.log(
  `읽기 자료: 이번에 게시 ${refinedDrafts.length}건 · 현재 published ${publishedNow[0]!.cnt}건`,
);
console.log(
  `연습문제(1단원 개념 정렬): 출제 가능 ${practice!.usable} / 전체 ${practice!.total}` +
    (practice!.usable === 0
      ? " — 문항 검수·사용권 확정 전이라 연습·테스트 검증은 그 뒤에 가능"
      : ""),
);
console.log("\n학생: /learn/today → 개념 공부 · 교사: /app/content/materials");
await sql.end();
