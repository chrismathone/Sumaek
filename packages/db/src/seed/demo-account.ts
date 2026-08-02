import { config } from "dotenv";
config({ path: [".env", "../../.env"] });
import { createClient } from "@supabase/supabase-js";
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../client";

/**
 * 계정 준비 (멱등) — service_role 관리자 API.
 * 실행: pnpm --filter @su-maek/db demo-account
 *
 * 두 벌을 만든다.
 *
 * 1. **데모 계정** (demo-teacher / demo-student) — E2E와 통합 테스트가 쓴다.
 *    학생 쪽은 박서윤에 붙는다. 테스트가 이 계정으로 로그인해 화면을 검증한다.
 *
 * 2. **내 계정** (st2000423 / st2000424) — 사람이 손으로 확인할 때 쓴다.
 *    데모 계정과 **다른 학습자**(이도윤)에 붙이는 것이 요점이다. 예전에는
 *    사람과 테스트가 같은 학생 계정을 나눠 쓰다가, 테스트가 도는 사이에
 *    로그인하면 「학습자 정보가 연결되지 않았습니다」가 떠서 제품이 고장 난
 *    것처럼 보였다. 계정과 학습자를 아예 갈라 두면 그 일이 구조적으로 없다.
 */
const ORG_ID = "00000000-0000-7000-8000-000000000001";
const EMAIL = "demo-teacher@su-maek.app";
/* 전부 같은 기본값을 쓴다 — 사람이 손으로 로그인해 확인하는 일이 잦은데
 * 계정마다 다른 문자열을 외우게 할 이유가 없다. 개발 시드 자격증명이고,
 * 실제 운영에 올릴 때는 .env로 반드시 덮어써야 한다(교사 계정이 owner다). */
const DEFAULT_PASSWORD = "1234@@@@";
const PASSWORD = process.env.DEMO_TEACHER_PASSWORD ?? DEFAULT_PASSWORD;
/* 사람이 쓰는 계정의 비밀번호. .env로 바꿀 수 있고, 바꾸면 다음 실행에서
 * 그 값으로 재설정된다 — 잊었을 때 되돌릴 방법이 이것이다. */
const MY_TEACHER_PASSWORD = process.env.MY_TEACHER_PASSWORD ?? DEFAULT_PASSWORD;
const MY_STUDENT_PASSWORD = process.env.MY_STUDENT_PASSWORD ?? DEFAULT_PASSWORD;

/** admin API 중 이 스크립트가 쓰는 부분만 — supabase-js 제네릭에 얽히지 않는다 */
type SupabaseAdmin = ReturnType<typeof createClient>["auth"]["admin"];

