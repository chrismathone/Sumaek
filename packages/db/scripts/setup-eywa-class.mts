/**
 * eywa(인재원) 중1 수학 반 하나를 수맥으로 가져와 끝까지 세팅한다 — 멱등.
 *
 *   pnpm --filter @su-maek/db exec tsx scripts/setup-eywa-class.mts
 *   … --class="중등M 중1 BS3C"   반을 직접 고른다 (기본: 중1만 있는 활성 수학 반 중 인원 최다)
 *   … --names=real               학생 이름을 eywa 실제 값으로 (기본: 합성)
 *   … --reset                    이 스크립트가 만든 것만 지운다
 *
 * **왜 데모 조직에 넣는가.** 콘텐츠(문항·자료)는 플랫폼 전체 자산이고
 * 마스터 계정만 넣는다 — 조직마다 콘텐츠를 따로 두지 않는다(소유자 결정
 * 2026-08-05). 지금 그 마스터 자리에 있는 것이 데모 조직이고, 중1 1단원
 * 문항 213건과 게시 자료가 전부 여기 있다.
 *
 * 스키마는 아직 이 결정을 따라가지 못했다 — `questions.organization_id`가
 * NOT NULL이고 RLS도 조직 격리다. 그래서 다른 조직에 반을 만들면 그 조직은
 * 개념만 알고 보여 줄 것이 없다(학생 화면이 빈다). 콘텐츠를 조직마다
 * 복사하는 것은 「조직별 콘텐츠」를 만드는 일이라 방향과 정반대다.
 * 그래서 복사하지 않고 **콘텐츠가 있는 곳에 반을 얹는다.**
 *
 * 콘텐츠를 진짜 전체 DB 자산으로 만드는 일(플랫폼 조직 도입 또는
 * organization_id nullable + RLS 완화)은 이 스크립트의 몫이 아니다.
 *
 * **--reset은 조직을 지우지 않는다.** 여기는 데모 조직이다. 이 스크립트가
 * 만든 것만 골라 지운다 — 골라내는 기준은 external_identities(provider
 * 'eywa')와 계정 이메일 접두사다. 기준 없이 지우면 데모 데이터를 함께
 * 날린다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import { v7 as uuidv7 } from "uuid";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

/* ── 인자 ─────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const arg = (k: string) =>
  argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const RESET = argv.includes("--reset");
const REAL_NAMES = arg("names") === "real";
const CLASS_NAME = arg("class");

/* ── 상수 ─────────────────────────────────────────────────────── */
/** 콘텐츠가 있는 곳 = 지금의 콘텐츠 마스터. 반도 여기에 얹는다. */
const ORG = "00000000-0000-7000-8000-000000000001";
const TZ = "Asia/Seoul";
const PROVIDER = "eywa";
const PASSWORD = process.env.EYWA_TEST_PASSWORD ?? "1234@@@@";
const TEACHER_EMAIL = "eywa-teacher@su-maek.test";
/** 이 스크립트가 만든 계정을 골라내는 유일한 기준 */
const ACCOUNT_PREFIX = "eywa-";
const ROUTE_NAME = "인재원 중1 1단원 루트";
const NODE_TITLE = "소인수분해 — 1단원 개념 차시";
/** kwr-2022 매핑 표와 같은 정본 개념 — 중1 1단원(소인수분해 계열) */
const CONCEPT_SLUGS = [
  "m1-prime-composite",
  "m1-prime-factorization",
  "m1-divisors",
  "m1-gcd",
  "m1-lcm",
];

