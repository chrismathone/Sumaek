/**
 * 정렬 제안 — 미정렬 문항에 canonical 개념 후보를 AI가 제안한다.
 *
 *   pnpm --filter @su-maek/ingest suggest-alignments \
 *     --org=<uuid> --actor=<uuid> \
 *     (--report | --question=<id> | --limit=N | --all) \
 *     [--band=<grade_band>] [--model=claude-sonnet-5] [--input=<초안.json>] \
 *     [--dry-run] [--force] [--verbose]
 *
 * 사람 매핑 표(rpm-2022-concepts.ts)에 없는 문항은 개념 없이 들어간다 —
 * 그 원칙은 그대로다. 이 CLI는 그 문항들에 **제안**을 붙인다:
 * provenance='ai_suggested' + confidence. 숙련도·출제·학생 화면은 이 행을
 * 읽지 않는다. review-alignments(사람)가 승인해야 'human'이 된다.
 *
 * 멱등: 정렬 행이 하나라도 있는 문항은 건너뛴다. --force는 **미검수
 * ai_suggested만** 지우고 다시 제안한다 — human 행이나 검수 흔적이 있는
 * 문항은 force로도 건드리지 않는다. abstain(맞는 후보 없음)은 행을 남기지
 * 않으므로, 개념이 새로 정의되면 다음 실행에서 자연히 재시도된다.
 *
 * 초안이 오는 길은 둘이고 게이트는 같다 (refine과 같은 규약):
 *  - 기본: Anthropic API 호출 (ANTHROPIC_API_KEY, 별도 과금)
 *  - --input: 미리 쓴 초안 JSON — Claude Code 세션(요금제)에서 쓴 것을
 *    검증·적재만 한다. 형식:
 *    [{ "questionId": "<uuid>", "decision": "align"|"abstain",
 *       "alignments": [{ "slug", "weight", "confidence", "rationale" }] }]
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import postgres from "postgres";
import { contentOrganizationIds } from "@su-maek/core/shared";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  ALIGN_PROMPT_VERSION,
  alignOutput,
  buildAlignSystemPrompt,
  buildAlignUserPrompt,
  checkAlignment,
  questionBodyToMixedText,
  toNumeric3,
  type AlignOutput,
  type ConceptCandidate,
} from "../align";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const organizationId = arg("org");
const actorUserId = arg("actor");
const questionFilter = arg("question");
const limitArg = arg("limit");
const bandFilter = arg("band");
const inputPath = arg("input");
const reportOnly = args.includes("--report");
const allFlag = args.includes("--all");
const model = arg("model") ?? (inputPath ? "claude-code-session" : "claude-sonnet-5");
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const verbose = args.includes("--verbose");

const scoped = reportOnly || allFlag || questionFilter !== undefined ||
  limitArg !== undefined || inputPath !== undefined;
if (!organizationId || (!dryRun && !reportOnly && !actorUserId) || !scoped) {
  console.error(
    "사용법: suggest-alignments --org=<uuid> --actor=<uuid> " +
      "(--report | --question=<id> | --limit=N | --all) " +
      "[--band=<grade_band>] [--model=…] [--input=<초안.json>] [--dry-run] [--force] [--verbose]",
  );
  if (!scoped)
    console.error(
      "범위를 명시하세요 — 351건에 무심코 API를 돌리지 않도록 기본값이 없습니다.",
    );
  process.exit(1);
}
if (!inputPath && !reportOnly && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY가 없습니다 (.env). API 없이 돌리려면 --input=<초안.json> 또는 --report를 쓰세요.",
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}
/* 콘텐츠는 플랫폼 소유다 (ADR-0020) — 조직 id로 문항을 찾으면 이전 뒤에
 * 조용히 0건이 된다. 정렬 행은 **그 문항이 사는 곳에** 쓴다(row.organization_id);
 * 감사 이벤트는 그대로 이 조직이다 — 제안한 것은 우리 자동화다. */
const CONTENT_ORGS = contentOrganizationIds(organizationId!);

const sql = postgres(url, { ssl: "require", max: 4 });

interface QuestionRow {
  id: string;
  printed_number: string | null;
  kind: string;
  source_ref: {
    chapter?: { number?: string; title?: string } | null;
    unit?: { number?: string; title?: string } | null;
    section?: string | null;
    type?: { number?: string; title?: string } | null;
  } | null;
  body: unknown;
  grade_band: string | null;
  /** 이 문항이 실제로 사는 조직 — 정렬 행도 **같은 곳에** 써야 한다 */
  organization_id: string;
  has_any: boolean;
  has_settled: boolean;
}

