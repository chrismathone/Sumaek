import type { Sql } from "postgres";

/* ─────────────────────────────────────────────────────────────
 * 조직 통째로 회수하기 — 자율 E2E가 만든 빈 학원 (T6.2).
 *
 * `purgeTestData`는 **데모 워크스페이스 안의** 테스트 잔재를 이름 규칙으로
 * 골라 지운다. 여기서 하는 일은 다르다: 자율 E2E는 실행마다 **조직 자체를**
 * 새로 만들기 때문에(빈 학원이어야 하므로 재사용할 수 없다) 지울 단위가
 * 행이 아니라 조직이다.
 *
 * 지울 수 없는 것이 남으면 조직도 남는다 — 학생이 하루를 마친 실행은
 * 진도·감사 기록을 남기고 그 삭제는 트리거가 막는다(불변 조건 15). 그래서
 * 이 함수는 「전부 지웠다」고 말하지 않고 **무엇이 남았는지** 돌려준다.
 * 남는 것을 숨기면 다음 사람이 조직 목록이 왜 늘어나는지 모른다.
 * ───────────────────────────────────────────────────────────── */

/** 자율 E2E가 만든 조직의 slug 접두사 — 픽스처와 **같은 규칙** */
export const AUTONOMOUS_SLUG_PREFIX = "e2e-auto-";

/**
 * 지울 수 없는 표 — 여기 적힌 것은 **시도조차 하지 않는다.**
 *
 * 앞의 여섯은 트리거가 삭제를 막는다(불변 조건 15 · ADR-0015 · I-22).
 * 뒤의 둘은 조직 것이 아니다(교육과정은 공용, 계정은 전역이라 따로 지운다).
 * 시도해서 실패해도 결과는 같지만, 「지우려다 막혔다」와 「지우지 않기로
 * 했다」는 다른 말이고 로그를 읽는 사람에게 그 차이가 전부다.
 */
const UNDELETABLE = new Set([
  "audit_events",
  "mastery_evidences",
  "progress_events",
  "grade_decisions",
  "learner_day_plans",
  "learner_day_plan_items",
  /* 파생인데 **지우면 안 되는** 것. `mastery_evidences`가 지워지지 않으므로
   * 여기만 비우면 「증거는 있는데 숙련도 행이 없다」가 되어 I-11이 영구 위반
   * 상태가 된다 — 실측으로 자율 E2E 조직마다 6행씩 쌓여 107건 중 32건이
   * 이것이었다. 원본을 못 지우면 파생도 남긴다. */
  "concept_masteries",
  "organizations",
  "users",
]);

export interface PurgeOrganizationResult {
  /** 비운 표 */
  cleared: string[];
  /** 참조·불변으로 남은 표 — 조직 행이 남는 이유가 곧 이 목록이다 */
  blocked: string[];
}

/**
 * 한 조직의 지울 수 있는 행을 전부 지운다.
 *
 * 삭제 **순서를 적지 않는다.** 참조 순서를 손으로 적으면 표가 하나 늘 때마다
 * 그 목록을 고쳐야 하고, 안 고치면 조용히 남는다. 대신 조직 컬럼을 가진 표를
 * 전부 훑고, 외래 키에 막힌 것은 다음 바퀴로 미룬다 — 더 지울 것이 없을
 * 때까지. 지울 수 없는 표만 사람이 정한다(UNDELETABLE).
 *
 * 각 delete는 자기 statement로 돈다(한 트랜잭션으로 묶지 않는다). 묶으면
 * 참조 하나가 막힐 때 이미 지운 것까지 되돌아가 바퀴를 도는 뜻이 없어진다.
 */
export async function purgeOrganizationRows(
  sql: Sql,
  organizationId: string,
): Promise<PurgeOrganizationResult> {
  /* 플랫폼 조직은 지우지 않는다 (ADR-0020). 여기 사는 것은 한 학원의
   * 데이터가 아니라 **모든 학원이 함께 보는 콘텐츠**다 — 문항 7천 건과
   * 자료 전부가 한 번의 오타로 사라질 수 있는 자리라 코드로 막는다.
   * 정리 스크립트가 조직을 훑다가 실수로 여기에 닿는 일이 진짜 위험이다. */
  const [platform] = await sql<{ id: string | null }[]>`
    select platform_org_id()::text as id
  `;
  if (platform?.id && platform.id === organizationId) {
    throw new Error(
      "플랫폼 조직은 purge 대상이 아닙니다 — 모든 학원이 함께 보는 콘텐츠입니다 (ADR-0020).",
    );
  }
  const scoped = await sql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'organization_id'
    order by table_name
  `;
  let remaining = scoped
    .map((r) => r.table_name)
    .filter((t) => !UNDELETABLE.has(t));
  const cleared: string[] = [];

  /* 바퀴를 도는 한 지운 것이 있으면 계속한다. 진전이 없으면 남은 것은
   * 순서 문제가 아니라 지울 수 없는 것이다. */
  for (;;) {
    const failed: string[] = [];
    for (const table of remaining) {
      try {
        await sql`delete from ${sql(table)} where organization_id = ${organizationId}`;
        cleared.push(table);
      } catch {
        failed.push(table);
      }
    }
    if (failed.length === remaining.length) break;
    remaining = failed;
    if (remaining.length === 0) break;
  }

  return { cleared, blocked: remaining };
}

/**
 * 이 조직에 매인 로그인 계정 — 소속**과** 기본 워크스페이스 양쪽으로 찾는다.
 *
 * 소속만 보면 정리가 두 번 도는 순간(중단된 실행을 나중에 쓸어내는 경우)
 * 아무것도 못 찾는다 — 첫 정리가 이미 소속을 지웠기 때문이다. 실측으로
 * 유령 계정 한 건이 그렇게 남았다.
 */
export async function accountsOfOrganization(
  sql: Sql,
  organizationId: string,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select u.id::text as id from users u
    where u.default_organization_id = ${organizationId}
    union
    select m.user_id::text as id from memberships m
    where m.organization_id = ${organizationId}
  `;
  return rows.map((r) => r.id);
}

