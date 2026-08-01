import "server-only";
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { createAdminClient } from "@/lib/supabase/admin";

/* ─────────────────────────────────────────────────────────────
 * 학습자 ↔ 로그인 계정 연결 (4장).
 *
 * 이 모듈이 생기기 전까지 `learners.user_id`를 채우는 곳은 **데모 시드 한
 * 줄뿐**이었다. 즉 제품 화면으로 등록한 학습자는 어떤 계정으로도 학생 앱에
 * 들어올 수 없었고, `learn/layout.tsx`가 안내하는 "선생님께 계정 연결 요청"을
 * 처리할 화면 자체가 없었다. 여기가 그 처리 지점이다.
 *
 * 설계 결정 셋:
 *  1. **이미 있는 계정이면 새로 만들지 않는다.** 같은 사람이 학원을 옮기거나
 *     형제가 한 이메일을 쓰는 경우가 있어, 이메일이 이미 있으면 연결만 한다.
 *  2. **교직원 계정은 학생으로 바꾸지 않는다.** 이 조직에서 이미 교직원
 *     멤버십을 가진 계정은 거부한다 — 역할이 조용히 강등되면 그 사람이 보던
 *     화면이 통째로 사라진다.
 *  3. **계정을 지우지 않는다.** 연결 해제는 `user_id`만 끊고 인증 계정은
 *     남긴다. 되돌릴 수 없는 삭제를 이 경로에서 하지 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface LinkResult {
  ok: boolean;
  message: string;
  /** 계정을 **새로 만든 경우에만** 채워진다. 한 번 보여 주고 저장하지 않는다. */
  temporaryPassword?: string;
}

/**
 * 초기 비밀번호 — 사람이 받아 적어 전달할 수 있어야 하므로 혼동되는 글자
 * (0/O, 1/l/I)를 뺀다. 어차피 첫 로그인 후 바꾸는 것이 전제다.
 */
function generateInitialPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  // 숫자·기호를 최소 하나씩 보장 (Supabase 기본 정책 및 흔한 사내 정책 대비)
  return `${out}7!`;
}

