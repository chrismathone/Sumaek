import "server-only";
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CapabilityScope } from "@su-maek/core/authz";

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

/* ─────────────────────────────────────────────────────────────
 * 일괄 발급과 담당 범위 (T5.2 · G-07).
 *
 * 반 하나에 서른 명이면 계정도 서른 개다. 한 명씩 폼을 여는 동안 교사는
 * 반드시 몇 명을 빠뜨리고, 빠뜨린 학생은 **개학일 아침에** 드러난다.
 *
 * 범위 집행이 여기 있는 이유: 권한 확인과 대상 확인을 화면이 두 걸음으로
 * 하면 한쪽을 빠뜨린다. 실제로 학생 흐름에 그런 결손이 있었다(남의 응시에
 * 답을 쓸 수 있었다). 그래서 이 함수가 **둘을 함께** 본다.
 * ───────────────────────────────────────────────────────────── */

export interface ManageableLearner {
  learnerId: string;
  displayName: string;
  learningGroupName: string | null;
  email: string | null;
  hasAccount: boolean;
}

/**
 * 이 사용자가 계정을 다룰 수 있는 학생.
 *
 * `assigned`(담당 교사)면 자기가 맡은 반의 학생만 나온다. 목록과 집행이
 * 같은 조건을 쓰므로, 화면에 보이지 않는 학생은 액션으로도 건드릴 수 없다.
 */
export async function listManageableLearners(input: {
  organizationId: string;
  actorUserId: string;
  scope: CapabilityScope;
}): Promise<ManageableLearner[]> {
  if (input.scope === "none") return [];
  const sql = getSharedSql();
  const assignedOnly = input.scope === "assigned";

  const rows = await sql<
    {
      learner_id: string;
      display_name: string;
      group_name: string | null;
      email: string | null;
      has_account: boolean;
    }[]
  >`
    select l.id::text as learner_id, l.display_name,
           max(g.name) as group_name,
           max(u.email) as email,
           (l.user_id is not null) as has_account
    from learners l
    left join learning_group_memberships m
      on m.learner_id = l.id and m.status = 'active'
    left join learning_groups g on g.id = m.learning_group_id
    left join users u on u.id = l.user_id
    where l.organization_id = ${input.organizationId}
      and l.status = 'active'
      and (
        ${!assignedOnly}
        or exists (
          select 1
          from learning_group_memberships m2
          join learning_groups g2 on g2.id = m2.learning_group_id
          where m2.learner_id = l.id and m2.status = 'active'
            and g2.home_teacher_user_id = ${input.actorUserId}
        )
      )
    group by l.id, l.display_name, l.user_id
    order by l.display_name, l.id
  `;

  return rows.map((r) => ({
    learnerId: r.learner_id,
    displayName: r.display_name,
    learningGroupName: r.group_name,
    email: r.email,
    hasAccount: r.has_account,
  }));
}

export interface IssueOutcome {
  learnerId: string;
  displayName: string;
  ok: boolean;
  message: string;
  /** 새로 만든 경우에만. **한 번 보여 주고 저장하지 않는다.** */
  temporaryPassword?: string;
}

export interface BulkIssueResult {
  outcomes: IssueOutcome[];
  succeeded: number;
  failed: number;
}

/**
 * 여러 학생에게 계정을 한 번에 발급한다.
 *
 * **한 명이 실패해도 나머지는 진행한다.** 전부 되돌리면 스물아홉 명이
 * 이미 받은 비밀번호가 무효가 되고, 그 비밀번호는 다시 볼 수 없으므로
 * 교사는 처음부터 다시 나눠 줘야 한다. 그래서 학생별로 결과를 낸다 —
 * 「일부 실패」를 통째 실패로 뭉개지 않는다.
 */
export async function issueLearnerAccounts(input: {
  organizationId: string;
  actorUserId: string;
  scope: CapabilityScope;
  /** learnerId → 이메일 */
  targets: ReadonlyArray<{ learnerId: string; email: string }>;
}): Promise<BulkIssueResult> {
  const allowed = new Map(
    (
      await listManageableLearners({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        scope: input.scope,
      })
    ).map((l) => [l.learnerId, l]),
  );

  const outcomes: IssueOutcome[] = [];
  for (const t of input.targets) {
    const learner = allowed.get(t.learnerId);
    if (!learner) {
      /* 담당 밖·타조직·보관된 학생. 셋을 한 문구로 뭉갠다 — 어느 쪽인지
       * 알려 주면 담당이 아닌 반의 학생 존재 여부가 새어 나간다. */
      outcomes.push({
        learnerId: t.learnerId,
        displayName: t.learnerId,
        ok: false,
        message: "담당 학생이 아닙니다.",
      });
      continue;
    }

    const result = await linkLearnerAccount({
      organizationId: input.organizationId,
      learnerId: t.learnerId,
      email: t.email,
      actorUserId: input.actorUserId,
    });
    outcomes.push({
      learnerId: t.learnerId,
      displayName: learner.displayName,
      ok: result.ok,
      message: result.message,
      ...(result.temporaryPassword
        ? { temporaryPassword: result.temporaryPassword }
        : {}),
    });
  }

  return {
    outcomes,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
  };
}