/* ── ① 미정렬 탐지 — 정렬 행이 하나도 없는 문항이 대상이다.
 * has_settled: human 행 또는 검수 흔적(reviewed_by)이 있는 행 —
 * --force로도 건드리지 않는 선. */
const rows = await sql<QuestionRow[]>`
  select q.id::text as id, q.printed_number, q.kind::text as kind,
         q.source_ref, v.body, b.grade_band,
         q.organization_id::text as organization_id,
         exists(
           select 1 from question_alignments a where a.question_id = q.id
         ) as has_any,
         exists(
           select 1 from question_alignments a
           where a.question_id = q.id
             and not (a.provenance = 'ai_suggested' and a.reviewed_by is null)
         ) as has_settled
  from questions q
  join question_versions v on v.id = q.current_version_id
  left join book_editions be on be.id = q.book_edition_id
  left join books b on b.id = be.book_id
  where q.organization_id = any(${CONTENT_ORGS}::uuid[])
  order by q.created_at, q.printed_number
`;

const unaligned = rows.filter((r) => !r.has_any);
const pending = rows.filter((r) => r.has_any && !r.has_settled);

let targets = rows.filter((r) => (force ? !r.has_settled : !r.has_any));
if (questionFilter) targets = targets.filter((r) => r.id === questionFilter);
if (limitArg) targets = targets.slice(0, Number(limitArg));

const typeOf = (r: QuestionRow): string =>
  r.source_ref?.type?.title ?? r.source_ref?.section ??
  (r.source_ref?.unit?.title ? `(중단원) ${r.source_ref.unit.title}` : "(머리글 없음)");

console.log(
  `문항 ${rows.length}건 — 미정렬 ${unaligned.length} · 제안 대기 ${pending.length} · ` +
    `정렬 완료 ${rows.length - unaligned.length - pending.length}`,
);

/* ── --report: 탐지만 — API도 쓰기도 없다 ─────────────────────── */
if (reportOnly) {
  const byHead = new Map<string, number>();
  for (const r of unaligned)
    byHead.set(typeOf(r), (byHead.get(typeOf(r)) ?? 0) + 1);
  console.log(`\n미정렬 ${unaligned.length}건의 머리글 분포:`);
  for (const [head, count] of [...byHead].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(count).padStart(4)}  ${head}`);
  if (verbose) {
    console.log("");
    for (const r of unaligned)
      console.log(`  ${r.id} · #${r.printed_number ?? "?"} · ${typeOf(r)}`);
  }
  await sql.end();
  process.exit(0);
}

/* ── 후보 개념 — 대상 문항 교재의 학년 대역만 기본으로 준다.
 * 다른 대역까지 다 주면 목록이 계통 전체로 부풀고, 모델은 초등·고등
 * 개념에 잘못 붙일 자유만 얻는다. --band로 넓히거나 좁힐 수 있다. */
const bands = bandFilter
  ? [bandFilter]
  : [...new Set(targets.map((t) => t.grade_band).filter((b): b is string => b !== null))];
const candidates = await sql<ConceptCandidate[]>`
  select slug, name, description, grade_band as "gradeBand", domain_name as "domainName"
  from canonical_concepts
  where status <> 'deprecated'
    -- 빈 배열은 [null]로 — postgres.js가 빈 JS 배열의 원소 타입을 모른다
    and (${bands.length === 0} or grade_band = any(${bands.length > 0 ? bands : [null]}::text[]))
  order by slug
`;

console.log(
  `대상 ${targets.length}건 · 후보 개념 ${candidates.length}개 (대역 ${bands.join(", ") || "전체"})` +
    ` · 모델 ${model} · ${ALIGN_PROMPT_VERSION}${dryRun ? " · dry-run" : ""}${force ? " · force" : ""}`,
);
if (candidates.length === 0) {
  console.error(
    "후보 개념이 없습니다 — 이 대역의 canonical_concepts부터 정의하세요. 제안은 후보 밖을 만들지 않습니다.",
  );
  await sql.end();
  process.exit(1);
}

