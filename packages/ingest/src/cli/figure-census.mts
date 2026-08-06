/**
 * 그림 문항을 갈래로 나눠 센다 — **무엇을 어떻게 세울지 정하기 위해서다.**
 *
 *   pnpm --filter @su-maek/ingest figure-census [--org=<uuid>] [--verbose]
 *
 * 그림 문항은 지금 `figureBoxes`·`figureLabels`만 남기고 격리되어 있다.
 * 화면에는 **그림 없이 나간다.** 세우려면 먼저 규모와 갈래를 알아야 하는데,
 * 중1-1 55건을 손으로 분류한 문서(docs/figure-svg-plan.md)를 쓰던 때와 달리
 * 지금은 여섯 권 1700문항이 넘는다. 손으로 셀 수 없다.
 *
 * ## 갈래를 라벨로 가른다
 *
 * 지면을 다시 열지 않고도 `figureLabels`만으로 상당히 갈린다. 그 문서가
 * 손으로 확인한 규칙을 그대로 옮긴 것이다:
 *
 *   - **표**: 괘선이 벡터라 그림으로 잡혔을 뿐 내용은 표다. 라벨이
 *     `x`·`y` 머리글과 숫자 나열이고 글자 아닌 것이 거의 없다.
 *   - **좌표평면**: `O`와 `x`·`y` 축 이름이 함께 있거나 `y=…` 식이 있다.
 *   - **도형**: 꼭짓점 이름(A~H)이 둘 이상이거나 `cm`·`°`가 있다.
 *   - **그 밖**: 위 어디에도 안 걸리는 것. 여기만 사람이 봐야 한다.
 *
 * 갈래는 **제안이지 판정이 아니다.** 세우기 전에는 지면을 봐야 한다 —
 * 라벨만으로는 점 A가 (2,3)인지 (3,2)인지 알 수 없다. 그 절차는
 * `render-page.py --clip`이고 좌표는 `source_ref.figureBoxes`에 있다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import postgres from "postgres";
import { contentOrganizationIds } from "@su-maek/core/shared";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const organizationId = arg("org") ?? "00000000-0000-7000-8000-000000000001";
/* 콘텐츠는 플랫폼 소유다 (ADR-0020) — 조직 id로 찾으면 이전이 끝나는 순간
 * 조용히 0건이 된다. 예외도 오류도 없이 「검사할 것이 없다」로 보인다. */
const contentOrgs = contentOrganizationIds(organizationId);
const verbose = args.includes("--verbose");

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

interface Row {
  book: string;
  chapter: string;
  printed_number: string;
  labels: string[];
}

const rows = await sql<Row[]>`
  select
    replace(replace(q.source_ref->>'book', 'RPM 중학 수학 ', ''), ' (2022 개정)', '') as book,
    q.source_ref->'chapter'->>'title' as chapter,
    q.printed_number,
    coalesce(q.source_ref->'figureLabels', '[]'::jsonb) as labels
  from questions q
  where q.organization_id = any(${contentOrgs}::uuid[])
    and q.source_ref ? 'book'
    and jsonb_array_length(coalesce(q.source_ref->'figureBoxes', '[]'::jsonb)) > 0
  order by book, q.printed_number
`;

type Kind = "표" | "좌표평면" | "도형" | "그 밖";

/** 라벨로 갈래를 제안한다 — 판정이 아니다 */
function classify(labels: string[]): Kind {
  const all = labels.join(" ");
  const has = (re: RegExp): boolean => labels.some((l) => re.test(l));

  /* 좌표평면 — 원점 O와 축 이름이 함께 서거나 함수식이 있다 */
  if (has(/^y\s*=/) || (has(/^O$/) && has(/^x$/) && has(/^y$/))) return "좌표평면";

  /* 표 — 숫자와 한두 글자 머리글뿐이고 도형 신호가 없다.
   * 셀이 여럿이어야 표다(라벨 여섯 이상). */
  const numeric = labels.filter((l) => /^-?[\d.]+$/.test(l.trim())).length;
  if (
    labels.length >= 6 &&
    numeric >= labels.length * 0.5 &&
    !/[°ù]|cm|㎝/.test(all) &&
    !has(/^[A-H]$/)
  ) {
    return "표";
  }

  /* 도형 — 꼭짓점 이름이 둘 이상이거나 치수·각도가 있다 */
  const vertices = new Set(labels.filter((l) => /^[A-H]'?$/.test(l.trim()))).size;
  if (vertices >= 2 || /[°ù]|cm|㎝|㎠|㎤/.test(all)) return "도형";

  return "그 밖";
}

const tally = new Map<string, Map<Kind, number>>();
const samples = new Map<Kind, string[]>();
for (const row of rows) {
  const kind = classify(row.labels);
  const byBook = tally.get(row.book) ?? new Map<Kind, number>();
  byBook.set(kind, (byBook.get(kind) ?? 0) + 1);
  tally.set(row.book, byBook);
  const s = samples.get(kind) ?? [];
  if (s.length < 6) {
    s.push(`중${row.book} ${row.printed_number} [${row.labels.slice(0, 8).join(" ")}]`);
    samples.set(kind, s);
  }
}

const KINDS: Kind[] = ["도형", "좌표평면", "표", "그 밖"];
console.log(`그림 있는 문항 ${rows.length}개\n`);
console.log(`${"교재".padEnd(8)}${KINDS.map((k) => k.padStart(9)).join("")}${"합계".padStart(9)}`);
const total = new Map<Kind, number>();
for (const [book, byBook] of [...tally].sort()) {
  const line = KINDS.map((k) => {
    const n = byBook.get(k) ?? 0;
    total.set(k, (total.get(k) ?? 0) + n);
    return String(n).padStart(9);
  }).join("");
  const sum = KINDS.reduce((a, k) => a + (byBook.get(k) ?? 0), 0);
  console.log(`중${book.padEnd(7)}${line}${String(sum).padStart(9)}`);
}
console.log(
  `${"합계".padEnd(8)}${KINDS.map((k) => String(total.get(k) ?? 0).padStart(9)).join("")}` +
    `${String(rows.length).padStart(9)}`,
);

if (verbose) {
  for (const k of KINDS) {
    console.log(`\n● ${k}`);
    for (const s of samples.get(k) ?? []) console.log(`    ${s}`);
  }
}

console.log(
  "\n갈래는 제안이지 판정이 아니다 — 세우기 전에 render-page.py --clip 으로 지면을 볼 것.",
);

await sql.end();
