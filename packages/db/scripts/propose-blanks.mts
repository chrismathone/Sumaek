import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../src/client";

/* ─────────────────────────────────────────────────────────────
 * 개념 빈칸 제안 — 게시된 읽기 자료에서 인출할 자리를 뽑는다.
 *
 *   pnpm --filter @su-maek/db propose-blanks --unit m1-           # 초안 저장
 *   pnpm --filter @su-maek/db propose-blanks --unit m1- --dry-run # 출력만
 *
 * **초안으로만 저장한다(draft).** 게시는 사람이 검수하고 누른다 — 반입
 * 파이프라인이 문항을 다루는 방식과 같다(원칙: AI 산출물은 검수 전 학생에게
 * 가지 않는다). 이 스크립트는 게시 상태를 만들지 않으며, 이미 있는 묶음은
 * 건드리지 않는다(멱등: 다시 돌려도 사람이 손댄 것을 덮지 않는다).
 *
 * 왜 자동 파생이 아니라 모델에게 맡기는가: 정의 블록의 용어만 기계적으로
 * 뚫으면 데이터는 공짜지만, 뚫린 자리가 「그 강의가 가르치려는 것」이라는
 * 보장이 없다. 적은 수를 정확한 자리에 놓는 것이 빈칸의 전부다.
 *
 * 왜 결과를 그대로 믿지 않는가: 모델은 본문에 없는 말을 정답으로 적을 수
 * 있다. 저장 전에 **정답이 원문에 실제로 있는지** 확인하고, 없으면 그 빈칸을
 * 버린다. 남은 것이 없으면 그 단계는 만들지 않는다.
 * ───────────────────────────────────────────────────────────── */

const API = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";
/* 단계별 빈칸 수. 1단계 1개·2단계 2개로는 인출이 되지 않는다(실측 지적) —
 * 한 칸만 비면 나머지 문장이 답을 거의 다 알려 준다. 3단계는 개수가 아니라
 * **전부**라서 여기에 없다(아래 buildFullStage가 기계적으로 만든다). */
const MAX_BLANKS = { one: 3, two: 6 } as const;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const unitArg = args.find((a) => a.startsWith("--unit="));
const unitPrefix = unitArg ? unitArg.slice("--unit=".length) : "m1-";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("✗ DEEPSEEK_API_KEY가 없습니다 (.env)");
  process.exit(1);
}

interface Run {
  kind?: string;
  text?: string;
  math?: { latex?: string };
}
interface Block {
  type?: string;
  text?: string;
  term?: string;
  content?: Run[];
  items?: unknown;
  title?: string;
  tone?: string;
  label?: string;
}

function runsToText(runs: Run[] | undefined): string {
  if (!Array.isArray(runs)) return "";
  return runs
    .map((r) => (r.kind === "math" ? `$${r.math?.latex ?? ""}$` : (r.text ?? "")))
    .join("");
}

/** 자료 본문 → 모델에게 줄 평문. 블록 종류를 남겨 어디가 정의인지 알린다 */
function bodyToPlain(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return (body as Block[])
    .map((b) => {
      if (b.type === "definition") {
        return `[정의] ${b.term}: ${runsToText(b.content)}`;
      }
      if (b.type === "text") return b.text ?? "";
      if (b.type === "paragraph") return runsToText(b.content);
      if (b.type === "callout") {
        const inner = (Array.isArray(b.content) ? b.content : []) as Block[];
        const lines = inner
          .filter((x) => x.type === "paragraph")
          .map((x) => runsToText(x.content))
          .filter(Boolean);
        return lines.length > 0 ? `[${b.label ?? b.tone ?? "참고"}] ${lines.join(" ")}` : "";
      }
      if (b.type === "key_point" || b.type === "steps") {
        const items = Array.isArray(b.items) ? b.items : [];
        const lines = items
          .map((it) =>
            Array.isArray(it)
              ? runsToText(it as Run[])
              : runsToText((it as { content?: Run[] }).content),
          )
          .filter(Boolean);
        return `[${b.type === "key_point" ? "핵심" : "순서"}${b.title ? ` ${b.title}` : ""}] ${lines.join(" / ")}`;
      }
      return "";
    })
    .filter((s) => s.trim().length > 0)
    .join("\n");
}