/* ── --input 초안 — questionId로 잇는다. 게이트는 API 경로와 같다. */
const offlineDrafts = new Map<string, unknown>();
if (inputPath) {
  const raw = JSON.parse(readFileSync(inputPath, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    console.error("--input은 초안 배열 JSON이어야 합니다.");
    process.exit(1);
  }
  for (const d of raw as { questionId?: unknown }[]) {
    if (typeof d.questionId !== "string") {
      console.error("--input 초안에 questionId(문항 id)가 없습니다.");
      process.exit(1);
    }
    offlineDrafts.set(d.questionId, d);
  }
  /* 초안이 있는 문항만 대상으로 좁힌다 — 나머지는 이 실행의 일이 아니다 */
  targets = targets.filter((t) => offlineDrafts.has(t.id));
  console.log(`--input 초안 ${offlineDrafts.size}건 → 대상 ${targets.length}건으로 좁힘`);
}

const anthropic = inputPath ? null : new Anthropic();
/* 도구 스키마 = 파서 스키마 (refine과 같은 규약). io:"input" — optional
 * 필드를 모델이 생략할 수 있게. */
const toolSchema = z.toJSONSchema(alignOutput, {
  io: "input",
}) as Anthropic.Tool.InputSchema;
const system = buildAlignSystemPrompt();

const MAX_ATTEMPTS = 3;

async function suggestOne(row: QuestionRow): Promise<
  | { ok: true; output: AlignOutput }
  | { ok: false; reason: string }
> {
  const ref = row.source_ref ?? {};
  const promptInput = {
    chapter: ref.chapter?.title
      ? `${ref.chapter.number ?? ""} ${ref.chapter.title}`.trim()
      : null,
    unit: ref.unit?.title ?? null,
    section: ref.section ?? null,
    typeTitle: ref.type?.title ?? null,
    kind: row.kind,
    bodyText: questionBodyToMixedText(row.body),
    candidates,
  };
  if (promptInput.bodyText.trim() === "")
    return { ok: false, reason: "본문이 비어 있다 — 평문화 실패" };

  /* ── 오프라인 경로: 초안은 이미 있고, 게이트만 돈다. 재시도 없음 —
   * 실패는 초안을 고쳐 다시 돌리라는 뜻이다. */
  if (inputPath) {
    const parsed = alignOutput.safeParse(offlineDrafts.get(row.id));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { ok: false, reason: `계약 위반: ${issue?.path.join(".")}: ${issue?.message}` };
    }
    const problems = checkAlignment(parsed.data, candidates);
    if (problems.length > 0)
      return { ok: false, reason: `게이트 거부: ${problems.join(" · ")}` };
    return { ok: true, output: parsed.data };
  }

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildAlignUserPrompt(promptInput) },
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await anthropic!.messages.create({
      model,
      max_tokens: 2000,
      system,
      messages,
      tools: [
        {
          name: "submit_alignment",
          description: "문항-개념 정렬 제안(또는 abstain)을 제출한다",
          input_schema: toolSchema,
        },
      ],
      tool_choice: { type: "tool", name: "submit_alignment" },
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) return { ok: false, reason: "모델이 도구를 부르지 않음" };

    const retryWith = (problem: string): void => {
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `제출이 거부되었다. 고쳐서 다시 제출하라:\n${problem}`,
            is_error: true,
          },
        ],
      });
    };

    const parsed = alignOutput.safeParse(toolUse.input);
    if (!parsed.success) {
      if (attempt === MAX_ATTEMPTS)
        return { ok: false, reason: `계약 위반: ${parsed.error.issues[0]?.message}` };
      retryWith(
        `계약 위반:\n${parsed.error.issues
          .slice(0, 5)
          .map((i) => `- ${i.path.join(".")}: ${i.message}`)
          .join("\n")}`,
      );
      continue;
    }

    const problems = checkAlignment(parsed.data, candidates);
    if (problems.length > 0) {
      if (attempt === MAX_ATTEMPTS)
        return { ok: false, reason: `게이트 거부: ${problems.join(" · ")}` };
      retryWith(problems.map((p) => `- ${p}`).join("\n"));
      continue;
    }
    return { ok: true, output: parsed.data };
  }
  return { ok: false, reason: "재시도 소진" };
}

const conceptIdBySlug = new Map<string, string>();
{
  const ids = await sql<{ id: string; slug: string }[]>`
    select id::text as id, slug from canonical_concepts
    where slug = any(${candidates.map((c) => c.slug)})
  `;
  for (const c of ids) conceptIdBySlug.set(c.slug, c.id);
}

const now = new Date();
const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "").slice(0, 12);
const jobId = `align-${stamp}-${uuidv7().slice(-6)}`;

