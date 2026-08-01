import { v7 as uuidv7 } from "uuid";
import {
  MAX_GRANT_HOURS,
  checkGrantReason,
  checkGrantWindow,
  grantState,
  isGrantActive,
} from "@su-maek/core/authz";
import { getSharedSql } from "../client";
import type { Sql, TransactionSql } from "postgres";

/* ─────────────────────────────────────────────────────────────
 * break-glass 운영자 접근 — 발급·회수·세션 해석 (27장 · 인수 28).
 *
 * 세 가지가 한 곳에 모여 있는 이유: 승인 하나가 바뀔 때 감사와 소유자 고지가
 * 같은 트랜잭션에서 함께 움직여야 하기 때문이다. 승인은 남았는데 감사가 없거나,
 * 접근은 열렸는데 소유자가 모르는 상태를 만들 수 있으면 통제가 아니다.
 *
 * 판정(열림/닫힘)은 여기서 하지 않는다 — core의 grantState 하나가 한다.
 * 질의는 후보만 좁히고, 만료 검사를 SQL에 복제하지 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface OperatorGrantRow {
  id: string;
  organizationId: string;
  organizationName: string;
  operatorUserId: string;
  reason: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  disclosedToOwner: Date | null;
  createdAt: Date;
}

export interface OperatorSession {
  grant: OperatorGrantRow;
  /** DB 시계 기준 판정 시각 — 호출자가 남은 시간을 표시할 때 쓴다 */
  now: Date;
}

export interface OperatorAccessResult {
  ok: boolean;
  message: string;
  grantId: string | null;
}

/** now()는 항상 **DB 시계**에서 읽는다 — 앱 서버 여러 대의 시계가 어긋나도
 *  승인 창의 시작·끝은 하나여야 한다. */
async function dbNow(sql: Sql | TransactionSql): Promise<Date> {
  const [row] = await sql<{ now: Date }[]>`select now() as now`;
  return row!.now;
}

/**
 * 운영자 세션 해석 — 이 사용자에게 지금 열려 있는 승인이 있는가.
 *
 * 질의는 이 사용자의 최근 승인 몇 건을 만료 시각 역순으로 가져올 뿐이고,
 * **열림/닫힘 판정은 SQL에 한 줄도 넣지 않는다** — where 절에 넣는 순간
 * 판정 규칙이 core와 SQL 두 곳에 생기고, 한쪽만 고치면 느슨한 쪽이 이겨
 * 만료된 승인으로 문이 열린다. 후보를 5건으로 자르는 것은 성능이지 정책이
 * 아니다(한 운영자가 같은 시점에 여러 조직 승인을 들고 있을 수 있다).
 */
export async function findActiveOperatorSession(
  userId: string,
  sqlOverride?: Sql,
): Promise<OperatorSession | null> {
  const sql = sqlOverride ?? getSharedSql();
  const now = await dbNow(sql);
  const rows = await sql<
    {
      id: string;
      organization_id: string;
      organization_name: string;
      operator_user_id: string;
      reason: string;
      approved_by: string | null;
      approved_at: Date | null;
      expires_at: Date;
      revoked_at: Date | null;
      disclosed_to_owner: Date | null;
      created_at: Date;
    }[]
  >`
    select g.id, g.organization_id, o.name as organization_name,
           g.operator_user_id, g.reason, g.approved_by, g.approved_at,
           g.expires_at, g.revoked_at, g.disclosed_to_owner, g.created_at
    from operator_access_grants g
    join organizations o on o.id = g.organization_id and o.status = 'active'
    where g.operator_user_id = ${userId}
    order by g.expires_at desc
    limit 5
  `;
  for (const row of rows) {
    const grant = toGrant(row);
    if (isGrantActive(grant, now)) return { grant, now };
  }
  return null;
}

/**
 * 승인 발급. 사유·승인자·만료가 모두 있어야 한다.
 *
 * 소유자 고지가 같은 트랜잭션에 들어 있는 이유: 접근이 열렸는데 알림이
 * 실패해 소유자가 모르는 창을 만들지 않기 위해서다. 고지에 성공한 순간을
 * disclosed_to_owner에 남겨 "고지했다고 주장"이 아니라 기록이 되게 한다.
 */
