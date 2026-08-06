/**
 * 정렬 제안 검수 — ai_suggested를 사람이 승인·반려한다.
 *
 *   pnpm --filter @su-maek/ingest review-alignments --org=<uuid> --actor=<uuid>
 *     [--limit=N]                        # 목록 (기본)
 *     [--approve=<qid>[,<qid>…]]         # 그 문항의 미검수 제안 전부 승인
 *     [--reject=<qid>[,<qid>…]]          # 그 문항의 미검수 제안 전부 반려(삭제)
 *     [--only=<slug>[,<slug>…]]          # 문항 하나일 때 일부 slug만 승인/반려
 *
 * 승인 = provenance 'human' + reviewed_by 기록. 그 순간부터 숙련도·출제·
 * 학생 화면에 쓰인다 — 그래서 승인은 이름이 남는 사람의 행위다.
 * 일괄 자동 승인 옵션은 일부러 없다: 보지 않고 승인하는 것은 provenance
 * 위장과 같다.
 *
 * 반려 = 행 삭제 + 감사 이벤트(무엇을 지웠는지 after에 남는다). 문항은
 * 미정렬로 돌아가 다음 suggest 실행의 대상이 된다. 맞는 개념을 아는
 * 경우라면 반려 대신 사람 매핑 표나 문항 화면에서 직접 지정하라.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import postgres from "postgres";
import { contentOrganizationIds } from "@su-maek/core/shared";
import { v7 as uuidv7 } from "uuid";
import { questionBodyToMixedText } from "../align";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const organizationId = arg("org");
const actorUserId = arg("actor");
const approveArg = arg("approve");
const rejectArg = arg("reject");
const onlyArg = arg("only");
const limitArg = arg("limit");

const mutating = approveArg !== undefined || rejectArg !== undefined;
if (!organizationId || (mutating && !actorUserId)) {
  console.error(
    "사용법: review-alignments --org=<uuid> --actor=<uuid> [--limit=N] " +
      "[--approve=<qid,…>] [--reject=<qid,…>] [--only=<slug,…>]",
  );
  process.exit(1);
}
if (approveArg !== undefined && rejectArg !== undefined) {
  console.error("--approve와 --reject는 한 번에 하나만 — 판단이 섞이면 감사 흔적도 섞인다.");
  process.exit(1);
}
const idList = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
const onlySlugs = idList(onlyArg);
if (onlySlugs.length > 0 && idList(approveArg ?? rejectArg).length !== 1) {
  console.error("--only는 문항 하나를 지정했을 때만 — 여러 문항에 같은 slug 필터는 사고다.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}
/* 콘텐츠는 플랫폼 소유다 (ADR-0020) — 정렬 행을 조직 id로 찾으면 이전 뒤에
 * 조용히 0건이 된다(「검수할 제안이 없습니다」로 보인다). 갱신·삭제도 같은
 * 범위로 한다: 화면에 보여 준 그 행을 그대로 다뤄야 한다.
 * 감사 이벤트 조회는 그대로 이 조직이다 — 제안을 남긴 것이 이 조직이므로. */
const CONTENT_ORGS = contentOrganizationIds(organizationId!);

const sql = postgres(url, { ssl: "require", max: 4 });

interface PendingRow {
  question_id: string;
  printed_number: string | null;
  body: unknown;
  source_ref: {
    unit?: { title?: string } | null;
    section?: string | null;
    type?: { title?: string } | null;
  } | null;
  slug: string;
  name: string;
  weight: string;
  confidence: string | null;
}

const pending = await sql<PendingRow[]>`
  select qa.question_id::text as question_id, q.printed_number, v.body,
         q.source_ref, c.slug, c.name,
         qa.weight::text as weight, qa.confidence::text as confidence
  from question_alignments qa
  join questions q on q.id = qa.question_id
  join question_versions v on v.id = q.current_version_id
  join canonical_concepts c on c.id = qa.concept_id
  where qa.organization_id = any(${CONTENT_ORGS}::uuid[])
    and qa.provenance = 'ai_suggested' and qa.reviewed_by is null
  order by q.created_at, q.printed_number, qa.weight desc
`;

const byQuestion = new Map<string, PendingRow[]>();
for (const row of pending) {
  const list = byQuestion.get(row.question_id) ?? [];
  list.push(row);
  byQuestion.set(row.question_id, list);
}

