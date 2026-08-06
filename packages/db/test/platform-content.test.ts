import { beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 플랫폼 콘텐츠 검증 (ADR-0020 V-1 · V-2 · V-5) — 라이브 DB.
 *
 * 이 셋은 말로 보장할 수 없다:
 *   V-1 새로 만든 조직이 콘텐츠를 본다 (안 보이면 학생 화면이 빈다)
 *   V-2 마스터가 아니면 플랫폼 콘텐츠를 못 쓴다 (RLS가 실제로 막는가)
 *   V-5 조직 purge가 플랫폼 콘텐츠를 지우지 않는다
 *
 * V-2는 **롤을 낮춰야** 잰다. DATABASE_URL은 rolbypassrls=true인 postgres라
 * 그냥 재면 정책이 한 줄도 평가되지 않고 전부 통과한다(false-green).
 * ───────────────────────────────────────────────────────────── */

const { getSharedSql, contentOrganizationIds, PLATFORM_ORGANIZATION_ID } =
  await import("../src");
const { purgeOrganizationRows } = await import("../src/testing/purge-workspace");
const { purgeTestData } = await import("../src/testing/purge-test-data");

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof getSharedSql>;
const NEW_ORG = uuidv7();

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();
  await sql`
    insert into organizations (id, name, slug, kind, status, timezone)
    values (${NEW_ORG}, '플랫폼검증 학원', ${`itest-platform-${NEW_ORG.slice(0, 8)}`},
            'organization', 'active', 'Asia/Seoul')
    on conflict do nothing
  `;
});

describe.skipIf(!hasDb)("플랫폼 콘텐츠", () => {
  it("V-1 새 조직도 공용 문항·자료를 본다", async () => {
    /* 콘텐츠가 조직 소유였을 때는 이 수가 0이었다 — 새 학원은 개념만 알고
     * 보여 줄 것이 없었다. 그것이 이 ADR을 만든 이유다. */
    const [q] = await sql<{ n: number }[]>`
      select count(*)::int as n from questions
      where organization_id = any(${contentOrganizationIds(NEW_ORG)}::uuid[])
    `;
    const [m] = await sql<{ n: number }[]>`
      select count(*)::int as n from learning_materials
      where organization_id = any(${contentOrganizationIds(NEW_ORG)}::uuid[])
        and status = 'published'
    `;
    expect(q!.n).toBeGreaterThan(0);
    expect(m!.n).toBeGreaterThan(0);
  });

  it("V-1' 자기 조직 필터만으로는 콘텐츠가 안 보인다 — 도우미가 실제로 일한다", async () => {
    /* 도우미를 안 쓰면 어떻게 되는지 못 박는다. 이 기대가 깨지는 날은
     * 누군가 콘텐츠를 조직으로 되돌린 날이다. */
    const [q] = await sql<{ n: number }[]>`
      select count(*)::int as n from questions where organization_id = ${NEW_ORG}
    `;
    expect(q!.n).toBe(0);
  });

  it("V-2 마스터가 아니면 플랫폼 문항을 못 만든다", async () => {
    const [member] = await sql<{ id: string }[]>`
      select user_id::text as id from memberships
      where organization_id <> ${PLATFORM_ORGANIZATION_ID} and status = 'active'
      limit 1
    `;
    if (!member) return; // 계정이 없으면 잴 것이 없다

    let blocked = false;
    try {
      await sql.begin(async (tx) => {
        /* 소유자 롤로는 정책이 안 돈다 — authenticated로 낮추고 JWT를 심는다 */
        await tx`select set_config('request.jwt.claims',
          ${JSON.stringify({ sub: member.id, role: "authenticated" })}, true)`;
        await tx`set local role authenticated`;
        await tx`
          insert into questions (id, organization_id, kind, review_status)
          values (${uuidv7()}, ${PLATFORM_ORGANIZATION_ID}, 'short_answer', 'review_required')
        `;
      });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);

    /* **막힌 이유가 RLS인지** 확인한다. 같은 삽입이 소유자 롤로는 되어야
     * 한다 — NOT NULL 하나 빠뜨려서 실패한 것을 「정책이 막았다」로 읽으면
     * 정책이 사라진 날에도 이 테스트는 초록으로 남는다. */
    let allowedAsOwner = false;
    await sql
      .begin(async (tx) => {
        await tx`
          insert into questions (id, organization_id, kind, review_status)
          values (${uuidv7()}, ${PLATFORM_ORGANIZATION_ID}, 'short_answer', 'review_required')
        `;
        allowedAsOwner = true;
        throw new Error("__ROLLBACK__");
      })
      .catch((e: Error) => {
        if (e.message !== "__ROLLBACK__") throw e;
      });
    expect(allowedAsOwner).toBe(true);
  });

  it("V-5 조직 purge는 플랫폼을 건드리지 못한다", async () => {
    await expect(purgeOrganizationRows(sql, PLATFORM_ORGANIZATION_ID)).rejects.toThrow(
      /플랫폼 조직은 purge 대상이 아닙니다/,
    );
    /* 막혔는지만이 아니라 **남아 있는지**까지 본다 — 예외를 던지고도
     * 그 전에 몇 표를 비웠으면 막은 것이 아니다. */
    const [q] = await sql<{ n: number }[]>`
      select count(*)::int as n from questions
      where organization_id = ${PLATFORM_ORGANIZATION_ID}
    `;
    expect(q!.n).toBeGreaterThan(0);
  });

  it("V-5' 테스트 잔재 정리도 플랫폼에는 돌지 않는다", async () => {
    /* purgeTestData는 **이름 규칙**으로 고른다(「E2E자료-」·「%테스트%」).
     * 그 규칙은 플랫폼에서 안전하지 않다 — 공용 자료 하나가 언젠가 그 이름을
     * 가지면 모든 학원이 함께 보는 자료가 조용히 사라진다. --org=로 아무
     * 조직이나 넘길 수 있으므로 함수 안에서 막는다.
     *
     * dry-run으로 부른다: 「세기만 하는 것도 막는가」가 요점이다. 돌려도
     * 되는 곳이라는 답을 주면 다음에 진짜로 돌린다. */
    await expect(
      purgeTestData(sql, PLATFORM_ORGANIZATION_ID, { dryRun: true }),
    ).rejects.toThrow(/플랫폼 조직은 테스트 정리 대상이 아닙니다/);
  });
});
