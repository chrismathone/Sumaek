import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../src/client";
import {
  findActiveOperatorSession,
  issueOperatorAccess,
  revokeOperatorAccess,
} from "../src/domain/operator-access";

/* ─────────────────────────────────────────────────────────────
 * break-glass 집행 (인수 28) — 라이브 DB 통합 테스트.
 *
 * 붙잡으려는 것은 "컬럼이 있다"가 아니라 **판정이 실제로 접근을 여닫는가**다:
 *   유효 → 세션이 열린다 / 만료 → 아무것도 하지 않아도 닫힌다 / 회수 → 닫힌다.
 * 만료는 배경 작업이 아니라 요청마다 다시 판정되므로, 시각만 지나면 닫혀야 한다.
 *
 * 고정 ID 픽스처로 멱등 — 조직·사용자는 재사용하고(감사 이벤트가 append-only라
 * 조직을 지울 수 없다) 승인 행만 실행마다 정리한다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
/* 연결은 beforeAll에서 만든다 — 모듈 최상단에서 createSql()을 부르면
 * DATABASE_URL이 없을 때 skipIf 판정 전에 던져 수집 단계가 통째로 깨진다. */
let sql: ReturnType<typeof createSql>;

const ORG = "ffffffff-0000-7000-8000-000000280001";
const OWNER = "ffffffff-0000-7000-8000-000000280002";
const OPERATOR = "ffffffff-0000-7000-8000-000000280003";
/** 이미 구성원인 계정 — 승인이 역할을 덮지 못하는지 확인용 */
const MEMBER = "ffffffff-0000-7000-8000-000000280004";
const TZ = "Asia/Seoul";

async function cleanupGrants(): Promise<void> {
  // 감사·알림은 지우지 않는다 (append-only 원칙). 승인 행만 실행마다 정리한다.
  await sql`delete from operator_access_grants where organization_id = ${ORG}`;
}

