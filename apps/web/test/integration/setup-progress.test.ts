import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 설정 진행이 서버 상태에서 나오는가 (T5.1) — 라이브 DB.
 *
 * 순수 판정은 `test/ui/setup-progress.test.ts`가 본다. 여기서 보는 것은
 * **빈 조직이 정말 0단계에서 시작하는가**이다.
 *
 * 데모 시드가 든 조직으로 확인하면 이 검사는 아무것도 못 잡는다 — 새
 * 학원이 겪는 상태가 아니기 때문이다. 그래서 조직을 새로 만든다.
 * ───────────────────────────────────────────────────────────── */

const { getSharedSql } = await import("@su-maek/db");
const { buildSetupProgress, loadSetupFacts } = await import(
  "@/lib/domain/setup-progress"
);

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "ffffffff-0000-7000-8000-000000051001";
const PERIOD = uuidv7();

let sql: ReturnType<typeof getSharedSql>;

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();
  await sql`
    insert into organizations (id, name, slug, timezone)
    values (${ORG}, 'ITEST 온보딩', 'itest-onboarding', 'Asia/Seoul')
    on conflict (id) do nothing
  `;
  await sql`delete from course_periods where organization_id = ${ORG}`;
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`delete from course_periods where organization_id = ${ORG}`;
});

describe.skipIf(!hasDb)("빈 학원의 설정 진행", () => {
  it("아무것도 없는 조직은 첫 단계부터 시작한다", async () => {
    /* 시드된 과정 기간 없이 시작한다 — 그것이 새 학원이 만나는 상태다. */
    const p = buildSetupProgress(await loadSetupFacts(ORG));
    expect(p.doneCount).toBe(0);
    expect(p.next?.id).toBe("course_period");
    expect(p.complete).toBe(false);
  });

  it("기간을 만들면 다음 단계로 넘어간다 — 저장한 진행률이 아니라 파생이다", async () => {
    await sql`
      insert into course_periods
        (id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${PERIOD}, ${ORG}, '온보딩 기간', 2026, '2026-08-01', '2026-12-31', 'active')
    `;

    const p = buildSetupProgress(await loadSetupFacts(ORG));
    expect(p.steps.find((s) => s.id === "course_period")!.done).toBe(true);
    expect(p.next?.id).toBe("learning_group");
    /* 반이 없으므로 학생 단계는 여전히 막혀 있다 */
    expect(p.steps.find((s) => s.id === "learners")!.blockedBy).toBe(
      "learning_group",
    );
  });

  it("남의 조직 데이터가 진행에 새지 않는다", async () => {
    /* 데모 조직에는 기간·반·학생이 가득하다. 조직 조건이 빠지면 새 학원이
     * 열자마자 「설정 끝」을 본다. */
    const other = buildSetupProgress(
      await loadSetupFacts("00000000-0000-7000-8000-000000000001"),
    );
    const mine = buildSetupProgress(await loadSetupFacts(ORG));
    expect(mine.doneCount).toBeLessThan(other.doneCount);
    expect(mine.steps.find((s) => s.id === "learners")!.done).toBe(false);
  });
});