/**
 * 로그인 계정을 지운다 — **auth와 public 양쪽**.
 *
 * `auth.users` 삭제는 `public.users`를 따라 지우지 않는다(복제 트리거는
 * insert에만 걸려 있다). auth만 지우면 로그인 못 하는 유령 행이 남아
 * 실행마다 쌓인다.
 *
 * public 쪽을 **먼저** 지운다. 반대 순서로 하면 auth 삭제가 성공한 뒤 public
 * 삭제가 참조로 막혔을 때 더 고약한 상태(로그인 불가 + 행 잔존)가 된다.
 * 참조가 남아 있으면 둘 다 그대로 두는 편이 낫다.
 *
 * Supabase 자격증명이 없으면 public 쪽만 지우고 넘어간다 — 정리 도구가
 * 환경 때문에 통째로 실패하지 않게 한다.
 */
export async function dropAccounts(
  sql: Sql,
  userIds: readonly string[],
): Promise<{ deleted: number; blocked: number }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let deleted = 0;
  let blocked = 0;

  for (const id of userIds) {
    try {
      await sql`delete from users where id = ${id}`;
    } catch {
      blocked += 1;
      continue;
    }
    if (!url || !key) {
      deleted += 1;
      continue;
    }
    try {
      const response = await fetch(`${url}/auth/v1/admin/users/${id}`, {
        method: "DELETE",
        headers: { apikey: key, authorization: `Bearer ${key}` },
      });
      if (!response.ok) blocked += 1;
      else deleted += 1;
    } catch {
      blocked += 1;
    }
  }
  return { deleted, blocked };
}

export interface PurgeWorkspaceResult {
  /** 흔적 없이 사라진 조직 — 증거를 남기지 않은 실행 */
  organizationsDeleted: number;
  /**
   * 비웠지만 남은 조직 — 불변 기록이 참조하고 있다. **보관 처리**한다.
   *
   * 지울 수 없다고 `active`로 두면 조직 목록이 실행마다 늘고, 운영자는
   * 어느 것이 진짜 학원인지 알 수 없다. 학습자에게 하는 것과 같은 처방이다
   * (purgeTestData의 「보관 처리」) — 지울 수 없으면 최소한 목록에서는 뺀다.
   */
  organizationsKept: number;
  /** 남은 조직들이 어느 표 때문에 남았는가 (중복 없이) */
  keptBecauseOf: string[];
  accountsDeleted: number;
  accountsBlocked: number;
  dryRun: boolean;
}

/**
 * 자율 E2E가 만든 조직을 전부 회수한다. 멱등이다.
 *
 * @param options.slugPrefix 대상 조직의 slug 접두사 (기본: 자율 E2E)
 */
export async function purgeAutonomousWorkspaces(
  sql: Sql,
  options: { dryRun?: boolean; slugPrefix?: string } = {},
): Promise<PurgeWorkspaceResult> {
  const dryRun = options.dryRun ?? false;
  const prefix = options.slugPrefix ?? AUTONOMOUS_SLUG_PREFIX;
  const orgs = await sql<{ id: string }[]>`
    select id::text as id from organizations where slug like ${`${prefix}%`}
  `;

  const result: PurgeWorkspaceResult = {
    organizationsDeleted: 0,
    organizationsKept: 0,
    keptBecauseOf: [],
    accountsDeleted: 0,
    accountsBlocked: 0,
    dryRun,
  };
  if (dryRun) {
    result.organizationsKept = orgs.length;
    return result;
  }

  const kept = new Set<string>();
  for (const org of orgs) {
    const accounts = await accountsOfOrganization(sql, org.id);
    const { blocked } = await purgeOrganizationRows(sql, org.id);
    const dropped = await dropAccounts(sql, accounts);
    result.accountsDeleted += dropped.deleted;
    result.accountsBlocked += dropped.blocked;
    for (const table of blocked) kept.add(table);
    try {
      await sql`delete from organizations where id = ${org.id}`;
      result.organizationsDeleted += 1;
    } catch {
      /* 불변 기록(대개 grade_decisions → attempts 사슬)이 참조한다. 남기되
       * 보관으로 내려 조직 목록에서 빠지게 한다 — 지울 수 없다고 active로
       * 두면 운영자가 어느 것이 진짜 학원인지 알 수 없게 된다. */
      await sql`
        update organizations set status = 'archived', updated_at = now()
        where id = ${org.id} and status <> 'archived'
      `;
      result.organizationsKept += 1;
    }
  }
  result.keptBecauseOf = [...kept].sort();
  return result;
}