/* ── 승인·반려 ───────────────────────────────────────────────── */
if (mutating) {
  const action = approveArg !== undefined ? "approve" : "reject";
  const qids = idList(approveArg ?? rejectArg);
  let touched = 0;
  for (const qid of qids) {
    const rows = byQuestion.get(qid);
    if (!rows) {
      console.log(`  ✗ ${qid} — 미검수 제안이 없습니다`);
      continue;
    }
    const scope = onlySlugs.length > 0
      ? rows.filter((r) => onlySlugs.includes(r.slug))
      : rows;
    if (scope.length === 0) {
      console.log(`  ✗ ${qid} — --only에 해당하는 제안이 없습니다`);
      continue;
    }
    const slugs = scope.map((r) => r.slug);
    await sql.begin(async (tx) => {
      if (action === "approve") {
        /* 부분 승인이면 나머지 제안은 pending으로 남는다 — 반려는 별도 판단 */
        const updated = await tx`
          update question_alignments qa
          set provenance = 'human', reviewed_by = ${actorUserId!}, updated_at = now()
          from canonical_concepts c
          where c.id = qa.concept_id
            and qa.question_id = ${qid}
            and qa.organization_id = any(${CONTENT_ORGS}::uuid[])
            and qa.provenance = 'ai_suggested' and qa.reviewed_by is null
            and c.slug = any(${slugs})
        `;
        if (updated.count === 0) return;
      } else {
        await tx`
          delete from question_alignments qa
          using canonical_concepts c
          where c.id = qa.concept_id
            and qa.question_id = ${qid}
            and qa.organization_id = any(${CONTENT_ORGS}::uuid[])
            and qa.provenance = 'ai_suggested' and qa.reviewed_by is null
            and c.slug = any(${slugs})
        `;
      }
      await tx`
        insert into audit_events (
          id, organization_id, actor_type, actor_id, action, target_type,
          target_id, reason, after
        ) values (
          ${uuidv7()}, ${organizationId!}, 'user', ${actorUserId!},
          ${`alignment.${action}`}, 'question', ${qid},
          ${scope.map((r) => `${r.slug} w=${Number(r.weight)}`).join(", ")},
          ${tx.json({ alignments: scope.map((r) => ({ slug: r.slug, weight: r.weight, confidence: r.confidence })) } as never)}
        )
      `;
    });
    touched += 1;
    console.log(
      `  ${action === "approve" ? "✓ 승인" : "− 반려"} #${rows[0]!.printed_number ?? qid.slice(-8)} — ` +
        scope.map((r) => r.slug).join(", "),
    );
  }
  console.log(
    `\n${action === "approve" ? "승인" : "반려"} ${touched}건 / 지정 ${qids.length}건` +
      (action === "approve"
        ? " — 지금부터 숙련도·출제·학생 화면에 쓰입니다."
        : " — 문항은 미정렬로 돌아갔습니다."),
  );
  await sql.end();
  process.exit(0);
}

/* ── 목록 — 근거(rationale)는 suggest가 남긴 감사 이벤트에서 읽는다 */
const qids = [...byQuestion.keys()];
const rationaleBySlug = new Map<string, string>();
if (qids.length > 0) {
  const events = await sql<{ target_id: string; after: unknown }[]>`
    select distinct on (target_id) target_id::text as target_id, after
    from audit_events
    where organization_id = ${organizationId!}
      and action = 'alignment.suggest' and target_id = any(${qids})
    order by target_id, created_at desc
  `;
  for (const e of events) {
    const alignments = (e.after as { alignments?: { slug?: string; rationale?: string }[] })
      ?.alignments;
    if (!Array.isArray(alignments)) continue;
    for (const a of alignments)
      if (a.slug && a.rationale)
        rationaleBySlug.set(`${e.target_id}:${a.slug}`, a.rationale);
  }
}

const limit = limitArg ? Number(limitArg) : 20;
console.log(
  `미검수 제안 ${pending.length}건 · 문항 ${byQuestion.size}건` +
    (byQuestion.size > limit ? ` (아래는 처음 ${limit}건 — --limit로 조절)` : ""),
);
let shown = 0;
for (const [qid, rows] of byQuestion) {
  if (shown >= limit) break;
  shown += 1;
  const head =
    rows[0]!.source_ref?.type?.title ?? rows[0]!.source_ref?.section ??
    rows[0]!.source_ref?.unit?.title ?? "(머리글 없음)";
  const preview = questionBodyToMixedText(rows[0]!.body)
    .replace(/\s+/g, " ")
    .slice(0, 72);
  console.log(`\n#${rows[0]!.printed_number ?? "?"} · ${head}`);
  console.log(`  ${qid}`);
  console.log(`  「${preview}…」`);
  for (const r of rows) {
    const rationale = rationaleBySlug.get(`${qid}:${r.slug}`);
    console.log(
      `    → ${r.slug} (${r.name}) w=${Number(r.weight)}` +
        (r.confidence !== null ? ` 신뢰도 ${Number(r.confidence)}` : "") +
        (rationale ? ` — ${rationale}` : ""),
    );
  }
}
if (byQuestion.size > 0) {
  console.log(
    `\n승인: review-alignments --org=… --actor=… --approve=<문항id>` +
      `\n반려: review-alignments --org=… --actor=… --reject=<문항id>`,
  );
}
await sql.end();
