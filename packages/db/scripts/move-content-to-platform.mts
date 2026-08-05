/**
 * 콘텐츠를 플랫폼 조직으로 옮긴다 — `pnpm content:move-to-platform`
 *
 *   … --dry          무엇이 옮겨지는지·무엇이 남는지만 센다
 *   … --from=<uuid>  원래 조직 (기본: 데모 조직)
 *
 * 0020a 마이그레이션과 **같은 방향**의 일을 한다. 따로 두는 이유는
 * 마이그레이션이 한 번 적용되면 다시 돌지 않기 때문이다. 반입이 뒤늦게
 * 끝났거나, 반입이 도는 중에 마이그레이션이 지나갔거나 하면 콘텐츠가 다시
 * 조직 쪽에 쌓인다. 그때 이것을 돌린다.
 *
 * **실제로 그런 일이 있었다** (2026-08-05). 마이그레이션이 17:51에 돌았고,
 * 그 뒤 17:55부터 다른 작업이 RPM 6권을 재반입했다. 재반입은 기존 문항을
 * `source_ref` 기준으로 지우는데 그 삭제가 **조직을 가리지 않아** 플랫폼으로
 * 옮겨 둔 사본까지 지웠고, 새 문항 6,151건은 데모 조직에 들어갔다. 데이터는
 * 잃지 않았지만 이전은 되돌아갔다.
 *
 * 교훈은 스크립트가 아니라 순서에 있다: **반입이 도는 중에는 옮기지 않는다.**
 *
 * ## 마이그레이션과 다른 점 — 전부 옮기지는 않는다
 *
 * 0020a는 조직의 콘텐츠 표를 통째로 옮겼다. 그때는 데모 조직에 있는 것이
 * 전부 반입·시드 콘텐츠였기 때문이다. 지금은 두 종류가 섞여 있다.
 *
 * 1. **테스트가 만든 문항** — 통합 테스트가 실행마다 사용권 1건 + 문항 1건씩
 *    남긴다(실측 60건). 플랫폼으로 올리면 **모든 학원의 문제은행과 연습
 *    자동 선별 후보**가 된다. 게다가 플랫폼은 purge 대상이 아니라(6단계
 *    가드) 한 번 올라가면 걷어 낼 길이 없다. 조직에 남겨 두면 지금처럼
 *    `pnpm purge:test-data`가 맡는다.
 * 2. **학원이 만든 학습 자료** — ADR-0020 갈래 C에서 자료는 조직이 가질 수
 *    있다(플랫폼 기본 + 조직 덮어쓰기). 그래서 `learning_materials`는 아예
 *    옮기지 않는다. 반입이 만드는 자료는 애초에 플랫폼에 쓰인다.
 *
 * 그래서 표마다 조건이 다르다. 조건은 **부모를 따라간다** — 문항이 남으면
 * 그 문항의 버전·정렬·수식도 남는다. 아니면 한쪽만 옮겨져 고아가 된다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import postgres from "postgres";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const FROM =
  argv.find((a) => a.startsWith("--from="))?.slice(7) ??
  "00000000-0000-7000-8000-000000000001";

/**
 * 옮길 표와 조건 — **순서가 뜻을 갖는다.**
 *
 * 뒤 단계의 조건이 「부모가 이미 플랫폼에 있는가」를 묻기 때문이다.
 * 예: 문항 버전은 자기 문항이 옮겨진 뒤라야 옮겨진다. 순서를 바꾸면 아무것도
 * 안 옮겨지거나(조건이 아직 거짓) 고아가 생긴다.
 *
 * `$1`은 **원본 조직** 하나뿐이고, 플랫폼은 파라미터가 아니라
 * `platform_org_id()`로 쓴다 — 조건마다 쓰는 파라미터가 다르면 PostgreSQL이
 * 안 쓰인 파라미터의 타입을 못 정해 그 자리에서 죽는다(실측: 42P18).
 */
