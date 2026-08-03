/**
 * 정제 — 추출본(지면 사본)을 수맥의 표현·구조로 다시 쓴다.
 *
 *   pnpm --filter @su-maek/ingest refine-concepts \
 *     --org=<uuid> --actor=<uuid> \
 *     [--material=<id>] [--model=claude-opus-5] [--input=<초안.json>] \
 *     [--dry-run] [--force] [--verbose]
 *
 * AI는 초안만 쓴다 (refine.ts의 프롬프트). 게이트 셋이 초안을 거른다:
 * 계약 parse·KaTeX 렌더(실패는 모델에 되돌려 재시도)·보존/표절 검사.
 * 유출(워터마크·교재명)은 차단 — 그 초안은 저장하지 않는다.
 * 성공하면 새 draft 행 + 원본은 archived. 게시는 사람이 한다.
 *
 * 초안이 오는 길은 둘이고 **게이트는 같다**:
 *  - 기본: Anthropic API 호출 (ANTHROPIC_API_KEY, 별도 과금)
 *  - --input: 미리 쓴 초안 JSON — Claude Code 세션(요금제)에서 사람이/AI가
 *    쓴 것을 검증·적재만 한다. API 키 불필요.
 *    형식: [{ "sourceMaterialId": "<추출본 id>", "title": "…", "blocks": […] }]
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  REFINE_DISCLOSURE,
  REFINE_PROMPT_VERSION,
  bodyToMixedText,
  buildRefineSystemPrompt,
  buildRefineUserPrompt,
  checkRefined,
  normalizeRefinedBlocks,
  refineOutput,
  type RefineOutput,
} from "../refine";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const organizationId = arg("org");
const actorUserId = arg("actor");
const materialFilter = arg("material");
const inputPath = arg("input");
const model = arg("model") ?? (inputPath ? "claude-code-session" : "claude-opus-5");
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const verbose = args.includes("--verbose");

if (!organizationId || (!dryRun && !actorUserId)) {
  console.error(
    "사용법: refine-concepts --org=<uuid> --actor=<uuid> [--material=<id>] [--model=…] [--input=<초안.json>] [--dry-run] [--force] [--verbose]",
  );
  process.exit(1);
}
if (!inputPath && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY가 없습니다 (.env). API 없이 돌리려면 --input=<초안.json>을 쓰세요.",
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 4 });

interface SourceRow {
  id: string;
  title: string;
  body: unknown;
  concept_id: string;
  concept_name: string;
  sort_order: number;
  status: string;
  source_ref: {
    publisher?: string;
    book?: string;
    edition?: string;
    subsection?: string;
    teacherNotes?: string[];
  } | null;
  has_live_child: boolean;
}

/* 대상: 추출본(= source_ref.extractedBy가 있는 reading). 정제본에는
 * extractedBy가 없으므로 정제본을 다시 정제하는 일은 생기지 않는다. */
const rows = await sql<SourceRow[]>`
  select m.id::text as id, m.title, m.body, m.concept_id::text as concept_id,
         c.name as concept_name, m.sort_order, m.status::text as status,
         m.source_ref,
         exists(
           select 1 from learning_materials ch
           where ch.derived_from_material_id = m.id
             and ch.organization_id = m.organization_id
             and ch.status <> 'archived'
         ) as has_live_child
  from learning_materials m
  join canonical_concepts c on c.id = m.concept_id
  where m.organization_id = ${organizationId!} and m.kind = 'reading'
    and m.source_ref ? 'extractedBy'
  order by m.sort_order, m.created_at
`;

const targets = rows.filter((r) => {
  if (materialFilter && r.id !== materialFilter) return false;
  /* 게시 중인 추출본은 건드리지 않는다 — archived로 강등하면 학생 화면에서
   * 조용히 사라지고 진도가 고아가 된다. (게시 자체가 이미 사고다: 추출본
   * 게시는 웹 액션이 막지만, 이 CLI는 그 사고를 키우지 않는다.) */
  if (r.status === "published") return false;
  if (r.has_live_child && !force) return false;
  return true;
});
const inScope = rows.filter((r) => !materialFilter || r.id === materialFilter);
const skippedLive = inScope.filter(
  (r) => r.status !== "published" && r.has_live_child && !force,
).length;
const skippedPublished = inScope.filter((r) => r.status === "published").length;

console.log(
  `추출본 ${rows.length}건 중 대상 ${targets.length}건` +
    (skippedLive > 0 ? ` (살아 있는 정제본이 있어 건너뜀 ${skippedLive} — --force로 강제)` : "") +
    (skippedPublished > 0
      ? ` (게시 중이라 건너뜀 ${skippedPublished} — 게시 취소 후 정제하세요)`
      : "") +
    ` · 모델 ${model} · ${REFINE_PROMPT_VERSION}${dryRun ? " · dry-run" : ""}`,
);

