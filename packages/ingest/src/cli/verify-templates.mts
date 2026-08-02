/**
 * 원본 재현 검사 — 변형 엔진을 믿을 수 있는지 재는 유일한 잣대.
 *
 *   pnpm --filter @su-maek/ingest verify-templates --org=<uuid> [--verbose]
 *
 * DB에 든 원본 문항의 **숫자를 그대로** 템플릿에 넣고 풀어서, 교재 별책에
 * 인쇄된 답과 같은지 본다. 같으면 그 템플릿은 그 문항을 이해한 것이고,
 * 같은 풀이기가 만든 변형본도 믿을 수 있다.
 *
 * 이 검사를 건너뛰고 변형부터 만들면, 틀린 풀이기가 만든 틀린 답이 학생에게
 * 간다. 그리고 그건 화면 어디에도 드러나지 않는다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import postgres from "postgres";
import {
  evaluateNumericLatex,
  RPM_M1_CH1_ALL_TEMPLATES,
  type VariantTemplate,
} from "@su-maek/core/variants";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const organizationId = arg("org") ?? "00000000-0000-7000-8000-000000000001";
const verbose = args.includes("--verbose");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 4 });

interface Row {
  printed_number: string;
  kind: string;
  body: { type: string; runs?: { kind: string; text?: string; math?: { latex: string } }[]; choices?: { choiceId: string; content: { kind: string; text?: string; math?: { latex: string } }[] }[] }[];
  answer: { kind: string; correctChoiceIds?: string[]; accepted?: { value: string }[] } | null;
}

const rows = await sql<Row[]>`
  select q.printed_number, q.kind, qv.body, qv.answer
  from questions q join question_versions qv on qv.id = q.current_version_id
  where q.organization_id = ${organizationId} and q.source_ref is not null
  order by q.printed_number
`;

const renderRuns = (
  runs: { kind: string; text?: string; math?: { latex: string } }[] | undefined,
): string =>
  (runs ?? [])
    .map((r) => (r.kind === "text" ? (r.text ?? "") : `$${r.math?.latex ?? ""}$`))
    .join("");

/** 저장된 정답을 사람이 읽는 한 줄로 — 계산 결과와 대조할 형태 */
function printedAnswerOf(row: Row): string | null {
  if (!row.answer) return null;
  if (row.answer.kind === "multiple_choice") {
    const group = row.body.find((b) => b.type === "choice_group");
    const ids = row.answer.correctChoiceIds ?? [];
    if (!group?.choices || ids.length !== 1) return null;
    const chosen = group.choices.find((c) => c.choiceId === ids[0]);
    return chosen ? renderRuns(chosen.content) : null;
  }
  return row.answer.accepted?.[0]?.value ?? null;
}

/** `$2\times 3^{2}$` 같은 표기를 비교 가능한 꼴로 (공백·달러 제거) */
const normalize = (s: string): string => s.replace(/[$\s{}]/g, "");

/**
 * 계산한 답과 인쇄된 답이 같은가.
 *
 * **값으로 먼저 본다.** 교재는 같은 답을 문항마다 다르게 쓴다 — 0135는
 * 「2×3²」, 0136은 「15」. 둘 다 맞다. 문자열로만 비교하면 멀쩡한 풀이기를
 * 틀렸다고 버리게 된다. 값으로 못 읽는 경우에만 문자열로 떨어진다.
 */
function sameAnswer(computed: string, printed: string): boolean {
  const a = evaluateNumericLatex(computed);
  const b = evaluateNumericLatex(printed);
  if (a !== null && b !== null) return a === b;
  /* ◯·× 판정 문항 — 교재의 ×는 수식 폰트에서 와 `\times`로 해독된다.
   * 같은 기호인데 표기가 달라 재현 실패로 잡혔다(0108·0110). */
  const mark = (s: string): string =>
    normalize(s).replace(/\\times/g, "×").replace(/[Xx✕✖]/g, "×");
  if (/^[◯○×]$/.test(mark(computed)) || /^[◯○×]$/.test(mark(printed))) {
    return mark(computed) === mark(printed);
  }
  /* 「12개」와 「12」처럼 단위만 다른 경우 — 숫자만 남겨 다시 본다 */
  const digitsOnly = (s: string): string => normalize(s).replace(/[^\d]/g, "");
  if (/^\d+$/.test(digitsOnly(computed)) && digitsOnly(computed) === digitsOnly(printed)) {
    return true;
  }
  return normalize(computed) === normalize(printed);
}

interface Outcome {
  number: string;
  templateId: string;
  computed: string;
  printed: string;
  reproduces: boolean;
}

const outcomes: Outcome[] = [];
const unmatched: string[] = [];

for (const row of rows) {
  const stem = renderRuns(row.body.find((b) => b.type === "paragraph")?.runs);
  const group = row.body.find((b) => b.type === "choice_group");
  const choices = group?.choices?.map((c) => renderRuns(c.content)) ?? null;
  const printed = printedAnswerOf(row);

  let matched = false;
  for (const template of RPM_M1_CH1_ALL_TEMPLATES as readonly VariantTemplate<unknown>[]) {
    const params = template.parse(stem, choices);
    if (params === null) continue;
    matched = true;
    if (printed === null) {
      outcomes.push({
        number: row.printed_number,
        templateId: template.id,
        computed: "-",
        printed: "(답 없음)",
        reproduces: false,
      });
      break;
    }
    let computed: string;
    try {
      computed = template.solve(params).display;
    } catch (error) {
      computed = `풀이 실패: ${(error as Error).message}`;
    }
    outcomes.push({
      number: row.printed_number,
      templateId: template.id,
      computed,
      printed,
      reproduces: sameAnswer(computed, printed),
    });
    break;
  }
  if (!matched) unmatched.push(row.printed_number);
}

const byTemplate = new Map<string, Outcome[]>();
for (const o of outcomes) {
  const list = byTemplate.get(o.templateId) ?? [];
  list.push(o);
  byTemplate.set(o.templateId, list);
}

console.log(`문항 ${rows.length}개 · 템플릿에 걸린 것 ${outcomes.length}개\n`);
console.log("템플릿별 원본 재현:");
let totalOk = 0;
for (const [id, list] of [...byTemplate].sort()) {
  const ok = list.filter((o) => o.reproduces).length;
  totalOk += ok;
  const rate = ((ok / list.length) * 100).toFixed(0);
  const mark = ok === list.length ? "○" : "×";
  console.log(`  ${mark} ${id.padEnd(26)} ${String(ok).padStart(3)}/${String(list.length).padStart(3)}  ${rate}%`);
}
console.log(
  `\n합계 ${totalOk}/${outcomes.length} 재현 · 템플릿 없는 문항 ${unmatched.length}개`,
);

const failures = outcomes.filter((o) => !o.reproduces);
if (failures.length > 0) {
  console.log(`\n재현 실패 ${failures.length}건 — 이 문항에는 이 템플릿을 쓰면 안 된다:`);
  for (const f of failures.slice(0, 20)) {
    console.log(`  [${f.number}] ${f.templateId}`);
    console.log(`     계산 ${f.computed}`);
    console.log(`     교재 ${f.printed}`);
  }
  if (failures.length > 20) console.log(`  … 외 ${failures.length - 20}건`);
}

if (verbose) {
  console.log(`\n템플릿 없는 문항: ${unmatched.join(" ")}`);
}

await sql.end();