describe.skipIf(!hasDb)("break-glass 접근 집행 (인수 28)", () => {
  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST break-glass', 'itest-break-glass', ${TZ})
      on conflict (id) do nothing
    `;
    await sql`
      insert into users (id, email, display_name)
      values
        (${OWNER}, 'itest-bg-owner@example.test', 'ITEST 소유자'),
        (${OPERATOR}, 'itest-bg-operator@example.test', 'ITEST 운영자'),
        (${MEMBER}, 'itest-bg-member@example.test', 'ITEST 구성원')
      on conflict (id) do nothing
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values
        (${uuidv7()}, ${ORG}, ${OWNER}, 'owner', 'active'),
        (${uuidv7()}, ${ORG}, ${MEMBER}, 'teacher', 'active')
      on conflict (organization_id, user_id) do nothing
    `;
    await cleanupGrants();
  });

  afterAll(async () => {
    await cleanupGrants();
    await sql.end({ timeout: 5 });
  });

  it("승인이 없으면 운영자 세션이 열리지 않는다", async () => {
    await cleanupGrants();
    expect(await findActiveOperatorSession(OPERATOR, sql)).toBeNull();
  });

  it("유효한 승인이 있으면 세션이 열리고 사유·만료가 따라온다", async () => {
    await cleanupGrants();
    const issued = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: OPERATOR,
      reason: "일정 실체화 실패 원인 조사 (ITEST)",
      approvedByUserId: OWNER,
      durationMinutes: 60,
      sqlOverride: sql,
    });
    expect(issued.ok).toBe(true);

    const session = await findActiveOperatorSession(OPERATOR, sql);
    expect(session).not.toBeNull();
    expect(session!.grant.organizationId).toBe(ORG);
    expect(session!.grant.reason).toContain("일정 실체화");
    expect(session!.grant.approvedBy).toBe(OWNER);
    expect(session!.grant.expiresAt.getTime()).toBeGreaterThan(
      session!.now.getTime(),
    );
  });

  it("만료 시각이 지나면 아무 조치 없이 닫힌다", async () => {
    await cleanupGrants();
    const issued = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: OPERATOR,
      reason: "만료 검증 (ITEST)",
      approvedByUserId: OWNER,
      durationMinutes: 60,
      sqlOverride: sql,
    });
    expect(issued.ok).toBe(true);
    expect(await findActiveOperatorSession(OPERATOR, sql)).not.toBeNull();

    /* 시간이 흐른 상황을 만든다 — 회수도, 배경 작업도 없이 시각만 바꾼다.
     * created_at도 함께 당겨야 4시간 상한 CHECK를 깨지 않는다. */
    await sql`
      update operator_access_grants
      set created_at = now() - interval '3 hours',
          expires_at = now() - interval '1 second'
      where id = ${issued.grantId}
    `;

    expect(await findActiveOperatorSession(OPERATOR, sql)).toBeNull();
  });

  it("회수하면 만료 전이라도 즉시 닫힌다", async () => {
    await cleanupGrants();
    const issued = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: OPERATOR,
      reason: "회수 검증 (ITEST)",
      approvedByUserId: OWNER,
      durationMinutes: 240,
      sqlOverride: sql,
    });
    expect(await findActiveOperatorSession(OPERATOR, sql)).not.toBeNull();

    const revoked = await revokeOperatorAccess({
      organizationId: ORG,
      grantId: issued.grantId!,
      actorUserId: OWNER,
      sqlOverride: sql,
    });
    expect(revoked.ok).toBe(true);
    expect(await findActiveOperatorSession(OPERATOR, sql)).toBeNull();

    // 두 번 회수해도 사실이 두 번 기록되지 않는다
    const again = await revokeOperatorAccess({
      organizationId: ORG,
      grantId: issued.grantId!,
      actorUserId: OWNER,
      sqlOverride: sql,
    });
    expect(again.ok).toBe(false);
    expect(again.message).toContain("이미 회수");
  });

  it("발급·회수가 감사와 소유자 고지를 함께 남긴다", async () => {
    await cleanupGrants();
    const issued = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: OPERATOR,
      reason: "감사·고지 검증 (ITEST)",
      approvedByUserId: OWNER,
      durationMinutes: 30,
      sqlOverride: sql,
    });
    expect(issued.ok).toBe(true);

    const [grant] = await sql<{ disclosed_to_owner: Date | null }[]>`
      select disclosed_to_owner from operator_access_grants where id = ${issued.grantId}
    `;
    expect(grant!.disclosed_to_owner).not.toBeNull();

    const startAudit = await sql<{ action: string; reason: string | null }[]>`
      select action, reason from audit_events
      where access_grant_id = ${issued.grantId} and action = 'ops.break_glass_start'
    `;
    expect(startAudit).toHaveLength(1);
    expect(startAudit[0]!.reason).toContain("감사·고지 검증");

    const startNotice = await sql<{ recipient_user_id: string; link_path: string }[]>`
      select recipient_user_id, link_path from notifications
      where organization_id = ${ORG}
        and group_key = ${`break-glass:${issued.grantId}:start`}
    `;
    expect(startNotice).toHaveLength(1);
    expect(startNotice[0]!.recipient_user_id).toBe(OWNER);
    expect(startNotice[0]!.link_path).toBe("/app/settings/operator-access");

    await revokeOperatorAccess({
      organizationId: ORG,
      grantId: issued.grantId!,
      actorUserId: OWNER,
      sqlOverride: sql,
    });
    const endAudit = await sql<{ action: string }[]>`
      select action from audit_events
      where access_grant_id = ${issued.grantId} and action = 'ops.break_glass_end'
    `;
    expect(endAudit).toHaveLength(1);
    const endNotice = await sql<{ id: string }[]>`
      select id from notifications
      where organization_id = ${ORG}
        and group_key = ${`break-glass:${issued.grantId}:end`}
    `;
    expect(endNotice).toHaveLength(1);
  });

  it("사유 없이·무기한으로·상한을 넘겨 승인할 수 없다", async () => {
    await cleanupGrants();
    const blank = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: OPERATOR,
      reason: "   ",
      approvedByUserId: OWNER,
      durationMinutes: 60,
      sqlOverride: sql,
    });
    expect(blank.ok).toBe(false);

    const tooLong = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: OPERATOR,
      reason: "상한 초과 검증 (ITEST)",
      approvedByUserId: OWNER,
      durationMinutes: 5 * 60,
      sqlOverride: sql,
    });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.message).toContain("4시간");

    const nonPositive = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: OPERATOR,
      reason: "과거 만료 검증 (ITEST)",
      approvedByUserId: OWNER,
      durationMinutes: 0,
      sqlOverride: sql,
    });
    expect(nonPositive.ok).toBe(false);

    const rows = await sql<{ id: string }[]>`
      select id from operator_access_grants where organization_id = ${ORG}
    `;
    expect(rows).toHaveLength(0);
  });

  it("자기 자신에게 승인할 수 없고, 이미 구성원인 계정에도 승인하지 않는다", async () => {
    await cleanupGrants();
    const self = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: OWNER,
      reason: "자기 승인 검증 (ITEST)",
      approvedByUserId: OWNER,
      durationMinutes: 60,
      sqlOverride: sql,
    });
    expect(self.ok).toBe(false);

    const member = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: MEMBER,
      reason: "구성원 승인 검증 (ITEST)",
      approvedByUserId: OWNER,
      durationMinutes: 60,
      sqlOverride: sql,
    });
    expect(member.ok).toBe(false);
    expect(member.message).toContain("구성원");
  });

  it("DB CHECK가 애플리케이션을 우회한 승인도 막는다", async () => {
    await cleanupGrants();
    // 무기한(=상한 초과) 직접 삽입
    await expect(
      sql`
        insert into operator_access_grants (
          id, organization_id, operator_user_id, reason, approved_by, approved_at, expires_at
        ) values (
          ${uuidv7()}, ${ORG}, ${OPERATOR}, '우회 시도', ${OWNER}, now(),
          now() + interval '30 days'
        )
      `,
    ).rejects.toThrow();

    // 사유가 빈 문자열
    await expect(
      sql`
        insert into operator_access_grants (
          id, organization_id, operator_user_id, reason, approved_by, approved_at, expires_at
        ) values (
          ${uuidv7()}, ${ORG}, ${OPERATOR}, '   ', ${OWNER}, now(),
          now() + interval '1 hour'
        )
      `,
    ).rejects.toThrow();

    // 승인자 없이 승인 시각만
    await expect(
      sql`
        insert into operator_access_grants (
          id, organization_id, operator_user_id, reason, approved_by, approved_at, expires_at
        ) values (
          ${uuidv7()}, ${ORG}, ${OPERATOR}, '승인자 없는 승인', null, now(),
          now() + interval '1 hour'
        )
      `,
    ).rejects.toThrow();
  });

  it("승인자가 없는 요청 행은 접근을 열지 않는다", async () => {
    await cleanupGrants();
    /* 발급 경로는 항상 승인자를 함께 적지만, 운영 스크립트가 "요청"만 심는
     * 경우를 대비한 기본값이다 — 승인 없이 만들어진 행은 열리지 않아야 한다. */
    await sql`
      insert into operator_access_grants (
        id, organization_id, operator_user_id, reason, expires_at
      ) values (
        ${uuidv7()}, ${ORG}, ${OPERATOR}, '승인 대기 요청 (ITEST)',
        now() + interval '1 hour'
      )
    `;
    expect(await findActiveOperatorSession(OPERATOR, sql)).toBeNull();
  });

  it("운영자는 멤버십 역할로 존재할 수 없다 — member_role enum에 없다", async () => {
    const roles = await sql<{ v: string }[]>`
      select unnest(enum_range(null::member_role))::text as v
    `;
    expect(roles.map((r) => r.v)).not.toContain("operator");
  });
});