const PROMPT = `너는 중학교 수학 개념서를 빈칸 학습으로 바꾸는 편집자다.

주어진 개념 본문에서 학생이 **인출해야 할 핵심어**를 골라 빈칸을 만든다.
규칙:
- 빈칸은 적을수록 좋다. 그 개념을 아는 사람과 모르는 사람을 가르는 말만 뚫는다.
- 조사·접속사·흔한 낱말(것, 수, 때)은 뚫지 않는다.
- 정답은 **본문에 그대로 나온 말**이어야 한다. 새로 지어내지 않는다.
- **숫자·수식은 정답이 될 수 없다.** 「2」·「1」·「$(m+1)(n+1)$」 같은 것은 뚫지 않는다.
- 같은 말을 두 번 뚫지 않는다.
- 수식($...$)은 뚫지 않는다.
- 힌트는 정답을 말하지 않고 방향만 준다 (예: "1과 자기 자신만 약수인 수").

세 단계를 만든다:
- one: 빈칸 3개. 그 개념을 가르는 말들.
- two: 빈칸 5~6개. one의 것을 포함해 뼈대까지.
(3단계는 네가 만들지 않는다 — 프로그램이 전부 비운다.)

**문장을 뚫는 일은 하지 마라.** 너는 어느 말을 뚫을지만 고른다 — 그 말을
본문에서 찾아 자리를 파는 것은 프로그램이 한다. one·two의 답은 본문의 **한
문장 안에** 함께 있는 말들로 고른다(흩어져 있으면 쓸 수 없다).

출력은 JSON만. 설명 금지.
{"one":{"blanks":[{"answer":"...","alternatives":["..."]}]},
 "two":{"blanks":[...]}}

alternatives에는 띄어쓰기 변형처럼 정답으로 받아야 할 표기만 넣는다(없으면 []).`;

interface ProposedBlank {
  position?: number;
  answer?: string;
  hint?: string;
  alternatives?: string[];
}
interface ProposedStage {
  templateText?: string;
  blanks?: ProposedBlank[];
}
type Proposal = Partial<Record<"one" | "two" | "full", ProposedStage>>;

async function propose(conceptName: string, plain: string): Promise<Proposal> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: `개념: ${conceptName}\n\n본문:\n${plain}` },
      ],
      // 같은 자료에 매번 다른 빈칸이 나오면 검수가 대상을 못 따라간다
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content) as Proposal;
}

export interface KeptBlank {
  position: number;
  answer: string;
  hint: string;
  alternatives: string[];
}

/** 왜 버렸는지 — 프롬프트만으로는 막히지 않는 것들을 코드가 막는다 */
function rejectReason(answer: string, plain: string, seen: Set<string>): string | null {
  const flat = plain.replace(/\s+/g, "");
  if (answer.length === 0) return "빈 값";
  // 모델이 지어낸 말 — 원문에 없으면 인출 대상이 아니다
  if (!flat.includes(answer.replace(/\s+/g, ""))) return "원문에 없음";
  // 숫자만 있는 답은 인출이 아니라 눈치다 (「1」·「2개」)
  if (/^[0-9０-９]+(개|번|가지)?$/.test(answer)) return "숫자";
  // 수식은 뚫지 않는다 — 입력이 불가능하고 채점도 표기에 휘둘린다
  if (answer.includes("$") || answer.includes("\\")) return "수식";
  // 같은 말을 두 번 뚫으면 두 번째는 첫 번째를 베끼면 된다
  if (seen.has(answer)) return "중복";
  return null;
}