export async function linkLearnerAccount(input: {
  organizationId: string;
  learnerId: string;
  email: string;
  actorUserId: string;
}): Promise<LinkResult> {
  const sql = getSharedSql();
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "이메일 형식이 올바르지 않습니다." };
  }

  const [learner] = await sql<
    { id: string; display_name: string; user_id: string | null; status: string }[]
  >`
    select id::text, display_name, user_id::text as user_id, status::text
    from learners
    where id = ${input.learnerId} and organization_id = ${input.organizationId}
  `;
  if (!learner) return { ok: false, message: "학습자를 찾을 수 없습니다." };
  if (learner.status === "archived") {
    return { ok: false, message: "보관된 학습자에게는 계정을 연결하지 않습니다." };
  }
  if (learner.user_id) {
    return {
      ok: false,
      message: "이미 계정이 연결되어 있습니다. 먼저 연결을 해제하세요.",
    };
  }

  /* 인증 계정 조회는 public.users로 한다 — auth.users는 트리거로 여기에
   * 복제되고, admin.listUsers는 페이지네이션이라 큰 조직에서 놓친다. */
  const [existing] = await sql<{ id: string }[]>`
    select id::text from users where lower(email) = ${email}
  `;

  let userId = existing?.id ?? null;
  let temporaryPassword: string | undefined;

  if (userId) {
    // 다른 학습자가 이미 이 계정을 쓰고 있으면 뺏지 않는다
    const [taken] = await sql<{ display_name: string }[]>`
      select display_name from learners
      where organization_id = ${input.organizationId} and user_id = ${userId}
    `;
    if (taken) {
      return {
        ok: false,
        message: `이 계정은 이미 ${taken.display_name} 학습자에 연결되어 있습니다.`,
      };
    }
    const [membership] = await sql<{ role: string }[]>`
      select role::text from memberships
      where organization_id = ${input.organizationId} and user_id = ${userId}
    `;
    if (membership && membership.role !== "student") {
      return {
        ok: false,
        message: `이 계정은 이 워크스페이스에서 ${membership.role} 역할입니다. 교직원 계정은 학생으로 연결하지 않습니다.`,
      };
    }
  } else {
    temporaryPassword = generateInitialPassword();
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { display_name: learner.display_name },
    });
    if (error || !data?.user) {
      /* 경합: 방금 사이에 같은 이메일이 만들어졌을 수 있다. 한 번만 다시 본다. */
      if (error && /already|exists|registered/i.test(error.message)) {
        const [again] = await sql<{ id: string }[]>`
          select id::text from users where lower(email) = ${email}
        `;
        if (!again) {
          return {
            ok: false,
            message: "이미 존재하는 계정이지만 이 시스템에서 찾을 수 없습니다. 운영자에게 문의하세요.",
          };
        }
        userId = again.id;
        temporaryPassword = undefined;
      } else {
        return {
          ok: false,
          message: `계정을 만들지 못했습니다: ${error?.message ?? "알 수 없는 오류"}`,
        };
      }
    } else {
      userId = data.user.id;
    }
  }

  const linkedUserId = userId!;
  await sql.begin(async (tx) => {
    await tx`
      insert into users (id, email, display_name, default_organization_id)
      values (${linkedUserId}, ${email}, ${learner.display_name}, ${input.organizationId})
      on conflict (id) do update
        set default_organization_id = coalesce(users.default_organization_id, excluded.default_organization_id)
    `;
    await tx`
      insert into memberships (id, organization_id, user_id, role, status, joined_at)
      values (${uuidv7()}, ${input.organizationId}, ${linkedUserId}, 'student', 'active', now())
      on conflict (organization_id, user_id) do update set status = 'active'
    `;
    /* user_id가 아직 비어 있을 때만 채운다 — 두 요청이 겹쳐도 먼저 온 쪽이 이긴다 */
    const updated = await tx`
      update learners set user_id = ${linkedUserId}, updated_at = now()
      where id = ${learner.id} and organization_id = ${input.organizationId}
        and user_id is null
    `;
    if (updated.count === 0) {
      throw new Error("CONCURRENT_LINK");
    }
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, after
      ) values (
        ${uuidv7()}, ${input.organizationId}, 'user', ${input.actorUserId},
        'learner.link-account', 'learner', ${learner.id},
        ${temporaryPassword ? "계정 신규 발급" : "기존 계정 연결"},
        ${tx.json({ email, created: Boolean(temporaryPassword) } as never)}
      )
    `;
  });

  return {
    ok: true,
    message: temporaryPassword
      ? `${learner.display_name} 학습자의 계정을 만들었습니다. 초기 비밀번호는 지금 한 번만 표시됩니다.`
      : `${learner.display_name} 학습자를 기존 계정 ${email}에 연결했습니다.`,
    ...(temporaryPassword ? { temporaryPassword } : {}),
  };
}

export async function unlinkLearnerAccount(input: {
  organizationId: string;
  learnerId: string;
  actorUserId: string;
}): Promise<{ ok: boolean; message: string }> {
  const sql = getSharedSql();
  const [learner] = await sql<
    { display_name: string; user_id: string | null }[]
  >`
    select display_name, user_id::text as user_id from learners
    where id = ${input.learnerId} and organization_id = ${input.organizationId}
  `;
  if (!learner) return { ok: false, message: "학습자를 찾을 수 없습니다." };
  if (!learner.user_id) {
    return { ok: false, message: "연결된 계정이 없습니다." };
  }

  await sql.begin(async (tx) => {
    await tx`
      update learners set user_id = null, updated_at = now()
      where id = ${input.learnerId} and organization_id = ${input.organizationId}
    `;
    /* 멤버십은 'left'로만 둔다 — 지우면 이 사람이 언제 이 학원에 속했는지가
     * 사라진다. 인증 계정 자체는 건드리지 않는다. */
    await tx`
      update memberships set status = 'left', updated_at = now()
      where organization_id = ${input.organizationId} and user_id = ${learner.user_id}
        and role = 'student'
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, reason
      ) values (
        ${uuidv7()}, ${input.organizationId}, 'user', ${input.actorUserId},
        'learner.unlink-account', 'learner', ${input.learnerId},
        '계정 연결 해제 (인증 계정은 삭제하지 않음)'
      )
    `;
  });

  return {
    ok: true,
    message: `${learner.display_name} 학습자의 계정 연결을 해제했습니다. 로그인 계정 자체는 삭제되지 않았습니다.`,
  };
}