const STEPS: { table: string; where: string; why?: string }[] = [
  // 교재·지면 — 반입 산출물이라 통째로
  { table: "publishers", where: "organization_id = $1" },
  { table: "books", where: "organization_id = $1" },
  { table: "book_editions", where: "organization_id = $1" },
  { table: "source_files", where: "organization_id = $1" },
  { table: "source_pages", where: "organization_id = $1" },

  /* 사용권 — 테스트가 만든 것은 남긴다. 이 한 줄이 아래 문항 조건의
   * 근거가 된다(문항은 「옮겨진 사용권」을 가진 것만 따라간다). */
  {
    table: "content_rights",
    where:
      "organization_id = $1 and rights_holder not like '%테스트%' and rights_holder not like '%통합%'",
    why: "테스트 사용권은 조직에 남긴다 — 플랫폼은 purge가 안 된다",
  },
  {
    table: "questions",
    where:
      "organization_id = $1 and content_right_id in (select id from content_rights where organization_id = platform_org_id())",
    why: "사용권이 따라오지 않은 문항(=테스트 문항)은 남는다",
  },
  {
    table: "question_versions",
    where:
      "organization_id = $1 and question_id in (select id from questions where organization_id = platform_org_id())",
  },
  {
    table: "question_alignments",
    where:
      "organization_id = $1 and question_id in (select id from questions where organization_id = platform_org_id())",
  },
  {
    table: "math_expressions",
    where:
      "organization_id = $1 and question_version_id in (select id from question_versions where organization_id = platform_org_id())",
  },
  {
    table: "math_normalization_runs",
    where:
      "organization_id = $1 and expression_id in (select id from math_expressions where organization_id = platform_org_id())",
  },
  {
    table: "formula_reviews",
    where:
      "organization_id = $1 and question_id in (select id from questions where organization_id = platform_org_id())",
  },
  {
    table: "diagram_assets",
    where:
      "organization_id = $1 and question_version_id in (select id from question_versions where organization_id = platform_org_id())",
  },
  {
    table: "question_assets",
    where:
      "organization_id = $1 and question_version_id in (select id from question_versions where organization_id = platform_org_id())",
  },
  /* 다형 참조(subject_type·subject_id) — 대상이 옮겨졌으면 따라간다 */
  {
    table: "math_render_artifacts",
    where: `organization_id = $1 and subject_id in (
              select id from question_versions where organization_id = platform_org_id()
              union all select id from math_expressions where organization_id = platform_org_id())`,
  },
  {
    table: "content_reviews",
    where: `organization_id = $1 and subject_id in (
              select id from questions where organization_id = platform_org_id()
              union all select id from question_versions where organization_id = platform_org_id())`,
  },
  // 중복 묶음은 콘텐츠 풀 전체를 보는 반입 산출물이라 통째로
  { table: "duplicate_groups", where: "organization_id = $1" },
  {
    table: "concept_blank_sets",
    where:
      "organization_id = $1 and source_material_id in (select id from learning_materials where organization_id = platform_org_id())",
    why: "자료가 플랫폼에 있는 것만 — 학원 자료의 빈칸은 학원에 남는다",
  },
];

