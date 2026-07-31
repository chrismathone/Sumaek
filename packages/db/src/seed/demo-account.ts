import { config } from "dotenv";
config({ path: [".env", "../../.env"] });
import { createClient } from "@supabase/supabase-js";
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../client";

/**
 * 데모 교사 계정 생성 (멱등) — service_role 관리자 API.
 * 시드된 데모 워크스페이스의 owner 멤버십을 연결한다.
 * 실행: pnpm --filter @su-maek/db demo-account
 */
const ORG_ID = "00000000-0000-7000-8000-000000000001";
const EMAIL = "demo-teacher@su-maek.app";
const PASSWORD = process.env.DEMO_TEACHER_PASSWORD ?? "sumaek-demo-2026!";

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
      process.env.DEMO_STUDENT_PASSWORD ?? "sumaek-student-2026!";
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

    console.log(
      `[demo-account] 준비 완료 — 교사 ${EMAIL} / 학생 ${STUDENT_EMAIL}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("[demo-account] 실패", e);
  process.exit(1);
});