/**
 * 제안을 거르고, **뚫는 일은 우리가 한다.**
 *
 * 모델에게 templateText까지 시켰더니 뚫지 않은 원문을 그대로 돌려줬다
 * (실측: `{{1}}`이 하나도 없는 문장). 모델이 잘하는 것은 「어느 말이 이
 * 개념을 가르는가」를 고르는 일이고, 그 말을 문장에서 찾아 자리를 파는 것은
 * 기계가 틀릴 수 없는 일이다. 그래서 나눈다 — 모델은 답만, 뚫기는 코드가.
 *
 * 문장은 원문에서 고른다: 고른 답을 **가장 많이 담은 줄**이 그 단계의 본문이
 * 된다. 그 줄에 없는 답은 버린다(다른 줄까지 이어 붙이면 학생이 읽을 것이
 * 문단이 되고, 그러면 빈칸이 아니라 받아쓰기다).
 */
function keepGrounded(
  stageBlanks: ProposedBlank[] | undefined,
  needsTemplate: boolean,
  plain: string,
  limit: number,
): { blanks: KeptBlank[]; template: string | null } {
  const seen = new Set<string>();
  const picked: Array<Omit<KeptBlank, "position">> = [];

  for (const b of stageBlanks ?? []) {
    const answer = (b.answer ?? "").trim();
    const reason = rejectReason(answer, plain, seen);
    if (reason || picked.length >= limit) {
      console.log(`    · 버림(${reason ?? "개수 상한"}): ${answer || "(빈 값)"}`);
      continue;
    }
    seen.add(answer);
    picked.push({
      answer,
      hint: (b.hint ?? "").trim(),
      alternatives: (b.alternatives ?? []).filter((a) => a.trim().length > 0),
    });
  }

  /* 자리는 화면이 본문 전체에서 찾는다(getBlankStage → applyBlanks). 여기서
   * 한 문장으로 좁히면 그 문장에 없는 답이 통째로 버려져 1·2단계가 한두 칸만
   * 남는다(실측). 답 목록만 넘기고 뚫는 자리는 본문 전체로 둔다.
   *
   * template_text는 화면이 쓰지 않지만 DB CHECK가 one·two에 요구하므로
   * 원문을 그대로 넣어 둔다 — 검수에서 「어느 글에서 뽑았나」의 근거가 된다. */
  return {
    blanks: picked.map((p, i) => ({ ...p, position: i + 1 })),
    template: needsTemplate ? plain : null,
  };
}

/**
 * 3단계 — **전부 빈칸.** 낱말을 고르는 것이 아니라, 「소수: 내용」이
 * 「__ : ______」이 되게 글 조각을 통째로 비운다(소유자 정의).
 *
 * 그래서 모델을 부르지 않는다. 무엇을 비울지 고를 필요가 없기 때문이다 —
 * 정의의 용어와 그 내용, 핵심·순서의 각 항목이 그대로 한 칸씩이 된다.
 * 정답은 원문 전체이므로 학생이 토씨까지 맞출 수는 없다. 채점이 뜻으로
 * 보는 이유가 여기 있다(blank-semantic).
 */
function buildFullStage(body: unknown[]): KeptBlank[] {
  const out: KeptBlank[] = [];
  const push = (text: string) => {
    const t = text.trim();
    // 너무 짧은 조각(기호·한 글자)은 칸으로 만들지 않는다
    if (t.length < 2) return;
    out.push({ position: out.length + 1, answer: t, hint: "", alternatives: [] });
  };
  for (const doc of body) {
    if (!Array.isArray(doc)) continue;
    for (const b of doc as Block[]) {
      if (b.type === "definition") {
        if (b.term) push(b.term);
        push(runsToText(b.content));
      } else if (b.type === "text") {
        push(b.text ?? "");
      } else if (b.type === "paragraph") {
        push(runsToText(b.content));
      } else if (b.type === "key_point" || b.type === "steps") {
        for (const it of Array.isArray(b.items) ? b.items : []) {
          push(
            Array.isArray(it)
              ? runsToText(it as Run[])
              : runsToText((it as { content?: Run[] }).content),
          );
        }
      } else if (b.type === "callout") {
        /* 예·참고·주의·보충 상자도 글이다 — 뚫는다. 안에 든 것 가운데
         * 문단만 뚫고 수식·표는 그대로 둔다(뚫을 수 없는 곳). */
        /* content가 두 모습으로 온다 — 블록 배열(paragraph…)이거나 런 배열
         * 그대로다. 형태로 가른다: kind가 있으면 런이다. */
        const items = (Array.isArray(b.content) ? b.content : []) as Array<
          Block & { kind?: string }
        >;
        if (items.some((x) => typeof x.kind === "string")) {
          push(runsToText(items as unknown as Run[]));
        } else {
          for (const inner of items) {
            if (inner.type === "paragraph") push(runsToText(inner.content));
          }
        }
      }
    }
  }
  return out;
}

