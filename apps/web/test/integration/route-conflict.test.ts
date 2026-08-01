import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 동시 수정 충돌 diff (인수 20) — 라이브 DB 통합 테스트.
 *
 * 순수 계산(diff·intent)은 packages/core/test/routes/conflict.test.ts가 덮는다.
 * 여기서 붙잡는 것은 그 계산이 **실제 편집 액션에 배선되어 있는가**다:
 * 두 사용자가 같은 초안을 편집할 때 액션이 충돌을 거부하면서 항목 단위 비교를
 * 함께 돌려주는지, 그리고 "다시 적용"이 내 변경을 실제로 살려 내는지.
 *
 * Supabase 인증과 Next 캐시만 대역으로 세우고 나머지(권한·DB·잠금)는 진짜다.
 * ───────────────────────────────────────────────────────────── */

const claims: { sub: string | null } = { sub: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: claims.sub ? { claims: { sub: claims.sub } } : null,
      }),
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { getSharedSql } = await import("@su-maek/db");
const { encodeRouteSnapshot } = await import("@su-maek/core/routes");
const { addRouteNode, deleteRouteNode, moveRouteNode } = await import(
  "@/app/app/routes/actions"
);

const hasDb = Boolean(process.env.DATABASE_URL);

const ORG = "ffffffff-0000-7000-8000-000000200001";
const TEACHER = "ffffffff-0000-7000-8000-000000200002";

interface NodeRow {
  id: string;
  kind: string;
  title: string;
  sort_order: number;
  expected_minutes: number | null;
}