let suggested = 0;
let abstained = 0;
let failed = 0;
for (const row of targets) {
  const label = `#${row.printed_number ?? row.id.slice(-8)} · ${typeOf(row)}`;
  const result = await suggestOne(row);
  if (!result.ok) {
    failed += 1;
    console.log(`  ✗ ${label} — ${result.reason}`);
    continue;
  }
  const { output } = result;
  if (output.decision === "abstain") {
    abstained += 1;
    console.log(`  – ${label} — abstain: ${output.abstainReason ?? "(사유 없음)"}`);
    continue;
  }
  console.log(
    `  ✓ ${label} → ` +
      output.alignments
        .map((a) => `${a.slug} w=${a.weight} c=${a.confidence}`)
        .join(" · "),
  );
  if (verbose)
    for (const a of output.alignments) console.log(`      [${a.slug}] ${a.rationale}`);
  if (dryRun) {
    suggested += 1;
    continue;
  }

  const committed = await sql.begin(async (tx) => {
    /* 멱등 재확인 — 잡 시작 시의 has_any는 API 왕복 뒤에는 낡았을 수
     * 있다(두 터미널 동시 실행). 문항 행을 잠가 동시 제안을 직렬화한 뒤
     * 트랜잭션 안에서 다시 본다 — 정렬 행이 0개일 때는 잠글 행이 없어
     * for update가 경합을 못 막는다. */
    await tx`
      select id from questions
      where id = ${row.id} and organization_id = ${row.organization_id}
      for update
    `;
    const existing = await tx<{ provenance: string; reviewed_by: string | null }[]>`
      select provenance, reviewed_by from question_alignments
      where question_id = ${row.id} and organization_id = ${row.organization_id}
    `;
    const settled = existing.some(
      (e) => !(e.provenance === "ai_suggested" && e.reviewed_by === null),
    );
    if (settled) return false;
    if (existing.length > 0) {
      if (!force) return false;
      /* --force: 미검수 제안만 갈아 끼운다 */
      await tx`
        delete from question_alignments
        where question_id = ${row.id} and organization_id = ${row.organization_id}
          and provenance = 'ai_suggested' and reviewed_by is null
      `;
    }
    for (const a of output.alignments) {
      await tx`
        insert into question_alignments (
          id, organization_id, question_id, concept_id, weight, confidence, provenance
        ) values (
          ${uuidv7()}, ${row.organization_id}, ${row.id},
          ${conceptIdBySlug.get(a.slug)!}, ${toNumeric3(a.weight)},
          ${toNumeric3(a.confidence)},
          /* AI 제안이다 — 승인 전에는 숙련도·출제·학생 화면 어디에도 쓰이지
           * 않고, human으로 위장하지 않는다 */
          'ai_suggested'
        )
      `;
    }
    /* 근거(rationale)는 행이 아니라 감사 이벤트에 남는다 — 검수 CLI가
     * 이 이벤트를 읽어 함께 보여 준다. */
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type,
        target_id, reason, after
      ) values (
        ${uuidv7()}, ${organizationId!}, 'automation', ${actorUserId!},
        'alignment.suggest', 'question', ${row.id},
        ${`${typeOf(row)} — ${output.alignments.map((a) => a.slug).join(", ")}`},
        ${tx.json({ jobId, model, promptVersion: ALIGN_PROMPT_VERSION, alignments: output.alignments } as never)}
      )
    `;
    return true;
  });
  if (!committed) {
    failed += 1;
    console.log(`    ↳ 건너뜀 — 사이에 다른 실행이 이 문항을 정렬했습니다.`);
    continue;
  }
  suggested += 1;
}

console.log(`\n${"═".repeat(64)}`);
console.log(
  `  제안 ${suggested}건 · abstain ${abstained}건 · 실패 ${failed}건 · 잡 ${jobId}` +
    (dryRun ? " (dry-run — DB에 쓰지 않음)" : ""),
);
console.log("═".repeat(64));
if (suggested > 0 && !dryRun) {
  console.log(
    "\n제안은 전부 ai_suggested(미검수)입니다. review-alignments로 검수한 뒤 승인하세요 —",
  );
  console.log("승인 전에는 숙련도·출제·학생 화면 어디에도 쓰이지 않습니다.");
}
if (abstained > 0) {
  console.log(
    `\nabstain ${abstained}건은 행을 남기지 않았습니다 — 해당 단원의 개념을 정의하면 다음 실행에서 다시 제안됩니다.`,
  );
}
await sql.end();
