/**
 * 반입 문항 일괄 검수 승인 — `pnpm approve:ingested`
 *
 *   … --dry        무엇이 바뀌는지만 센다 (쓰지 않는다)
 *   … --org=<uuid> 대상 조직 (기본: 데모 조직)
 *   … --rights     사용권까지 usable로 올린다 (기본: 건드리지 않는다)
 *
 * 대상은 **반입본**(`source_ref ? 'extractedBy'`)이다. 손으로 만든 시드
 * 문항은 이미 게시 상태이고, 여기서 다시 건드릴 이유가 없다.
 *
 * 한 건씩 approveQuestion()을 부르지 않는 이유는 왕복이다 — 문항 하나에
 * 질의 다섯이고 5천 건이면 2만 5천 왕복이다. 대신 **그 함수가 하는 일을
 * 그대로** 집합 단위로 한다. 빠뜨리면 안 되는 것이 넷이다:
 *
 *   1. `review_status = 'published'`
 *   2. `is_auto_assignable = (사용권이 usable일 때만)` — 권리 미확정 교재를
 *      자동 출제에 넣지 않는다 (원칙 9·ADR-0014)
 *   3. 열린 검수 건 해소 (`content_reviews`)
 *   4. 감사 로그 + ContentApproved 이벤트
 *
 * **수식 격리(formula_review_required)는 건너뛴다.** approveQuestion이
 * 거부하는 것과 같은 이유다 — 수식이 렌더되지 않은 문항을 게시하면 학생
 * 화면에 깨진 식이 그대로 나간다. 몇 건이 남았는지 보고만 한다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import postgres from "postgres";
import { contentOrganizationIds } from "@su-maek/core/shared";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const WITH_RIGHTS = argv.includes("--rights");
const ORG =
  argv.find((a) => a.startsWith("--org="))?.slice(6) ??
  "00000000-0000-7000-8000-000000000001";

/* 콘텐츠는 플랫폼 소유다 (ADR-0020). 조직 id로 찾으면 이전이 끝나는 순간
 * **조용히 0건**이 된다 — 「승인할 것이 없습니다」로 보이지 그 이유는 안 보인다.
 * 감사·이벤트는 그대로 ORG다: 승인한 것은 사람이고 그 사람은 학원에 속한다. */
const CONTENT_ORGS = contentOrganizationIds(ORG);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL이 없습니다.");
const sql = postgres(url.trim(), { max: 2 });

/** 감사·이벤트의 행위자. 사람이 부른 일괄 작업이므로 소유자 계정으로 남긴다. */
const [actor] = await sql<{ id: string }[]>`
  select u.id::text from users u
  join memberships m on m.user_id = u.id and m.organization_id = ${ORG} and m.role = 'owner'
  order by u.created_at limit 1
`;
if (!actor) throw new Error("이 조직의 owner 계정을 찾지 못했습니다.");

/* ── 현황 ─────────────────────────────────────────────────────── */
const before = await sql<
  { review_status: string; right_status: string | null; n: number }[]
>`
  select q.review_status::text, r.status::text as right_status, count(*)::int as n
  from questions q
  left join content_rights r on r.id = q.content_right_id
  where q.organization_id = any(${CONTENT_ORGS}::uuid[]) and q.source_ref ? 'extractedBy'
  group by 1, 2 order by n desc
`;
console.log(`대상 조직: ${CONTENT_ORGS.join(" · ")} (콘텐츠는 플랫폼 포함)`);
console.log("반입본 현황 (검수상태 / 사용권 / 건수)");
console.table(before);

const target = before
  .filter((r) => r.review_status === "review_required" || r.review_status === "layout_review_required")
  .reduce((a, r) => a + r.n, 0);
const quarantined = before
  .filter((r) => r.review_status === "formula_review_required")
  .reduce((a, r) => a + r.n, 0);
const willAssign = before
  .filter(
    (r) =>
      (r.review_status === "review_required" || r.review_status === "layout_review_required") &&
      (WITH_RIGHTS || r.right_status === "usable"),
  )
  .reduce((a, r) => a + r.n, 0);