export async function issueOperatorAccess(options: {
  organizationId: string;
  operatorUserId: string;
  reason: string;
  /** 승인자 — 이 워크스페이스에서 settings 쓰기 권한을 가진 사람 */
  approvedByUserId: string;
  /** 필요 시간(분). 만료는 **DB 시계** 기준으로 계산한다 — 앱 서버 시계로
   *  만들면 미세한 차이 때문에 상한(4시간)에 딱 맞춘 승인이 거절된다 */
  durationMinutes: number;
  sqlOverride?: Sql;
}): Promise<OperatorAccessResult> {
  const sql = options.sqlOverride ?? getSharedSql();

  const reasonCheck = checkGrantReason(options.reason);
  if (!reasonCheck.ok) return fail(reasonCheck.message);

  const now = await dbNow(sql);
  const expiresAt = Number.isFinite(options.durationMinutes)
    ? new Date(now.getTime() + options.durationMinutes * 60_000)
    : null;
  const windowCheck = checkGrantWindow({ now, expiresAt });
  if (expiresAt === null || !windowCheck.ok) return fail(windowCheck.message);

  if (options.operatorUserId === options.approvedByUserId) {
    // 자기 승인 금지 — 승인자 기록이 형식만 남는 것을 막는다
    return fail("자기 자신에게 운영자 접근을 승인할 수 없습니다.");
  }

  const [operator] = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from users where id = ${options.operatorUserId}
  `;
  if (!operator) return fail("대상 운영자 계정을 찾을 수 없습니다.");

  const [member] = await sql<{ id: string }[]>`
    select id from memberships
    where organization_id = ${options.organizationId}
      and user_id = ${options.operatorUserId} and status = 'active'
  `;
  if (member) {
    /* 이미 이 워크스페이스의 구성원이면 break-glass가 아니라 역할 문제다.
     * 승인으로 덮으면 세션 해석에서 멤버십이 이겨 승인이 죽은 기록이 된다. */
    return fail("이미 이 워크스페이스의 구성원입니다. 역할로 처리하세요.");
  }

  const reason = options.reason.trim();
  const grantId = uuidv7();

  await sql.begin(async (tx) => {
    await tx`
      insert into operator_access_grants (
        id, organization_id, operator_user_id, reason,
        approved_by, approved_at, expires_at
      ) values (
        ${grantId}, ${options.organizationId}, ${options.operatorUserId},
        ${reason}, ${options.approvedByUserId}, now(), ${expiresAt}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action,
        target_type, target_id, reason, after, access_grant_id
      ) values (
        ${uuidv7()}, ${options.organizationId}, 'user', ${options.approvedByUserId},
        'ops.break_glass_start', 'operator_access_grant', ${grantId}, ${reason},
        ${tx.json({
          operator_user_id: options.operatorUserId,
          operator_name: operator.display_name,
          expires_at: expiresAt.toISOString(),
          max_hours: MAX_GRANT_HOURS,
        } as never)},
        ${grantId}
      )
    `;
    const notified = await notifyOwners(tx, {
      organizationId: options.organizationId,
      grantId,
      title: "운영자 접근이 시작되었습니다",
      body: {
        what: `${operator.display_name} 운영자가 이 워크스페이스에 접근할 수 있습니다.`,
        why: reason,
        impact: "이 기간의 모든 조회·변경이 감사 로그에 남습니다. 쓰기는 허용되지 않습니다.",
        action: "필요 없으면 설정 > 운영자 접근에서 즉시 회수하세요.",
        deadline: expiresAt.toISOString(),
      },
      groupKey: `break-glass:${grantId}:start`,
    });
    if (notified > 0) {
      await tx`
        update operator_access_grants
        set disclosed_to_owner = now(), updated_at = now()
        where id = ${grantId}
      `;
    }
  });

  return {
    ok: true,
    message: `${operator.display_name} 운영자의 접근을 승인했습니다. 만료 후 자동으로 닫힙니다.`,
    grantId,
  };
}

/**
 * 회수. 만료를 기다리지 않고 사람이 끊는 경로다.
 * 이미 닫힌(만료·회수) 승인에 대해서는 아무것도 바꾸지 않는다 — 감사에
 * "회수했다"는 사실이 두 번 남으면 무엇이 실제로 문을 닫았는지 흐려진다.
 */
export async function revokeOperatorAccess(options: {
  organizationId: string;
  grantId: string;
  actorUserId: string;
  sqlOverride?: Sql;
}): Promise<OperatorAccessResult> {
  const sql = options.sqlOverride ?? getSharedSql();
  const now = await dbNow(sql);

  const [row] = await sql<
    {
      id: string;
      organization_id: string;
      organization_name: string;
      operator_user_id: string;
      operator_name: string | null;
      reason: string;
      approved_by: string | null;
      approved_at: Date | null;
      expires_at: Date;
      revoked_at: Date | null;
      disclosed_to_owner: Date | null;
      created_at: Date;
    }[]
  >`
    select g.id, g.organization_id, o.name as organization_name,
           g.operator_user_id, u.display_name as operator_name, g.reason,
           g.approved_by, g.approved_at, g.expires_at, g.revoked_at,
           g.disclosed_to_owner, g.created_at
    from operator_access_grants g
    join organizations o on o.id = g.organization_id
    left join users u on u.id = g.operator_user_id
    where g.id = ${options.grantId} and g.organization_id = ${options.organizationId}
  `;
  if (!row) return fail("승인을 찾을 수 없습니다.");

  const grant = toGrant(row);
  const state = grantState(grant, now);
  if (state === "revoked") return fail("이미 회수된 승인입니다.");
  if (state === "expired") return fail("이미 만료된 승인입니다. 회수할 것이 없습니다.");

  /* 승인이 만든 활동 요약 — 종료 고지에 함께 넣는다 (threat-model 10절). */
  const [activity] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from audit_events
    where access_grant_id = ${options.grantId}
      and action <> 'ops.break_glass_start'
  `;

  await sql.begin(async (tx) => {
    await tx`
      update operator_access_grants
      set revoked_at = now(), updated_at = now()
      where id = ${options.grantId} and revoked_at is null
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action,
        target_type, target_id, reason, before, after, access_grant_id
      ) values (
        ${uuidv7()}, ${options.organizationId}, 'user', ${options.actorUserId},
        'ops.break_glass_end', 'operator_access_grant', ${options.grantId},
        ${row.reason},
        ${tx.json({ state } as never)},
        ${tx.json({
          state: "revoked",
          recorded_actions: activity?.cnt ?? 0,
        } as never)},
        ${options.grantId}
      )
    `;
    await notifyOwners(tx, {
      organizationId: options.organizationId,
      grantId: options.grantId,
      title: "운영자 접근이 종료되었습니다",
      body: {
        what: `${row.operator_name ?? "운영자"}의 접근을 회수했습니다.`,
        why: row.reason,
        impact: `접근 기간에 기록된 활동 ${activity?.cnt ?? 0}건이 감사 로그에 남아 있습니다.`,
        action: "감사 로그에서 해당 기간의 활동을 확인할 수 있습니다.",
      },
      groupKey: `break-glass:${options.grantId}:end`,
    });
  });

  return { ok: true, message: "운영자 접근을 회수했습니다.", grantId: options.grantId };
}

