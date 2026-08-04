/**
 * 반입 문항을 지운다 — **다시 넣기 전에.**
 *
 *   pnpm --filter @su-maek/ingest delete-ingested --yes [--chapter=II]
 *
 * `load`는 이미 있는 인쇄 번호를 만나면 **건너뛴다**(load.ts). 갱신하지
 * 않는다. 그래서 추출 규칙을 고친 뒤 그냥 다시 돌리면 아무 일도 일어나지
 * 않는다 — 성공한 것처럼 보이면서. 반영하려면 지우고 다시 넣어야 한다.
 *
 * 지우는 것은 `source_ref is not null`인 문항뿐이다. 시드 문항은 건드리지
 * 않는다. 외래키가 전부 `on delete NO ACTION`이라 자식부터 지운다
 * (question_alignments → math_expressions → question_versions → questions).
 *
 * **트랜잭션이 안전망이다.** 평가에 이미 쓰인 문항이 있으면
 * assessment_questions의 외래키가 걸려 통째로 롤백된다 — 반쯤 지워진
 * 상태가 남지 않는다. 예전에는 이 절차가 문서의 SQL 조각이었는데,
 * psql이 기본 autocommit이라 `begin;`을 빠뜨리면 그 안전망이 사라졌다.
 *
 * **검수 상태는 되살아나지 않는다.** published·quarantined는 사람이
 * 매긴 것이고 여기서 지우면 그대로 사라진다. 그래서 `--yes`가 필요하다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import postgres from "postgres";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

/** 대단원별 인쇄 번호 구간 — load.mts의 CHAPTERS와 같은 값이다 */
const RANGES: Record<string, [number, number]> = {
  I: [1, 213],
  II: [214, 523],
  III: [524, 914],
  IV: [915, 1123],
};

const chapter = arg("chapter");
if (chapter && !RANGES[chapter]) {
  console.error(`--chapter=${chapter} 는 없는 대단원입니다 (I·II·III·IV).`);
  process.exit(1);
}
const range = chapter ? RANGES[chapter]! : null;

if (!args.includes("--yes")) {
  console.error(
    "사용법: delete-ingested --yes [--chapter=I|II|III|IV]\n\n" +
      "  반입 문항을 지웁니다. 검수 상태(published·quarantined)는 되살릴 수 없습니다.\n" +
      "  정말 지우려면 --yes 를 붙이세요.",
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 2 });

/** 지울 대상 — 대단원을 안 주면 반입분 전부 */
const target = range
  ? sql`select id from questions
        where source_ref is not null
          and (source_ref->>'printedNumber')::int between ${range[0]} and ${range[1]}`
  : sql`select id from questions where source_ref is not null`;

const [before] = await sql<{ n: number; statuses: string }[]>`
  select count(*)::int as n, string_agg(distinct review_status::text, ' ') as statuses
  from questions where id in (${target})`;
console.log(`지울 문항 ${before!.n}개 · 검수 상태 ${before!.statuses ?? "-"}`);

const counts = await sql.begin(async (tx) => {
  const ids = range
    ? tx`select id from questions
         where source_ref is not null
           and (source_ref->>'printedNumber')::int between ${range[0]} and ${range[1]}`
    : tx`select id from questions where source_ref is not null`;
  const alignments = await tx`
    delete from question_alignments where question_id in (${ids}) returning 1`;
  const expressions = await tx`
    delete from math_expressions where question_version_id in (
      select id from question_versions where question_id in (${ids})) returning 1`;
  /* 문항이 현재 판을 가리키고 있으면 판을 못 지운다 — 먼저 끊는다 */
  await tx`update questions set current_version_id = null where id in (${ids})`;
  const versions = await tx`
    delete from question_versions where question_id in (${ids}) returning 1`;
  const questions = await tx`delete from questions where id in (${ids}) returning 1`;
  return {
    정렬: alignments.length,
    수식: expressions.length,
    판: versions.length,
    문항: questions.length,
  };
});

console.log("지움:", counts);
const [after] = await sql<{ n: number }[]>`
  select count(*)::int as n from questions where source_ref is not null`;
console.log(`남은 반입 문항 ${after!.n}개`);
await sql.end();
