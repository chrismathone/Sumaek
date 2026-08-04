import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 노드 종류별 payload (T2.1) — 라이브 DB 통합 테스트.
 *
 * DB 스키마에는 book_edition_id·page_range·homework·blueprint_id·
 * completion_criteria가 이미 있는데 빌더 폼과 액션이 **하나도 저장하지
 * 않았다.** 교재 범위 노드를 만들어도 어느 교재 몇 쪽인지 아무 데도 남지
 * 않으니, 학생 화면이 그 노드를 펼칠 방법이 없다 (G-05).
 *
 * `daily_test`는 DB enum에 있는데 폼의 선택지에 없어서 **도달 자체가
 * 불가능**했다. 자동 평가 생성(M3)의 출발점이 일일테스트 노드이므로,
 * 이것이 막혀 있으면 M3 전체가 갈 곳이 없다.
 *
 * 여기서 겨누는 것:
 *  1. 종류별 필수 필드가 없으면 **거부**된다 (조용히 빈 노드를 만들지 않는다)
 *  2. 준 값이 실제로 DB에 남는다
 *  3. 종류에 맞지 않는 조합은 거부된다
 *  4. daily_test가 도달 가능하다
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
const { addRouteNode } = await import("@/app/app/routes/actions");
const { NODE_KINDS } = await import("@/app/app/routes/shared");
const { payloadFieldsFor } = await import("@/app/app/routes/node-payload");
const { ROUTE_NODE_KINDS } = await import("@su-maek/core/learning");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";
const TEACHER = "00000000-0000-7000-8000-0000000000a1";

let sql: ReturnType<typeof getSharedSql>;
const PLAN = uuidv7();
const VERSION = uuidv7();
/** 시드된 교재 판본 하나 — 만들지 않고 빌려 쓴다 (books 체인까지 세우지 않으려고) */
let BOOK = "";

/** 노드 하나를 더한다. 성공하면 방금 만든 행을 돌려준다. */
async function addNode(fields: Record<string, string>) {
  const form = new FormData();
  form.set("planId", PLAN);
  form.set("expectedLockVersion", String(await lockVersion()));
  form.set("expectedMinutes", "30");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return addRouteNode(null, form);
}

async function lockVersion(): Promise<number> {
  const [row] = await sql<{ lock_version: number }[]>`
    select lock_version from route_plans where id = ${PLAN}
  `;
  return row!.lock_version;
}

async function nodeByTitle(title: string) {
  const [row] = await sql<
    {
      kind: string;
      book_edition_id: string | null;
      page_range: unknown;
      homework: unknown;
      blueprint_id: string | null;
      completion_criteria: unknown;
    }[]
  >`
    select kind::text, book_edition_id::text, page_range, homework,
           blueprint_id::text, completion_criteria
    from route_nodes
    where route_version_id = ${VERSION} and title = ${title}
  `;
  return row ?? null;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();
  claims.sub = TEACHER;

  await sql`
    insert into route_plans (id, organization_id, kind, name, status, lock_version)
    values (${PLAN}, ${ORG}, 'group_route', ${"payload 테스트 루트"}, 'draft', 1)
  `;
  await sql`
    insert into route_versions
      (id, organization_id, route_plan_id, version_number, status)
    values (${VERSION}, ${ORG}, ${PLAN}, 1, 'draft')
  `;
  const [edition] = await sql<{ id: string }[]>`
    select id::text from book_editions where organization_id = ${ORG} limit 1
  `;
  BOOK = edition?.id ?? "";
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`delete from route_nodes where route_version_id = ${VERSION}`;
  await sql`delete from route_versions where id = ${VERSION}`;
  await sql`delete from route_plans where id = ${PLAN}`;
  claims.sub = null;
});

async function enumKinds(): Promise<string[]> {
  const rows = await sql<{ label: string }[]>`
    select unnest(enum_range(null::route_node_kind))::text as label
  `;
  return rows.map((r) => r.label);
}

