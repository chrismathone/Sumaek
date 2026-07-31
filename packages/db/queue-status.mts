import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { createSql } from "./src/client";

async function main() {
  const sql = createSql();
  const jobs = await sql`
    select topic, status, count(*)::int as c from jobs group by topic, status order by topic
  `;
  for (const j of jobs) console.log(`${j.topic} [${j.status}]: ${j.c}`);
  const [ob] = await sql`
    select count(*)::int as c from outbox_events where status = 'pending'
  `;
  const [inbox] = await sql`select count(*)::int as c from inbox_events`;
  const [noti] = await sql`select count(*)::int as c from notifications`;
  console.log("pending outbox:", ob?.c, "| inbox 처리:", inbox?.c, "| 알림:", noti?.c);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
