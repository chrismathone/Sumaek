import { config } from "dotenv";
config({ path: ["../../.env"] });
import { createSql } from "./src/client";

const sql = createSql();
const ORG = "00000000-0000-7000-8000-000000000001";
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const show = async (l: string, f: () => Promise<unknown>) => {
  try { console.log(l, JSON.stringify(await f())); } catch (e) { console.log(l, "ERR", (e as Error).message); }
};

await show("POLICY", async () => await sql`
  select name, constraints from assessment_policies where organization_id=${ORG}`);
await show("TODAY_SESSION_NODES", async () => await sql`
  select session_date::text as d, planned_node_ids from sessions
  where organization_id=${ORG} and session_date=${TODAY}::date`);
await show("USABLE_QUESTION_POOL", async () => await sql`
  select count(*)::int c from questions q
  join content_rights cr on cr.id = q.content_right_id
  where q.organization_id=${ORG} and q.review_status='published'
    and q.is_auto_assignable = true and cr.status='usable'`);
await show("QUESTION_LAST_USED", async () => await sql`
  select q.id::text, max(a.scheduled_date)::text as last_used
  from questions q
  left join assessment_questions aq on aq.question_id = q.id
  left join assessment_instances a on a.id = aq.assessment_id
  where q.organization_id=${ORG} and q.review_status='published'
    and q.is_auto_assignable = true
  group by q.id order by last_used desc nulls last limit 8`);
await sql.end();