describe.skipIf(!hasDb)("동시 수정 충돌 diff (인수 20)", () => {
  // 연결은 beforeAll에서 — skip된 describe의 콜백도 수집 단계에서 실행된다
  let sql: ReturnType<typeof getSharedSql>;
  let planId: string;
  let versionId: string;

  /** 화면이 그리는 것과 같은 목록 — 폼에 실릴 스냅샷의 원본 */
  const readNodes = async (): Promise<NodeRow[]> =>
    await sql<NodeRow[]>`
      select id, kind, title, sort_order, expected_minutes
      from route_nodes where route_version_id = ${versionId}
      order by sort_order
    `;

  const snapshotOf = (rows: NodeRow[]) =>
    encodeRouteSnapshot(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        sortOrder: r.sort_order,
        expectedMinutes: r.expected_minutes ?? 60,
      })),
    );

  const lockVersion = async (): Promise<number> => {
    const [row] = await sql<{ lock_version: number }[]>`
      select lock_version from route_plans where id = ${planId}
    `;
    return row!.lock_version;
  };

  /** 다른 사용자의 저장 — 액션과 같은 방식으로 토큰을 올리고 노드를 넣는다 */
  const otherUserAddsNode = async (title: string): Promise<string> => {
    const id = uuidv7();
    await sql`update route_plans set lock_version = lock_version + 1 where id = ${planId}`;
    await sql`
      insert into route_nodes (
        id, organization_id, route_version_id, kind, title, sort_order, expected_minutes
      ) values (
        ${id}, ${ORG}, ${versionId}, 'concept_lesson', ${title},
        (select coalesce(max(sort_order), 0) + 1 from route_nodes
          where route_version_id = ${versionId}),
        60
      )
    `;
    return id;
  };

  const form = (entries: Record<string, string | string[]>): FormData => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) {
      if (Array.isArray(v)) for (const item of v) fd.append(k, item);
      else fd.set(k, v);
    }
    return fd;
  };

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 충돌 diff', 'itest-conflict-diff', 'Asia/Seoul')
      on conflict (id) do nothing
    `;
    await sql`
      insert into users (id, email, display_name)
      values (${TEACHER}, 'itest-conflict-teacher@example.test', 'ITEST 충돌 교사')
      on conflict (id) do nothing
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values (${uuidv7()}, ${ORG}, ${TEACHER}, 'teacher', 'active')
      on conflict (organization_id, user_id) do nothing
    `;
    claims.sub = TEACHER;
  });

  afterAll(async () => {
    // 루트 관련 데이터는 불변 대상이 아니라 지울 수 있다 (감사·숙련도와 다름)
    await sql`delete from route_nodes where organization_id = ${ORG}`;
    await sql`delete from route_versions where organization_id = ${ORG}`;
    await sql`delete from route_plans where organization_id = ${ORG}`;
    await sql`delete from audit_events where organization_id = ${ORG}`;
    claims.sub = null;
  });

  /** 매 테스트가 같은 출발선에서 시작하도록 초안을 새로 만든다 */
  const freshPlan = async (titles: string[]) => {
    planId = uuidv7();
    versionId = uuidv7();
    await sql`
      insert into route_plans (id, organization_id, kind, name, status)
      values (${planId}, ${ORG}, 'group_route', 'ITEST 충돌 루트', 'draft')
    `;
    await sql`
      insert into route_versions (
        id, organization_id, route_plan_id, version_number, status, created_by
      ) values (${versionId}, ${ORG}, ${planId}, 1, 'draft', ${TEACHER})
    `;
    let order = 0;
    for (const title of titles) {
      order += 1;
      await sql`
        insert into route_nodes (
          id, organization_id, route_version_id, kind, title, sort_order, expected_minutes
        ) values (
          ${uuidv7()}, ${ORG}, ${versionId}, 'concept_lesson', ${title}, ${order}, 60
        )
      `;
    }
  };

  it("남이 먼저 저장하면 거부하면서 무엇이 달라졌는지 항목으로 돌려준다", async () => {
    await freshPlan(["일차함수의 뜻", "일차함수의 그래프"]);
    // A가 화면을 읽는다 — 토큰과 노드 스냅샷을 함께 들고 있는다
    const readLock = await lockVersion();
    const baseline = snapshotOf(await readNodes());

    // B가 먼저 저장한다
    await otherUserAddsNode("다른 사용자가 넣은 노드");

    // A가 낡은 토큰으로 제출한다
    const result = await addRouteNode(
      null,
      form({
        planId,
        kind: "homework",
        title: "내가 넣으려던 숙제",
        expectedMinutes: "45",
        expectedLockVersion: String(readLock),
        baselineNodes: baseline,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("VERSION_CONFLICT");
    const conflict = result.conflict!;
    expect(conflict).toBeDefined();
    expect(conflict.comparable).toBe(true);
    expect(conflict.baseLockVersion).toBe(readLock);
    expect(conflict.currentLockVersion).toBe(readLock + 1);

    // 남의 변경: 노드 하나 추가 — 제목까지 집어낸다
    expect(conflict.theirChanges.map((c) => [c.code, c.title])).toEqual([
      ["ADDED", "다른 사용자가 넣은 노드"],
    ]);
    // 내 변경: 아직 저장되지 않은 내 노드
    expect(conflict.myChanges.map((c) => [c.code, c.title])).toEqual([
      ["ADDED", "내가 넣으려던 숙제"],
    ]);
    // 나란히 그릴 두 목록이 실제로 다르다
    expect(conflict.mine.map((n) => n.title)).toContain("내가 넣으려던 숙제");
    expect(conflict.mine.map((n) => n.title)).not.toContain(
      "다른 사용자가 넣은 노드",
    );
    expect(conflict.theirs.map((n) => n.title)).toContain(
      "다른 사용자가 넣은 노드",
    );
    // 내 시수도 살아 있다 (표시 전용이지만 화면이 그대로 보여 준다)
    expect(
      conflict.mine.find((n) => n.title === "내가 넣으려던 숙제")!
        .expectedMinutes,
    ).toBe(45);

    // 거부는 진짜다 — 내 노드는 저장되지 않았다
    const after = await readNodes();
    expect(after.map((n) => n.title)).not.toContain("내가 넣으려던 숙제");
  });

  it("다시 적용하면 내 변경이 최신 상태 위에 살아난다 (새로 고침이 답이 아니다)", async () => {
    await freshPlan(["일차함수의 뜻"]);
    const readLock = await lockVersion();
    const baseline = snapshotOf(await readNodes());
    await otherUserAddsNode("다른 사용자 노드");

    const conflicted = await addRouteNode(
      null,
      form({
        planId,
        kind: "concept_lesson",
        title: "내 노드",
        expectedMinutes: "60",
        expectedLockVersion: String(readLock),
        baselineNodes: baseline,
      }),
    );
    const conflict = conflicted.conflict!;
    expect(conflict.reapply.possible).toBe(true);

    // 화면의 "다시 적용"이 보내는 것과 같은 폼 — 최신 토큰 + 최신 스냅샷
    const retried = await addRouteNode(
      null,
      form({
        planId,
        kind: conflict.intent.type === "add" ? conflict.intent.kind : "",
        title: conflict.intent.type === "add" ? conflict.intent.title : "",
        expectedMinutes:
          conflict.intent.type === "add"
            ? String(conflict.intent.expectedMinutes)
            : "",
        expectedLockVersion: String(conflict.currentLockVersion),
        baselineNodes: encodeRouteSnapshot(conflict.theirs),
      }),
    );

    expect(retried.ok).toBe(true);
    expect(retried.conflict).toBeUndefined();
    const titles = (await readNodes()).map((n) => n.title);
    // 두 사람의 변경이 모두 남았다 — 어느 쪽도 조용히 사라지지 않았다
    expect(titles).toContain("다른 사용자 노드");
    expect(titles).toContain("내 노드");
  });

  it("남이 먼저 지운 노드를 지우려던 것은 다시 적용할 수 없다고 말한다", async () => {
    await freshPlan(["지워질 노드", "남는 노드"]);
    const rows = await readNodes();
    const targetId = rows[0]!.id;
    const readLock = await lockVersion();
    const baseline = snapshotOf(rows);

    // B가 같은 노드를 먼저 지운다
    await sql`update route_plans set lock_version = lock_version + 1 where id = ${planId}`;
    await sql`delete from route_nodes where id = ${targetId}`;

    const result = await deleteRouteNode(
      null,
      form({
        planId,
        nodeId: targetId,
        expectedLockVersion: String(readLock),
        baselineNodes: baseline,
      }),
    );

    const conflict = result.conflict!;
    expect(conflict.theirChanges.map((c) => [c.code, c.title])).toEqual([
      ["REMOVED", "지워질 노드"],
    ]);
    expect(conflict.reapply.possible).toBe(false);
    expect(conflict.reapply.blockedReason).toContain("이미 없습니다");
    // 같은 노드를 양쪽이 건드렸다는 것도 집어낸다
    expect(conflict.collisions.map((c) => c.nodeId)).toEqual([targetId]);
  });

  it("순서 변경 충돌도 이동 항목으로 보고한다", async () => {
    await freshPlan(["첫째", "둘째", "셋째"]);
    const rows = await readNodes();
    const readLock = await lockVersion();
    const baseline = snapshotOf(rows);

    // B가 첫째·둘째를 맞바꾼다
    await sql`update route_plans set lock_version = lock_version + 1 where id = ${planId}`;
    await sql`update route_nodes set sort_order = 2 where id = ${rows[0]!.id}`;
    await sql`update route_nodes set sort_order = 1 where id = ${rows[1]!.id}`;

    const result = await moveRouteNode(
      null,
      form({
        planId,
        nodeId: rows[2]!.id,
        direction: "up",
        expectedLockVersion: String(readLock),
        baselineNodes: baseline,
      }),
    );

    const conflict = result.conflict!;
    const moved = conflict.theirChanges.filter((c) => c.code === "MOVED");
    expect(moved.map((c) => c.title).sort()).toEqual(["둘째", "첫째"]);
    expect(
      moved.find((c) => c.title === "첫째")!.after,
    ).toBe("2");
    // 내 이동도 항목으로 남는다
    expect(conflict.myChanges.map((c) => c.code)).toContain("MOVED");
  });

  it("스냅샷이 없으면 비교했다고 꾸미지 않는다 — 최신 상태만 보여 준다", async () => {
    await freshPlan(["하나"]);
    const readLock = await lockVersion();
    await otherUserAddsNode("남의 노드");

    const result = await addRouteNode(
      null,
      form({
        planId,
        kind: "concept_lesson",
        title: "내 노드",
        expectedMinutes: "60",
        expectedLockVersion: String(readLock),
        // baselineNodes 없음 (구버전 폼·손상된 값)
      }),
    );

    const conflict = result.conflict!;
    expect(conflict.comparable).toBe(false);
    expect(conflict.theirChanges).toEqual([]);
    expect(conflict.theirs.map((n) => n.title)).toEqual(["하나", "남의 노드"]);
  });

  it("충돌이 없으면 conflict를 달지 않는다 (정상 경로 대조군)", async () => {
    await freshPlan(["하나"]);
    const result = await addRouteNode(
      null,
      form({
        planId,
        kind: "concept_lesson",
        title: "정상 추가",
        expectedMinutes: "60",
        expectedLockVersion: String(await lockVersion()),
        baselineNodes: snapshotOf(await readNodes()),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.conflict).toBeUndefined();
  });
});
