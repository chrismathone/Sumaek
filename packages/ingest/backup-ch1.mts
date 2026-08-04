import { config } from "dotenv";
config({ path: [".env", "../../.env"] });
import { writeFileSync } from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 2 });

const [blockers] = await sql`
  select count(*)::int as n from assessment_questions aq
  join questions q on q.id = aq.question_id
  where q.source_ref is not null`;
console.log("평가에 쓰인 반입 문항:", blockers!.n);

const rows = await sql`
  select q.source_ref->>'printedNumber' as printed_number,
         q.review_status, q.is_auto_assignable, q.quarantine_reason,
         (select jsonb_agg(jsonb_build_object('slug', c.slug, 'weight', a.weight) order by c.slug)
            from question_alignments a join canonical_concepts c on c.id = a.concept_id
           where a.question_id = q.id) as alignments,
         (select jsonb_agg(jsonb_build_object('n', v.version_number, 'difficulty', v.difficulty,
                                              'answer', v.answer) order by v.version_number)
            from question_versions v where v.question_id = q.id) as versions
  from questions q where q.source_ref is not null
  order by 1`;
writeFileSync(process.argv[2]!, JSON.stringify(rows, null, 1), "utf8");
console.log(`백업 ${rows.length}행 → ${process.argv[2]}`);
const t = new Map<string, number>();
for (const r of rows) t.set(String(r.review_status), (t.get(String(r.review_status)) ?? 0) + 1);
console.log("검수 상태:", Object.fromEntries(t));
console.log("자동 출제 가능:", rows.filter((r) => r.is_auto_assignable).length);
await sql.end();