/**
 * 소유자 고지. 알림함(22장)은 외부 알림 제공자와 무관하게 항상 동작하므로
 * "누가·왜·언제까지"를 여기 남기면 소유자가 반드시 볼 수 있다.
 * 같은 group_key가 이미 있으면 다시 만들지 않는다 (재시도 중복 방지).
 */
async function notifyOwners(
  tx: TransactionSql,
  options: {
    organizationId: string;
    grantId: string;
    title: string;
    body: Record<string, string>;
    groupKey: string;
  },
): Promise<number> {
  const existing = await tx<{ id: string }[]>`
    select id from notifications
    where organization_id = ${options.organizationId}
      and group_key = ${options.groupKey}
    limit 1
  `;
  if (existing.length > 0) return 0;

  const owners = await tx<{ user_id: string }[]>`
    select user_id from memberships
    where organization_id = ${options.organizationId}
      and status = 'active' and role = 'owner'
  `;
  for (const owner of owners) {
    await tx`
      insert into notifications (
        id, organization_id, recipient_user_id, kind, title, body,
        link_path, related_type, related_id, group_key
      ) values (
        ${uuidv7()}, ${options.organizationId}, ${owner.user_id},
        'system_notice', ${options.title},
        ${tx.json(options.body as never)},
        '/app/settings/operator-access', 'operator_access_grant',
        ${options.grantId}, ${options.groupKey}
      )
    `;
  }
  return owners.length;
}

function toGrant(row: {
  id: string;
  organization_id: string;
  organization_name: string;
  operator_user_id: string;
  reason: string;
  approved_by: string | null;
  approved_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
  disclosed_to_owner: Date | null;
  created_at: Date;
}): OperatorGrantRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    operatorUserId: row.operator_user_id,
    reason: row.reason,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    disclosedToOwner: row.disclosed_to_owner,
    createdAt: row.created_at,
  };
}

function fail(message: string): OperatorAccessResult {
  return { ok: false, message, grantId: null };
}