const sql = createSql();
try {
  const concepts = await sql<
    { id: string; org: string; name: string; body: unknown[] }[]
  >`
    select c.id::text, m.organization_id::text as org, c.name,
           jsonb_agg(m.body order by m.sort_order, m.created_at) as body
    from canonical_concepts c
    join learning_materials m on m.concept_id = c.id
      and m.kind = 'reading' and m.status = 'published'
    where c.slug like ${unitPrefix + "%"}
    group by 1, 2, 3
    order by c.name
  `;
  console.log(`개념 ${concepts.length}개 (slug ${unitPrefix}*)\n`);

  let made = 0;
  let skipped = 0;
  for (const c of concepts) {
    const plain = (c.body as unknown[]).map(bodyToPlain).filter(Boolean).join("\n\n");
    if (plain.trim().length < 40) {
      console.log(`— ${c.name}: 본문이 너무 짧아 건너뜀`);
      continue;
    }
    const existing = await sql<{ stage: string }[]>`
      select stage::text as stage from concept_blank_sets
      where organization_id = ${c.org} and concept_id = ${c.id}
    `;
    const have = new Set(existing.map((e) => e.stage));
    if (have.size === 3) {
      console.log(`— ${c.name}: 이미 3단계가 있어 건너뜀 (사람이 손댄 것을 덮지 않는다)`);
      skipped += 1;
      continue;
    }

    console.log(`▸ ${c.name}`);
    const proposal = await propose(c.name, plain);
    for (const stage of ["one", "two", "full"] as const) {
      if (have.has(stage)) {
        console.log(`    · ${stage}: 이미 있음`);
        continue;
      }
      let blanks: KeptBlank[];
      let template: string | null;
      if (stage === "full") {
        blanks = buildFullStage(c.body as unknown[]);
        template = null;
      } else {
        const p = proposal[stage];
        const kept = keepGrounded(p?.blanks, true, plain, MAX_BLANKS[stage]);
        blanks = kept.blanks;
        template = kept.template;
      }
      if (blanks.length === 0) {
        console.log(`    · ${stage}: 쓸 만한 빈칸이 없어 만들지 않음`);
        continue;
      }
      if (stage !== "full" && !template) {
        console.log(`    · ${stage}: 본문(templateText)이 없어 만들지 않음`);
        continue;
      }
      console.log(
        `    · ${stage}: 빈칸 ${blanks.length}개${
          stage === "full"
            ? " (전부)"
            : ` — ${blanks.map((b) => b.answer).join(", ")}`
        }`,
      );
      if (dryRun) continue;
      await sql`
        insert into concept_blank_sets (
          id, organization_id, concept_id, stage, template_text, blanks, status
        ) values (
          ${uuidv7()}, ${c.org}, ${c.id}, ${stage}::concept_blank_stage,
          ${template}, ${sql.json(blanks as never)}, 'draft'
        )
        on conflict (organization_id, concept_id, stage) do nothing
      `;
      made += 1;
    }
  }
  console.log(
    `\n${dryRun ? "[미리보기] " : ""}초안 ${made}건 생성 · 개념 ${skipped}개 건너뜀`,
  );
  if (!dryRun && made > 0) {
    console.log("검수 후 게시하세요 — 초안은 학생에게 보이지 않습니다.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