describe.skipIf(!hasDb)("도달 가능한 노드 종류", () => {
  it("daily_test가 선택지에 있다 — 자동 평가 생성의 출발점", () => {
    expect(NODE_KINDS).toContain("daily_test");
  });

  it("선택지가 DB enum의 부분집합이다 — 없는 종류를 내밀지 않는다", async () => {
    const dbKinds = await enumKinds();
    for (const kind of NODE_KINDS) expect(dbKinds).toContain(kind);
  });

  it("실행기의 종류 목록이 DB enum과 정확히 같다", async () => {
    /* packages/core는 DB를 읽을 수 없어 enum을 손으로 옮겨 적는다. 그 사본이
     * 낡으면 새 종류가 실행기 없이 흘러들고, 그 노드는 학생 화면에서 조용히
     * 사라진다. enum에 한 종류가 늘면 **이 스펙이 먼저 깨진다.** */
    expect([...ROUTE_NODE_KINDS].sort()).toEqual((await enumKinds()).sort());
  });
});

describe("폼이 여는 칸 (payloadFieldsFor)", () => {
  /* 전부 열어 두면 교사는 개념 수업에도 쪽 범위를 채워야 하는 줄 알고,
   * 채우면 서버가 거부한다. 폼과 검증이 같은 표를 봐야 한다. */
  it("종류마다 필요한 칸만 연다", () => {
    expect(payloadFieldsFor("book_range")).toEqual({
      book: true,
      homework: false,
      assessment: false,
    });
    expect(payloadFieldsFor("homework")).toEqual({
      book: true,
      homework: true,
      assessment: false,
    });
    expect(payloadFieldsFor("daily_test")).toEqual({
      book: false,
      homework: false,
      assessment: true,
    });
    expect(payloadFieldsFor("confirmation_test").assessment).toBe(true);
  });

  it("payload가 없는 종류는 칸을 열지 않는다", () => {
    for (const kind of ["concept_lesson", "problem_solving", "buffer"]) {
      expect(payloadFieldsFor(kind)).toEqual({
        book: false,
        homework: false,
        assessment: false,
      });
    }
  });
});

describe.skipIf(!hasDb)("교재 범위", () => {
  it("교재와 쪽 범위가 없으면 거부한다", async () => {
    const r = await addNode({ kind: "book_range", title: "범위 없음" });
    expect(r.ok).toBe(false);
    expect(await nodeByTitle("범위 없음")).toBeNull();
  });

  it("끝 쪽이 시작 쪽보다 앞서면 거부한다", async () => {
    const r = await addNode({
      kind: "book_range",
      title: "거꾸로 범위",
      bookEditionId: BOOK,
      startPage: "40",
      endPage: "12",
    });
    expect(r.ok).toBe(false);
    expect(await nodeByTitle("거꾸로 범위")).toBeNull();
  });

  it("교재 판본과 시작·끝 쪽이 저장된다", async () => {
    const r = await addNode({
      kind: "book_range",
      title: "정상 범위",
      bookEditionId: BOOK,
      startPage: "12",
      endPage: "40",
    });
    expect(r.ok).toBe(true);

    const row = await nodeByTitle("정상 범위");
    expect(row!.book_edition_id).toBe(BOOK);
    expect(row!.page_range).toEqual({ startPage: 12, endPage: 40 });
  });
});

describe.skipIf(!hasDb)("숙제", () => {
  it("방식이 없으면 거부한다 — 학생이 무엇을 할지 알 수 없다", async () => {
    const r = await addNode({ kind: "homework", title: "방식 없음" });
    expect(r.ok).toBe(false);
    expect(await nodeByTitle("방식 없음")).toBeNull();
  });

  it("교재 쪽 방식은 교재와 범위를 함께 요구한다", async () => {
    const r = await addNode({
      kind: "homework",
      title: "교재만 없는 숙제",
      homeworkMode: "book_pages",
      startPage: "3",
      endPage: "5",
    });
    expect(r.ok).toBe(false);
  });

  it("교재 쪽 숙제가 저장된다", async () => {
    const r = await addNode({
      kind: "homework",
      title: "교재 숙제",
      homeworkMode: "book_pages",
      bookEditionId: BOOK,
      startPage: "3",
      endPage: "5",
    });
    expect(r.ok).toBe(true);

    const row = await nodeByTitle("교재 숙제");
    expect(row!.homework).toMatchObject({ mode: "book_pages" });
    expect(row!.book_edition_id).toBe(BOOK);
    expect(row!.page_range).toEqual({ startPage: 3, endPage: 5 });
  });

  it("시스템 연습 숙제는 연습 자료를 요구하고 저장한다", async () => {
    const material = uuidv7();
    const missing = await addNode({
      kind: "homework",
      title: "자료 없는 연습 숙제",
      homeworkMode: "practice_set",
    });
    expect(missing.ok).toBe(false);

    const r = await addNode({
      kind: "homework",
      title: "연습 숙제",
      homeworkMode: "practice_set",
      practiceMaterialId: material,
    });
    expect(r.ok).toBe(true);
    expect(await nodeByTitle("연습 숙제")).toMatchObject({
      homework: { mode: "practice_set", practiceMaterialId: material },
    });
  });

  it("파일 업로드·자유 서술 방식은 받지 않는다 — MVP 비범위", async () => {
    const r = await addNode({
      kind: "homework",
      title: "업로드 숙제",
      homeworkMode: "file_upload",
    });
    expect(r.ok).toBe(false);
  });
});