/* --input 초안 — 추출본 id로 잇는다. 게이트는 API 경로와 같다. */
const offlineDrafts = new Map<string, unknown>();
if (inputPath) {
  const raw = JSON.parse(readFileSync(inputPath, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    console.error("--input은 초안 배열 JSON이어야 합니다.");
    process.exit(1);
  }
  for (const d of raw as { sourceMaterialId?: unknown }[]) {
    if (typeof d.sourceMaterialId !== "string") {
      console.error("--input 초안에 sourceMaterialId(추출본 id)가 없습니다.");
      process.exit(1);
    }
    offlineDrafts.set(d.sourceMaterialId, d);
  }
}

const anthropic = inputPath ? null : new Anthropic();
/* 도구 스키마 = 파서 스키마. 딴 스키마를 주면 모델은 스키마상 합법인데
 * 파서가 거부하는 것(131자 제목, 빈 blocks)을 만들 수 있다. io:"input" —
 * default 필드를 모델이 생략할 수 있게 (생략하면 파서가 채운다). */
const toolSchema = z.toJSONSchema(refineOutput, {
  io: "input",
}) as Anthropic.Tool.InputSchema;
const system = buildRefineSystemPrompt();

/** 재시도 한도 — 계약 위반·렌더 실패를 모델에 되돌리는 횟수의 총합 */
const MAX_ATTEMPTS = 3;

async function refineOne(row: SourceRow): Promise<
  | { ok: true; refined: RefineOutput; warnings: { kind: string; detail: string }[] }
  | { ok: false; reason: string }
> {
  const ref = row.source_ref ?? {};
  const leakNames = [...new Set([ref.publisher, ref.book, ref.edition].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  ))];
  /* 소단원 제목(「소인수분해」 등)은 일부러 안 넣는다 — 교재 식별이 아니라
   * 수학 용어라, 넣으면 모든 정상 본문이 차단된다. */

  /* ── 오프라인 경로: 초안은 이미 있고, 여기서는 게이트만 돈다.
   *    재시도가 없다 — 실패는 초안을 고쳐 다시 돌리라는 뜻이다. */
  if (inputPath) {
    const draft = offlineDrafts.get(row.id);
    if (!draft) return { ok: false, reason: "--input에 이 추출본의 초안이 없음" };
    const parsed = refineOutput.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        reason: `계약 위반: ${issue?.path.join(".")}: ${issue?.message}`,
      };
    }
    const check = checkRefined({
      sourceBody: row.body,
      refined: parsed.data,
      leakNames,
      teacherNotes: ref.teacherNotes ?? [],
    });
    if (check.renderFailures.length > 0)
      return {
        ok: false,
        reason: `렌더 안 되는 수식 ${check.renderFailures.length}개: ${check.renderFailures.slice(0, 3).join(" · ")}`,
      };
    if (check.blockers.length > 0)
      return { ok: false, reason: `유출 차단: ${check.blockers.join(" · ")}` };
    return { ok: true, refined: parsed.data, warnings: check.warnings };
  }

  const userPrompt = buildRefineUserPrompt({
    conceptName: row.concept_name,
    sourceTitle: row.title,
    sourceText: bodyToMixedText(row.body),
    subsection: ref.subsection ?? null,
    teacherNotes: ref.teacherNotes ?? [],
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await anthropic!.messages.create({
      model,
      max_tokens: 8000,
      system,
      messages,
      tools: [
        {
          name: "submit_reading",
          description: "정제된 개념 설명(제목 + readingContent 블록)을 제출한다",
          input_schema: toolSchema,
        },
      ],
      tool_choice: { type: "tool", name: "submit_reading" },
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) return { ok: false, reason: "모델이 도구를 부르지 않음" };

    /** 실패를 모델에 되돌리는 공통 경로 — tool_result로 잇는다 */
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

    const parsed = refineOutput.safeParse(toolUse.input);
    if (!parsed.success) {
      if (attempt === MAX_ATTEMPTS)
        return { ok: false, reason: `계약 위반: ${parsed.error.issues[0]?.message}` };
      retryWith(
        `블록 계약 위반:\n${parsed.error.issues
          .slice(0, 5)
          .map((i) => `- ${i.path.join(".")}: ${i.message}`)
          .join("\n")}`,
      );
      continue;
    }

    const check = checkRefined({
      sourceBody: row.body,
      refined: parsed.data,
      leakNames,
      teacherNotes: ref.teacherNotes ?? [],
    });
    if (check.renderFailures.length > 0) {
      if (attempt === MAX_ATTEMPTS)
        return {
          ok: false,
          reason: `렌더 안 되는 수식 ${check.renderFailures.length}개: ${check.renderFailures.slice(0, 3).join(" · ")}`,
        };
      retryWith(
        `KaTeX로 렌더되지 않는 수식이 있다. 허용된 명령만 써서 고쳐라:\n${check.renderFailures
          .slice(0, 5)
          .map((f) => `- ${f}`)
          .join("\n")}`,
      );
      continue;
    }
    if (check.blockers.length > 0) {
      /* 유출은 재시도하지 않는다 — 프롬프트가 이미 금지했는데도 나온 것.
       * 이 초안은 버린다. */
      return { ok: false, reason: `유출 차단: ${check.blockers.join(" · ")}` };
    }
    return { ok: true, refined: parsed.data, warnings: check.warnings };
  }
  return { ok: false, reason: "재시도 소진" };
}

const now = new Date();
const stamp =
  now.toISOString().slice(0, 16).replace(/[-:T]/g, "").slice(0, 12);
const jobId = `refine-${stamp}-${uuidv7().slice(-6)}`;

let inserted = 0;
let failed = 0;
for (const row of targets) {
  const label = `${row.concept_name} · «${row.title}»`;
  const result = await refineOne(row);
  if (!result.ok) {
    failed += 1;
    console.log(`  ✗ ${label} — ${result.reason}`);
    continue;
  }
  const { refined, warnings } = result;
  console.log(
    `  ✓ ${label} → «${refined.title}» — 블록 ${refined.blocks.length}` +
      (warnings.length > 0 ? ` · 경고 ${warnings.length}` : ""),
  );
  if (verbose) {
    for (const w of warnings) console.log(`      [${w.kind}] ${w.detail}`);
    for (const b of refined.blocks)
      console.log(`      · ${(b as { type: string }).type}`);
  }
  if (dryRun) continue;

  const refineReport = {
    model,
    promptVersion: REFINE_PROMPT_VERSION,
    refinedAt: new Date().toISOString(),
    warnings,
  };
  /* 게이트가 검사한 형태(정규화 latex)를 저장한다 — 저장본과 검사본이
   * 다르면 게이트는 화면을 보증하지 못한다. */
  const storedBlocks = normalizeRefinedBlocks(refined.blocks);
  const newId = uuidv7();
  const committed = await sql.begin(async (tx) => {
    /* 멱등 재확인 — 잡 시작 시의 has_live_child는 AI 왕복 몇 분 뒤에는
     * 낡았을 수 있다(두 터미널 동시 실행). 트랜잭션 안에서 다시 본다. */
    if (!force) {
      const [live] = await tx<{ id: string }[]>`
        select id::text from learning_materials
        where derived_from_material_id = ${row.id}
          and organization_id = ${organizationId!}
          and status <> 'archived'
        limit 1
      `;
      if (live) return false;
    }
    await tx`
      insert into learning_materials (
        id, organization_id, concept_id, kind, title, body, sort_order,
        status, disclosure, source_job_id, created_by,
        derived_from_material_id, source_ref
      ) values (
        ${newId}, ${organizationId!}, ${row.concept_id}, 'reading',
        ${refined.title}, ${tx.json(storedBlocks as never)}, ${row.sort_order},
        'draft', ${REFINE_DISCLOSURE}, ${jobId}, ${actorUserId!},
        ${row.id}, ${tx.json({ refinedFrom: row.id, refineReport } as never)}
      )
    `;
    /* 원본은 보관 — 게시 대상이 아니었고, 나란히 보기가 계속 읽는다 */
    if (row.status !== "archived") {
      await tx`
        update learning_materials set status = 'archived', updated_at = now()
        where id = ${row.id} and organization_id = ${organizationId!}
      `;
    }
    /* 웹 액션과 같은 감사 흔적 — 「이 draft 어디서 왔나」「원본 왜
     * 보관됐나」를 되짚을 수 있어야 한다. */
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type,
        target_id, reason, after
      ) values (
        ${uuidv7()}, ${organizationId!}, 'user', ${actorUserId!},
        'material.refine', 'learning_material', ${newId},
        ${`${row.concept_name} — ${refined.title}`},
        ${tx.json({ refinedFrom: row.id, jobId, model } as never)}
      )
    `;
    return true;
  });
  if (!committed) {
    failed += 1;
    console.log(`    ↳ 건너뜀 — 사이에 다른 실행이 정제본을 만들었습니다.`);
    continue;
  }
  inserted += 1;
}

console.log(`\n${"═".repeat(64)}`);
console.log(
  `  정제 ${inserted}건 · 실패 ${failed}건 · 잡 ${jobId}${dryRun ? " (dry-run — DB에 쓰지 않음)" : ""}`,
);
console.log("═".repeat(64));
if (inserted > 0) {
  console.log(
    "\n정제본은 전부 draft입니다. /app/content/materials에서 원본과 나란히 검수한 뒤 게시하세요.",
  );
}
await sql.end();