/** 인증 계정을 만들거나(이미 있으면) 비밀번호를 맞춰 준다 — 멱등 */
async function ensureAuthUser(
  admin: { auth: { admin: SupabaseAdmin } },
  email: string,
  password: string,
  displayName: string,
): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (!error) return created.user.id;
  if (!/already|exists|registered/i.test(error.message)) throw error;
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  const found = list.users.find((u) => u.email === email)?.id;
  if (!found) throw new Error(`기존 계정을 찾지 못했습니다: ${email}`);
  await admin.auth.admin.updateUserById(found, { password });
  return found;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase URL/service_role 키가 필요합니다.");

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 멱등: 이미 있으면 재사용
  let userId: string | null = null;
  const { data: created, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "데모 선생님" },
  });
  if (error) {
    if (!/already|exists|registered/i.test(error.message)) throw error;
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
    userId = list.users.find((u) => u.email === EMAIL)?.id ?? null;
    if (!userId) throw new Error("기존 계정을 찾지 못했습니다.");
    await admin.auth.admin.updateUserById(userId, { password: PASSWORD });
  } else {
    userId = created.user.id;
  }

  const sql = createSql();
  try {
    // 트리거가 public.users를 만들지만, 표시명·기본 워크스페이스를 보정
    await sql`
      insert into users (id, email, display_name, default_organization_id)
      values (${userId}, ${EMAIL}, ${"데모 선생님"}, ${ORG_ID})
      on conflict (id) do update
        set display_name = excluded.display_name,
            default_organization_id = excluded.default_organization_id
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status, joined_at)
      values (${uuidv7()}, ${ORG_ID}, ${userId}, 'owner', 'active', now())
      on conflict (organization_id, user_id) do update set status = 'active'
    `;
    await sql`
      update learning_groups set home_teacher_user_id = ${userId}
      where organization_id = ${ORG_ID}
    `;

    /* 데모 학생 계정 — 박서윤 학습자에 연결 */
    const STUDENT_EMAIL = "demo-student@su-maek.app";
    const STUDENT_PASSWORD =
      process.env.DEMO_STUDENT_PASSWORD ?? DEFAULT_PASSWORD;
    const LEARNER_ID = "00000000-0000-7000-8000-000000000101"; // 박서윤

    let studentId: string | null = null;
    const { data: sCreated, error: sError } = await admin.auth.admin.createUser({
      email: STUDENT_EMAIL,
      password: STUDENT_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "박서윤" },
    });
    if (sError) {
      if (!/already|exists|registered/i.test(sError.message)) throw sError;
      const { data: list2 } = await admin.auth.admin.listUsers({ perPage: 200 });
      studentId = list2.users.find((u) => u.email === STUDENT_EMAIL)?.id ?? null;
      if (!studentId) throw new Error("기존 학생 계정을 찾지 못했습니다.");
      await admin.auth.admin.updateUserById(studentId, {
        password: STUDENT_PASSWORD,
      });
    } else {
      studentId = sCreated.user.id;
    }
    await sql`
      insert into users (id, email, display_name, default_organization_id)
      values (${studentId}, ${STUDENT_EMAIL}, ${"박서윤"}, ${ORG_ID})
      on conflict (id) do update
        set display_name = excluded.display_name,
            default_organization_id = excluded.default_organization_id
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status, joined_at)
      values (${uuidv7()}, ${ORG_ID}, ${studentId}, 'student', 'active', now())
      on conflict (organization_id, user_id) do update set status = 'active'
    `;
    await sql`
      update learners set user_id = ${studentId} where id = ${LEARNER_ID}
    `;

    /* ── 사람이 쓰는 계정 — 테스트가 절대 건드리지 않는 학습자에 붙인다 ── */
    const MY_TEACHER_EMAIL = "st2000423@gmail.com";
    const MY_STUDENT_EMAIL = "st2000424@gmail.com";
    const MY_LEARNER_ID = "00000000-0000-7000-8000-000000000102"; // 이도윤

    const myTeacherId = await ensureAuthUser(
      admin,
      MY_TEACHER_EMAIL,
      MY_TEACHER_PASSWORD,
      "선생님 (내 계정)",
    );
    await sql`
      insert into users (id, email, display_name, default_organization_id)
      values (${myTeacherId}, ${MY_TEACHER_EMAIL}, ${"선생님 (내 계정)"}, ${ORG_ID})
      on conflict (id) do update
        set display_name = excluded.display_name,
            default_organization_id = excluded.default_organization_id
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status, joined_at)
      values (${uuidv7()}, ${ORG_ID}, ${myTeacherId}, 'owner', 'active', now())
      on conflict (organization_id, user_id) do update set status = 'active'
    `;

    const myStudentId = await ensureAuthUser(
      admin,
      MY_STUDENT_EMAIL,
      MY_STUDENT_PASSWORD,
      "이도윤",
    );
    await sql`
      insert into users (id, email, display_name, default_organization_id)
      values (${myStudentId}, ${MY_STUDENT_EMAIL}, ${"이도윤"}, ${ORG_ID})
      on conflict (id) do update
        set display_name = excluded.display_name,
            default_organization_id = excluded.default_organization_id
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status, joined_at)
      values (${uuidv7()}, ${ORG_ID}, ${myStudentId}, 'student', 'active', now())
      on conflict (organization_id, user_id) do update set status = 'active'
    `;
    /* 다른 학습자에 잘못 붙어 있으면 떼고 붙인다 — learners.user_id는
     * 한 학습자에 하나뿐이라 옮겨 붙일 때 먼저 비워야 한다. */
    await sql`
      update learners set user_id = null, updated_at = now()
      where organization_id = ${ORG_ID} and user_id = ${myStudentId}
        and id <> ${MY_LEARNER_ID}
    `;
    await sql`
      update learners set user_id = ${myStudentId}, updated_at = now()
      where id = ${MY_LEARNER_ID} and organization_id = ${ORG_ID}
    `;

    console.log(
      `[demo-account] 준비 완료
` +
        `  테스트용 — 교사 ${EMAIL} / 학생 ${STUDENT_EMAIL} (박서윤)
` +
        `  내 계정  — 교사 ${MY_TEACHER_EMAIL} / 학생 ${MY_STUDENT_EMAIL} (이도윤)`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("[demo-account] 실패", e);
  process.exit(1);
});