const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL이 없습니다.");
const sql = postgres(url.trim(), { max: 4 });

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!sbUrl || !sbKey) throw new Error("Supabase URL/service_role 키가 필요합니다.");
const admin = createClient(sbUrl, sbKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ═══ --reset ═════════════════════════════════════════════════
 * 불변 트리거는 **앱의 실수**를 막으려고 있는 것이지 DB 소유자를 막는
 * 장치가 아니다 — 테스트 6개 파일이 이미 같은 일을 한다. 내렸다 반드시
 * 다시 올린다(finally). 올리지 못하면 그 표는 그 뒤로 무방비다. */
const TRIGGERS: [string, string][] = [
  ["audit_events", "audit_events_immutable"],
  ["mastery_evidences", "mastery_evidences_immutable"],
  ["progress_events", "progress_events_immutable"],
  ["grade_decisions", "grade_decisions_immutable"],
  ["learner_day_plans", "learner_day_plans_completion_immutable"],
];

if (RESET) {
  const learners = await sql<{ id: string }[]>`
    select target_id::text as id from external_identities
    where organization_id = ${ORG} and provider = ${PROVIDER} and target_type = 'learner'
  `;
  const learnerIds = learners.map((l) => l.id);
  const groups = await sql<{ id: string }[]>`
    select target_id::text as id from external_identities
    where organization_id = ${ORG} and provider = ${PROVIDER} and target_type = 'learning_group'
  `;
  const groupIds = groups.map((g) => g.id);

  try {
    for (const [t, trg] of TRIGGERS) {
      await sql.unsafe(`alter table ${t} disable trigger ${trg}`).catch(() => {});
    }
    if (learnerIds.length > 0) {
      /* 학습자에 매달린 것부터 — 응시·증거·계획 순으로 안쪽에서 바깥으로 */
      await sql`delete from responses where attempt_id in (
        select id from attempts where learner_id = any(${learnerIds}::uuid[]))`;
      await sql`delete from grade_decisions where organization_id = ${ORG}
        and response_id not in (select id from responses)`;
      await sql`delete from attempts where learner_id = any(${learnerIds}::uuid[])`;
      await sql`delete from mastery_evidences where learner_id = any(${learnerIds}::uuid[])`;
      await sql`delete from concept_masteries where learner_id = any(${learnerIds}::uuid[])`;
      await sql`delete from review_items where learner_id = any(${learnerIds}::uuid[])`;
      await sql`delete from progress_events where learner_id = any(${learnerIds}::uuid[])`;
      await sql`delete from learner_day_plan_items where plan_id in (
        select id from learner_day_plans where learner_id = any(${learnerIds}::uuid[]))`;
      await sql`delete from learner_day_plans where learner_id = any(${learnerIds}::uuid[])`;
      await sql`delete from learner_schedule_items where learner_id = any(${learnerIds}::uuid[])`;
      await sql`delete from learning_group_memberships where learner_id = any(${learnerIds}::uuid[])`;
      await sql`delete from external_identities where organization_id = ${ORG} and provider = ${PROVIDER}`;
      await sql`delete from learners where id = any(${learnerIds}::uuid[])`;
    }
    if (groupIds.length > 0) {
      await sql`delete from sessions where learning_group_id = any(${groupIds}::uuid[])`;
      await sql`delete from route_publications where route_plan_id in (
        select id from route_plans where organization_id = ${ORG} and name = ${ROUTE_NAME})`;
      await sql`delete from route_nodes where route_version_id in (
        select v.id from route_versions v join route_plans p on p.id = v.route_plan_id
        where p.organization_id = ${ORG} and p.name = ${ROUTE_NAME})`;
      await sql`update route_plans set active_version_id = null
        where organization_id = ${ORG} and name = ${ROUTE_NAME}`;
      await sql`delete from route_versions where route_plan_id in (
        select id from route_plans where organization_id = ${ORG} and name = ${ROUTE_NAME})`;
      await sql`delete from route_plans where organization_id = ${ORG} and name = ${ROUTE_NAME}`;
      await sql`delete from learning_groups where id = any(${groupIds}::uuid[])`;
    }
    /* 계정은 이메일 접두사로만 고른다 — 데모 계정(demo-*)과 사람 계정
     * (st2000423 등)은 이 패턴에 걸리지 않는다. */
    const accounts = await sql<{ id: string; email: string }[]>`
      select id::text, email from users
      where email like ${`${ACCOUNT_PREFIX}%@su-maek.test`}
    `;
    if (accounts.length > 0) {
      const ids = accounts.map((a) => a.id);
      await sql`delete from memberships where user_id = any(${ids}::uuid[])`;
      await sql`delete from users where id = any(${ids}::uuid[])`;
      for (const a of accounts) await admin.auth.admin.deleteUser(a.id).catch(() => {});
    }
    console.log(
      `되돌림 — 학습자 ${learnerIds.length}명 · 반 ${groupIds.length}개 · 계정 ${accounts.length}개.`,
    );
  } finally {
    for (const [t, trg] of TRIGGERS) {
      await sql.unsafe(`alter table ${t} enable trigger ${trg}`).catch(() => {});
    }
  }
  await sql.end();
  process.exit(0);
}

/* ═══ 1. eywa에서 반 하나 ══════════════════════════════════════ */
function loadEywaUrl(): string {
  if (process.env.EYWA_DATABASE_URL) return process.env.EYWA_DATABASE_URL;
  const { parsed } = config({ path: ["D:/eywa_refactoring/.env.local"], override: false });
  const v = parsed?.DATABASE_URL;
  if (!v) throw new Error("eywa DATABASE_URL을 찾지 못했습니다 (EYWA_DATABASE_URL로 넘길 수 있습니다).");
  return v;
}
const eywa = postgres(loadEywaUrl().trim(), { max: 1, prepare: false });

const [picked] = await eywa<{ id: string; class_name: string }[]>`
  select c.id::text as id, c.class_name
  from classes c
  join enrollments e on e.class_id = c.id and e.end_date is null
  join students s on s.id = e.student_id and s.status = 'enrolled'
  where c.subject = 'math' and c.is_active
    and (${CLASS_NAME ?? null}::text is null or c.class_name = ${CLASS_NAME ?? null})
  group by c.id, c.class_name
  /* 중1만 있는 반을 먼저 — 학년이 섞인 반은 「중1반 세팅」이라는 말과 어긋난다 */
  having count(*) filter (where s.grade <> '중1') = 0
     and count(*) filter (where s.grade = '중1') > 0
  order by count(*) filter (where s.grade = '중1') desc, c.class_name
  limit 1
`;
if (!picked) throw new Error("조건에 맞는 eywa 중1 수학 반을 찾지 못했습니다.");

const eywaStudents = await eywa<{ id: string; name: string; grade: string }[]>`
  select s.id::text as id, s.name, s.grade
  from students s
  join enrollments e on e.student_id = s.id and e.class_id = ${picked.id} and e.end_date is null
  where s.status = 'enrolled' and s.grade = '중1'
  order by s.name
`;
await eywa.end();
console.log(`eywa 반 «${picked.class_name}» — 재원 중1 ${eywaStudents.length}명`);

/* 이름은 기본이 합성이다. 반 이름·인원·학년·소속 관계는 **실제 그대로**라
 * 테스트 현실성은 같고, 실이름이 필요하면 --names=real로 켠다. */
const SYNTHETIC = ["김하늘","이서준","박지우","최민서","정예린","강도현","윤소율","임태윤","한서아","오준혁"];
const displayNameOf = (s: { name: string }, i: number) =>
  REAL_NAMES ? s.name : (SYNTHETIC[i] ?? `학생${i + 1}`);

/* ═══ 2. 개념 확인 ════════════════════════════════════════════ */
const concepts = await sql<{ id: string; slug: string; name: string }[]>`
  select id::text, slug, name from canonical_concepts where slug = any(${CONCEPT_SLUGS})
`;
const missing = CONCEPT_SLUGS.filter((s) => !concepts.some((c) => c.slug === s));
if (missing.length > 0) throw new Error(`정본 개념 없음: ${missing.join(", ")}`);
const conceptIds = CONCEPT_SLUGS.map((s) => concepts.find((c) => c.slug === s)!.id);

/* ═══ 3. 계정 ═════════════════════════════════════════════════ */
async function ensureAuthUser(email: string, displayName: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (!error) return data.user.id;
  if (!/already|exists|registered/i.test(error.message)) throw error;
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const found = list.users.find((u) => u.email === email)?.id;
  if (!found) throw new Error(`기존 계정을 찾지 못했습니다: ${email}`);
  await admin.auth.admin.updateUserById(found, { password: PASSWORD });
  return found;
}

const teacherId = await ensureAuthUser(TEACHER_EMAIL, "인재원 선생님");
await sql`
  insert into users (id, default_organization_id, email, display_name)
  values (${teacherId}, ${ORG}, ${TEACHER_EMAIL}, '인재원 선생님')
  on conflict (id) do update set default_organization_id = ${ORG}
`;
await sql`
  insert into memberships (id, organization_id, user_id, role, status)
  values (${uuidv7()}, ${ORG}, ${teacherId}, 'owner', 'active')
  on conflict (organization_id, user_id) do update set role = 'owner', status = 'active'
`;

/* ═══ 4. 반 ═══════════════════════════════════════════════════ */
const [periodRow] = await sql<{ id: string }[]>`
  select id::text from course_periods where organization_id = ${ORG}
    and status = 'active' order by created_at limit 1
`;
const periodId = periodRow?.id ?? uuidv7();
if (!periodRow) {
  await sql`
    insert into course_periods (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${periodId}, ${ORG}, '2026학년도', 2026, '2026-03-01', '2027-02-28', 'active')
  `;
}

const groupName = `인재원 ${picked.class_name}`;
const [existingGroup] = await sql<{ id: string }[]>`
  select id::text from learning_groups where organization_id = ${ORG} and name = ${groupName}
`;
const groupId = existingGroup?.id ?? uuidv7();
if (!existingGroup) {
  await sql`
    insert into learning_groups (
      id, organization_id, course_period_id, name, course_name, home_teacher_user_id, status
    ) values (
      ${groupId}, ${ORG}, ${periodId}, ${groupName}, '중등 1-1', ${teacherId}, 'operating'
    )
  `;
}
await sql`
  insert into external_identities (
    id, organization_id, provider, external_id, target_type, target_id, payload, synced_at
  ) values (
    ${uuidv7()}, ${ORG}, ${PROVIDER}, ${picked.id}, 'learning_group', ${groupId},
    ${sql.json({ className: picked.class_name, subject: "math" } as never)}, now()
  )
  on conflict (organization_id, provider, external_id) do update
    set target_id = ${groupId}, synced_at = now()
`;

/* ═══ 5. 학습자 · 소속 · 학생 계정 ════════════════════════════ */
const learnerIds: string[] = [];
const accounts: { name: string; email: string }[] = [];
for (const [i, s] of eywaStudents.entries()) {
  const name = displayNameOf(s, i);
  /* eywa 학생 id로 고정한다 — 다시 돌려도 같은 학습자에 붙는다 */
  const [ext] = await sql<{ target_id: string }[]>`
    select target_id::text from external_identities
    where organization_id = ${ORG} and provider = ${PROVIDER} and external_id = ${s.id}
      and target_type = 'learner'
  `;
  const learnerId = ext?.target_id ?? uuidv7();
  const email = `${ACCOUNT_PREFIX}s${String(i + 1).padStart(2, "0")}@su-maek.test`;
  const uid = await ensureAuthUser(email, name);

  if (ext) {
    await sql`
      update learners set display_name = ${name}, grade_level = 'middle-1',
             status = 'active', user_id = ${uid}, updated_at = now()
      where id = ${learnerId}
    `;
  } else {
    await sql`
      insert into learners (id, organization_id, display_name, grade_level, status, user_id)
      values (${learnerId}, ${ORG}, ${name}, 'middle-1', 'active', ${uid})
    `;
    await sql`
      insert into external_identities (
        id, organization_id, provider, external_id, target_type, target_id, payload, synced_at
      ) values (
        ${uuidv7()}, ${ORG}, ${PROVIDER}, ${s.id}, 'learner', ${learnerId},
        ${sql.json({ grade: s.grade, className: picked.class_name, nameIsReal: REAL_NAMES } as never)},
        now()
      )
    `;
  }
  learnerIds.push(learnerId);

  await sql`
    insert into users (id, default_organization_id, email, display_name)
    values (${uid}, ${ORG}, ${email}, ${name})
    on conflict (id) do update set default_organization_id = ${ORG}, display_name = ${name}
  `;
  await sql`
    insert into memberships (id, organization_id, user_id, role, status)
    values (${uuidv7()}, ${ORG}, ${uid}, 'student', 'active')
    on conflict (organization_id, user_id) do update set role = 'student', status = 'active'
  `;
  await sql`
    insert into learning_group_memberships (
      id, organization_id, learning_group_id, learner_id, status, joined_on
    ) values (${uuidv7()}, ${ORG}, ${groupId}, ${learnerId}, 'active', ${today}::date)
    on conflict do nothing
  `;
  accounts.push({ name, email });
}

/* ═══ 6. 루트(발행) · 노드 ════════════════════════════════════ */
const [plan] = await sql<{ id: string; active_version_id: string | null }[]>`
  select id::text, active_version_id::text from route_plans
  where organization_id = ${ORG} and name = ${ROUTE_NAME}
`;
const planId = plan?.id ?? uuidv7();
const versionId = plan?.active_version_id ?? uuidv7();
if (!plan) {
  await sql`
    insert into route_plans (id, organization_id, kind, name, learning_group_id, status, active_version_id)
    values (${planId}, ${ORG}, 'group_route', ${ROUTE_NAME}, ${groupId}, 'published', ${versionId})
  `;
  await sql`
    insert into route_versions (id, organization_id, route_plan_id, version_number, status)
    values (${versionId}, ${ORG}, ${planId}, 1, 'published')
  `;
} else if (!plan.active_version_id) {
  await sql`
    insert into route_versions (id, organization_id, route_plan_id, version_number, status)
    values (${versionId}, ${ORG}, ${planId}, 1, 'published')
  `;
  await sql`
    update route_plans set active_version_id = ${versionId}, status = 'published' where id = ${planId}
  `;
}

const [node] = await sql<{ id: string }[]>`
  select id::text from route_nodes where route_version_id = ${versionId} and title = ${NODE_TITLE}
`;
const nodeId = node?.id ?? uuidv7();
if (node) {
  await sql`
    update route_nodes set concept_ids = ${sql.json(conceptIds as never)}, updated_at = now()
    where id = ${nodeId}
  `;
} else {
  await sql`
    insert into route_nodes (id, organization_id, route_version_id, kind, title, sort_order, concept_ids)
    values (${nodeId}, ${ORG}, ${versionId}, 'concept_lesson', ${NODE_TITLE}, 1,
            ${sql.json(conceptIds as never)})
  `;
}
const [pub] = await sql<{ id: string }[]>`
  select id::text from route_publications
  where organization_id = ${ORG} and route_version_id = ${versionId}
`;
if (!pub) {
  await sql`
    insert into route_publications (id, organization_id, route_plan_id, route_version_id, published_by, published_at)
    values (${uuidv7()}, ${ORG}, ${planId}, ${versionId}, ${teacherId}, now())
  `;
}

/* ═══ 7. 오늘 세션 · 개별 일정 ════════════════════════════════
 * 학생의 「오늘」은 개별 일정이 있으면 반 세션을 **무시한다**(day-plan의
 * 우선순위). 반 세션만 두면 이 학생들에게는 아무것도 안 나올 수 있으므로
 * 둘 다 얹는다. 시간대는 10:00~22:00 — 09:00 칸은 db:seed·E2E가 쓰는
 * 자리라 배타 제약(learner_schedule_items_no_overlap)이 부딪힌다. */
await sql`
  delete from sessions where organization_id = ${ORG} and learning_group_id = ${groupId}
    and session_date <> ${today}::date
`;
const [existingSession] = await sql<{ id: string }[]>`
  select id::text from sessions
  where organization_id = ${ORG} and learning_group_id = ${groupId} and session_date = ${today}::date
`;
const sessionId = existingSession?.id ?? uuidv7();
if (existingSession) {
  await sql`
    update sessions set planned_node_ids = ${sql.json([nodeId] as never)},
           status = 'planned', updated_at = now()
    where id = ${sessionId}
  `;
} else {
  await sql`
    insert into sessions (id, organization_id, learning_group_id, session_date, timezone,
                          starts_at, ends_at, status, planned_node_ids)
    values (${sessionId}, ${ORG}, ${groupId}, ${today}::date, ${TZ},
            ${`${today}T09:00:00+09:00`}, ${`${today}T22:00:00+09:00`}, 'planned',
            ${sql.json([nodeId] as never)})
  `;
}

for (const learnerId of learnerIds) {
  await sql`
    delete from learner_schedule_items
    where organization_id = ${ORG} and learner_id = ${learnerId} and item_date <> ${today}::date
  `;
  const [item] = await sql<{ id: string }[]>`
    select id::text from learner_schedule_items
    where organization_id = ${ORG} and learner_id = ${learnerId} and item_date = ${today}::date
  `;
  if (item) {
    await sql`
      update learner_schedule_items
      set planned_node_ids = ${sql.json([nodeId] as never)}, session_id = ${sessionId},
          learning_group_id = ${groupId},
          starts_at = ${`${today}T10:00:00+09:00`}, ends_at = ${`${today}T22:00:00+09:00`},
          updated_at = now()
      where id = ${item.id}
    `;
  } else {
    await sql`
      insert into learner_schedule_items (
        id, organization_id, learner_id, learning_group_id, session_id,
        item_date, timezone, starts_at, ends_at, planned_node_ids, reason_codes, matches_group
      ) values (
        ${uuidv7()}, ${ORG}, ${learnerId}, ${groupId}, ${sessionId},
        ${today}::date, ${TZ}, ${`${today}T10:00:00+09:00`}, ${`${today}T22:00:00+09:00`},
        ${sql.json([nodeId] as never)}, ${sql.json(["eywa_import"] as never)}, true
      )
    `;
  }
}

/* ═══ 8. 보고 ═════════════════════════════════════════════════ */
const [counts] = await sql<{ usable: number; reading: number; practice: number }[]>`
  select
    (select count(*)::int from questions q join content_rights r on r.id = q.content_right_id
      where q.organization_id = ${ORG} and q.review_status = 'published' and r.status = 'usable'
        and exists (select 1 from question_alignments a
                    where a.question_id = q.id and a.concept_id = any(${conceptIds}::uuid[]))) as usable,
    (select count(*)::int from learning_materials
      where organization_id = ${ORG} and kind = 'reading' and status = 'published'
        and concept_id = any(${conceptIds}::uuid[])) as reading,
    (select count(*)::int from learning_materials
      where organization_id = ${ORG} and kind = 'practice' and status = 'published'
        and concept_id = any(${conceptIds}::uuid[])) as practice
`;

console.log(`\n반   «${groupName}» — 학습자 ${learnerIds.length}명 · 오늘(${today}) 세션·개별 일정 연결`);
console.log(`루트 «${ROUTE_NAME}» 발행 · 차시 노드 개념 ${conceptIds.length}종`);
console.log(`콘텐츠(데모 조직 공용): 연습 가능 문항 ${counts!.usable} · 읽기 자료 ${counts!.reading} · 연습 자료 ${counts!.practice}`);
console.log(`이름: ${REAL_NAMES ? "eywa 실제 값" : "합성 (반·인원·학년·소속은 실제 그대로)"}`);
console.log(`\n로그인 — 비밀번호 전부 ${PASSWORD}`);
console.log(`  교사  ${TEACHER_EMAIL}`);
for (const a of accounts) console.log(`  학생  ${a.email}  (${a.name})`);
console.log(`\n되돌리기: pnpm --filter @su-maek/db exec tsx scripts/setup-eywa-class.mts --reset`);
await sql.end();