console.log(`\n승인 대상 ${target}건 · 수식 격리로 건너뜀 ${quarantined}건`);
console.log(`그중 자동 출제 가능해지는 것 ${willAssign}건` + (WITH_RIGHTS ? " (--rights로 사용권도 올림)" : ""));

if (DRY) {
  console.log("\n--dry — 아무것도 쓰지 않았습니다.");
  await sql.end();
  process.exit(0);
}

/* ── 실행 ─────────────────────────────────────────────────────── */
const WHERE = sql`
  q.organization_id = any(${CONTENT_ORGS}::uuid[]) and q.source_ref ? 'extractedBy'
  and q.review_status in ('review_required', 'layout_review_required')
`;

if (WITH_RIGHTS) {
  /* 사용권은 **법적 진술**이다 — 기본으로는 절대 건드리지 않는다.
   * --rights는 「이 교재를 쓸 권리가 확정됐다」고 사람이 말한 것으로 본다. */
  const r = await sql`
    update content_rights set status = 'usable', status_changed_by = ${actor.id},
           status_changed_at = now(), updated_at = now()
    where organization_id = any(${CONTENT_ORGS}::uuid[]) and status = 'under_review'
      and exists (select 1 from questions q where q.content_right_id = content_rights.id
                    and q.source_ref ? 'extractedBy')
  `;
  console.log(`사용권 usable로 올림: ${r.count}행`);
}

const updated = await sql`
  update questions q
  set review_status = 'published',
      is_auto_assignable = (
        select r.status = 'usable' from content_rights r where r.id = q.content_right_id
      ) is true,
      updated_at = now()
  where ${WHERE}
  returning q.id
`;
console.log(`게시: ${updated.count}건`);

const reviews = await sql`
  update content_reviews
  set status = 'resolved', decision = 'approve', reviewer_id = ${actor.id},
      decided_at = now(), notes = '반입 문항 일괄 승인', updated_at = now()
  where organization_id = any(${CONTENT_ORGS}::uuid[]) and subject_type = 'question' and status = 'open'
    and subject_id = any(${updated.map((r) => r.id)}::uuid[])
`;
console.log(`검수 건 해소: ${reviews.count}건`);

/* 감사 로그는 문항마다 남긴다 — 「누가 언제 무엇을 게시했나」가 건별로
 * 답해지지 않으면 나중에 한 문항을 두고 다툴 때 쓸 것이 없다. */
const audit = await sql`
  insert into audit_events (
    id, organization_id, actor_type, actor_id, action, target_type, target_id, reason
  )
  select gen_random_uuid(), ${ORG}, 'user', ${actor.id},
         'content.approve-question', 'question', id,
         '반입 문항 일괄 승인 (approve-ingested)'
  from unnest(${updated.map((r) => r.id)}::uuid[]) as id
`;
console.log(`감사 로그: ${audit.count}건`);

/* ContentApproved의 소비자는 readmodel.refresh 하나이고 그것은 no-op이다
 * (registry.ts). 문항마다 이벤트를 내면 아무 일도 하지 않는 작업이 수천 건
 * 쌓여 큐 적체 경보만 울린다. 그래서 **일괄 작업 1건**으로 낸다 — 사건이
 * 실제로 하나였기 때문이기도 하다. 건별 사실은 위 감사 로그가 갖고 있다. */
await sql`
  insert into outbox_events (
    id, organization_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, occurred_at, payload
  ) values (
    gen_random_uuid(), ${ORG}, 'question', gen_random_uuid(), 1,
    'ContentApproved', now(),
    ${sql.json({ bulk: true, count: updated.count, reviewerId: actor.id } as never)}
  )
`;

const [after] = await sql<{ published: number; assignable: number }[]>`
  select count(*) filter (where review_status = 'published')::int as published,
         count(*) filter (where is_auto_assignable)::int as assignable
  from questions where organization_id = any(${CONTENT_ORGS}::uuid[]) and source_ref ? 'extractedBy'
`;
console.log(`\n반입본 결과 — 게시 ${after!.published}건 · 자동 출제 가능 ${after!.assignable}건`);
if (quarantined > 0) {
  console.log(`수식 격리 ${quarantined}건은 그대로 남았습니다 — 수식 검수 화면에서 풀어야 합니다.`);
}
await sql.end();
