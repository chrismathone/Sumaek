/** 반입 문항(source_ref is not null)만 지운다 — 시드 문항은 건드리지 않는다.
 *  자식부터 지운다: 외래키가 전부 on delete NO ACTION이다 (handoff 3.1). */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 2 });
const counts = await sql.begin(async (tx) => {
  const a = await tx`delete from question_alignments
    where question_id in (select id from questions where source_ref is not null) returning 1`;
  const m = await tx`delete from math_expressions
    where question_version_id in (
      select qv.id from question_versions qv join questions q on q.id = qv.question_id
      where q.source_ref is not null) returning 1`;
  await tx`update questions set current_version_id = null where source_ref is not null`;
  const v = await tx`delete from question_versions
    where question_id in (select id from questions where source_ref is not null) returning 1`;
  const q = await tx`delete from questions where source_ref is not null returning 1`;
  return { alignments: a.length, expressions: m.length, versions: v.length, questions: q.length };
});
console.log("지움:", counts);
console.log("남은 반입 문항:", (await sql`select count(*)::int as n from questions where source_ref is not null`)[0]!.n);
await sql.end();
