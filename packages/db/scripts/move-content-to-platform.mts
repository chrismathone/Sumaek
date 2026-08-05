/**
 * 콘텐츠를 플랫폼 조직으로 옮긴다 — `pnpm content:move-to-platform`
 *
 *   … --dry          무엇이 옮겨지는지만 센다
 *   … --from=<uuid>  원래 조직 (기본: 데모 조직)
 *
 * 0020a 마이그레이션과 **같은 일**을 한다. 따로 두는 이유는 마이그레이션이
 * 한 번 적용되면 다시 돌지 않기 때문이다. 반입이 뒤늦게 끝났거나, 반입이
 * 도는 중에 마이그레이션이 지나갔거나 하면 콘텐츠가 다시 조직 쪽에 쌓인다.
 * 그때 이것을 돌린다.
 *
 * **실제로 그런 일이 있었다** (2026-08-05). 마이그레이션이 17:51에 돌았고,
 * 그 뒤 17:55부터 다른 작업이 RPM 6권을 재반입했다. 재반입은 기존 문항을
 * `source_ref` 기준으로 지우는데 그 삭제가 **조직을 가리지 않아** 플랫폼으로
 * 옮겨 둔 사본까지 지웠고, 새 문항 6,151건은 데모 조직에 들어갔다. 데이터는
 * 잃지 않았지만 이전은 되돌아갔다.
 *
 * 교훈은 스크립트가 아니라 순서에 있다: **반입이 도는 중에는 옮기지 않는다.**
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import postgres from "postgres";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const FROM =
  argv.find((a) => a.startsWith("--from="))?.slice(7) ??
  "00000000-0000-7000-8000-000000000001";

/** 0020a와 같은 목록. 한쪽만 고치면 두 경로가 갈린다. */
const CONTENT_TABLES = [
  "publishers", "books", "book_editions", "content_rights",
  "source_files", "source_pages",
  "questions", "question_versions", "question_alignments", "math_expressions",
  "math_normalization_runs", "math_render_artifacts", "formula_reviews",
  "diagram_assets", "question_assets", "duplicate_groups", "content_reviews",
  "learning_materials", "concept_blank_sets",
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

const rows: { 표: string; 옮길행: number }[] = [];
let total = 0;
for (const t of CONTENT_TABLES) {
  const [{ n }] = await sql.unsafe<{ n: number }[]>(
    `select count(*)::int as n from ${t} where organization_id = $1`,
    [FROM],
  );
  if (n > 0) rows.push({ 표: t, 옮길행: n });
  total += n;
}
console.table(rows);
console.log(`총 ${total}행 · ${FROM} → ${platform}`);

if (DRY) {
  console.log("\n--dry — 아무것도 쓰지 않았습니다.");
  await sql.end();
  process.exit(0);
}

for (const t of CONTENT_TABLES) {
  await sql.unsafe(
    `update ${t} set organization_id = $1 where organization_id = $2`,
    [platform, FROM],
  );
}
console.log("이전 완료.");
await sql.end();