describe.skipIf(!hasDb)("평가 노드", () => {
  it("참조 없이도 만들어진다 — 출제 규칙은 평가 정책이 정한다", async () => {
    /* **뒤집힌 단언이다** (T3.3). 예전에는 블루프린트를 필수로 요구했다.
     * 근거는 "참조가 없으면 무엇을 출제할지 알 수 없다"였는데, 틀렸다 —
     * 무엇을 출제할지는 평가 정책이 정하고 블루프린트는 생성기가 그때 만들어
     * 남기는 **산출물**이다. 교사가 고를 목록도, 만들 화면도 없었다
     * (실측: 블루프린트 283건 전부 생성 결과, 평가 노드 1건은 NULL).
     * 그래서 이 규칙은 평가 노드를 **아예 만들 수 없게** 만들고 있었다. */
    for (const kind of ["daily_test", "confirmation_test"]) {
      const r = await addNode({ kind, title: `참조 없음 ${kind}` });
      expect(r.ok).toBe(true);
      expect(await nodeByTitle(`참조 없음 ${kind}`)).not.toBeNull();
    }
  });

  it("블루프린트 참조를 주면 형식만 검사해 보관한다", async () => {
    /* 「이 블루프린트를 다시 쓴다」가 생기면 그 자리가 여기다.
     * 지금은 생성기가 읽지 않는다 — 있는 척하지 않는다. */
    const blueprint = uuidv7();
    const r = await addNode({
      kind: "daily_test",
      title: "일일테스트",
      blueprintId: blueprint,
    });
    expect(r.ok).toBe(true);
    expect((await nodeByTitle("일일테스트"))!.blueprint_id).toBe(blueprint);
  });

  it("블루프린트 참조 형식이 틀리면 거부한다", async () => {
    const r = await addNode({
      kind: "daily_test",
      title: "형식 틀린 참조",
      blueprintId: "not-a-uuid",
    });
    expect(r.ok).toBe(false);
    expect(await nodeByTitle("형식 틀린 참조")).toBeNull();
  });

  it("통과 기준을 주면 완료 조건으로 저장된다", async () => {
    const r = await addNode({
      kind: "confirmation_test",
      title: "확인테스트",
      blueprintId: uuidv7(),
      passScore: "70",
    });
    expect(r.ok).toBe(true);
    expect((await nodeByTitle("확인테스트"))!.completion_criteria).toMatchObject({
      passScore: 70,
    });
  });
});

describe.skipIf(!hasDb)("종류에 맞지 않는 조합", () => {
  it("개념 수업에 쪽 범위를 주면 거부한다", async () => {
    const r = await addNode({
      kind: "concept_lesson",
      title: "쪽 범위 붙은 개념 수업",
      bookEditionId: BOOK,
      startPage: "1",
      endPage: "2",
    });
    expect(r.ok).toBe(false);
    expect(await nodeByTitle("쪽 범위 붙은 개념 수업")).toBeNull();
  });

  it("교재 범위에 블루프린트를 주면 거부한다", async () => {
    const r = await addNode({
      kind: "book_range",
      title: "블루프린트 붙은 교재 범위",
      bookEditionId: BOOK,
      startPage: "1",
      endPage: "2",
      blueprintId: uuidv7(),
    });
    expect(r.ok).toBe(false);
  });

  it("payload가 필요 없는 종류는 그대로 만들어진다", async () => {
    const r = await addNode({ kind: "buffer", title: "버퍼 노드" });
    expect(r.ok).toBe(true);
    const row = await nodeByTitle("버퍼 노드");
    expect(row!.book_edition_id).toBeNull();
    expect(row!.homework).toBeNull();
    expect(row!.blueprint_id).toBeNull();
  });
});