/** 일부러 옮기지 않는 표 — 침묵하지 않고 이유를 적는다 */
const NOT_MOVED: { table: string; why: string }[] = [
  {
    table: "learning_materials",
    why: "갈래 C — 학원이 만든 자료는 학원 것이다. 반입 자료는 애초에 플랫폼에 쓰인다",
  },
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL이 없습니다.");
const sql = postgres(url.trim(), { max: 2 });

const [{ platform }] = await sql<{ platform: string | null }[]>`
  select platform_org_id()::text as platform
`;
if (!platform) throw new Error("플랫폼 조직이 없습니다 — 0019b를 먼저 적용하세요.");
if (platform === FROM) throw new Error("원본과 대상이 같습니다.");

/* 반입이 도는 중이면 멈춘다 — 지금 옮기면 반입의 중복 검사가 옮긴 행을
 * 못 보고 전부 다시 넣는다(위 주석의 실사고). 최근 1분 안에 만들어진
 * 문항이 있으면 아직 도는 중으로 본다. */
const [{ recent }] = await sql<{ recent: number }[]>`
  select count(*)::int as recent from questions
  where organization_id = ${FROM} and created_at > now() - interval '1 minute'
`;
if (recent > 0 && !DRY) {
  console.error(
    `최근 1분 안에 문항 ${recent}건이 들어왔습니다 — 반입이 도는 중으로 보입니다.\n` +
      "끝난 뒤에 다시 돌리세요. 지금 옮기면 반입이 같은 문항을 두 벌 만듭니다.",
  );
  await sql.end();
  process.exit(1);
}

/* ── 먼저 부딪히는지 본다 ──────────────────────────────────────
 *
 * 콘텐츠 표에는 `(organization_id, 이름)` 꼴의 유니크 인덱스가 있다. 같은
 * 교재가 두 조직에 각각 들어와 있으면(반입이 두 번 돌면 그렇게 된다) 옮기는
 * 순간 그 인덱스에 걸린다. 그때 필요한 답은 「23505」가 아니라 **무엇이 이미
 * 저쪽에 있는가**다 — 그것이 사람이 내려야 할 결정(어느 쪽을 정본으로 볼
 * 것인가)의 입력이기 때문이다.
 *
 * 실측(2026-08-05): 플랫폼에 RPM 6권과 개념원리 6권의 교재 행이 있고,
 * 데모 조직에 RPM 6권이 다시 들어와 있었다. 앞의 재반입이 남긴 갈래다. */
interface Collision {
  표: string;
  키: string;
  부딪히는행: number;
}

async function preflight(): Promise<Collision[]> {
  const found: Collision[] = [];
  for (const step of STEPS) {
    const indexes = await sql<{ idx: string; cols: string[] }[]>`
      select i.indexrelid::regclass::text as idx,
             (select array_agg(a.attname order by k.ord)
                from unnest(i.indkey) with ordinality k(attnum, ord)
                join pg_attribute a
                  on a.attrelid = i.indrelid and a.attnum = k.attnum) as cols
      from pg_index i
      where i.indisunique and i.indpred is null
        and i.indrelid = ${step.table}::regclass
    `;
    for (const { idx, cols } of indexes) {
      if (!cols?.includes("organization_id")) continue;
      const keyCols = cols.filter((c) => c !== "organization_id");
      if (keyCols.length === 0) continue;
      const match = keyCols
        .map((c) => `b.${c} is not distinct from a.${c}`)
        .join(" and ");
      const [{ n }] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${step.table} a
          where ${step.where}
            and exists (select 1 from ${step.table} b
                         where b.organization_id = platform_org_id() and ${match})`,
        [FROM],
      );
      if (n > 0) found.push({ 표: step.table, 키: `${idx} (${keyCols.join(", ")})`, 부딪히는행: n });
    }
  }
  return found;
}

/**
 * 한 단계를 실행한다. `--dry`면 세기만 한다.
 *
 * dry에서도 **같은 조건**으로 센다. 다만 조건이 앞 단계의 결과에 기대므로
 * (부모가 플랫폼에 있는가) dry의 수는 「지금 그대로 돌리면 첫 단계에서
 * 몇 건이 옮겨지는가」이고, 뒤 단계는 0으로 보인다. 그래서 dry는 **남는
 * 행 수**를 함께 낸다 — 그쪽이 사람이 실제로 확인하고 싶은 값이다.
 */
async function runStep(
  step: { table: string; where: string },
  tx: typeof sql = sql,
): Promise<number> {
  if (DRY) {
    const [{ n }] = await tx.unsafe<{ n: number }[]>(
      `select count(*)::int as n from ${step.table} where ${step.where}`,
      [FROM],
    );
    return n;
  }
  const result = await tx.unsafe(
    `update ${step.table} set organization_id = platform_org_id() where ${step.where}`,
    [FROM],
  );
  return result.count ?? 0;
}

const collisions = await preflight();
if (collisions.length > 0) {
  console.error("같은 열쇠를 가진 행이 **이미 플랫폼에 있다** — 그대로 옮기면 유니크 인덱스에 걸린다.\n");
  console.table(collisions);
  console.error(
    "\n이건 스크립트가 정할 일이 아니다. 같은 교재가 두 벌 있다는 뜻이고,\n" +
      "어느 쪽을 정본으로 둘지(그리고 다른 쪽 행을 어떻게 할지)는 사람이 정해야 한다.\n" +
      "확인: 플랫폼 쪽 교재에 딸린 문항이 있는지 — 없으면 빈 껍데기이고,\n" +
      "있으면 문항까지 두 벌이라는 뜻이다.",
  );
  await sql.end();
  process.exit(1);
}

const rows: { 표: string; 옮김: number; 조직에남음: number }[] = [];
let total = 0;
/* 한 트랜잭션 — 중간에 걸리면 **전부 되돌린다.**
 *
 * 표마다 따로 커밋하면 절반만 옮겨진 상태가 남는다. 그 상태가 정확히 앞선
 * 사고의 모양이었다(교재는 이쪽, 문항은 저쪽). 되돌릴 수 있는 실패가
 * 되돌릴 수 없는 절반보다 낫다. */
await sql.begin(async (tx) => {
  for (const step of STEPS) {
    const moved = await runStep(step, tx as unknown as typeof sql);
    const [{ left }] = await tx.unsafe<{ left: number }[]>(
      `select count(*)::int as left from ${step.table} where organization_id = $1`,
      [FROM],
    );
    if (moved > 0 || left > 0) {
      rows.push({ 표: step.table, 옮김: moved, 조직에남음: left });
    }
    total += moved;
  }
});
console.table(rows);
for (const step of STEPS) {
  if (step.why) console.log(`· ${step.table}: ${step.why}`);
}
for (const n of NOT_MOVED) console.log(`· ${n.table}: 옮기지 않음 — ${n.why}`);
console.log(
  `\n${DRY ? "[dry] " : ""}총 ${total}행 · ${FROM} → ${platform}` +
    (DRY ? "\n--dry — 아무것도 쓰지 않았습니다." : "\n이전 완료."),
);

await sql.end();
