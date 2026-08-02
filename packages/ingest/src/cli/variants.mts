/**
 * 변형 문항 만들어 보기 (아직 DB에 쓰지 않는다).
 *
 *   pnpm --filter @su-maek/ingest variants --seed=42 --per=3
 *
 * DB에 쓰지 않는 이유: 먼저 **눈으로 봐야 한다.** 답이 맞는지는 코드가
 * 보증하지만, 「바꾼 숫자가 문항으로 말이 되는가」는 사람이 본다.
 * 원본 재현 검사(verify-templates)를 통과한 문항만 대상으로 삼는다 —
 * 풀이기가 그 문항을 이해했다는 증거가 있어야 변형을 믿을 수 있다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import postgres from "postgres";
import {
  evaluateNumericLatex,
  makeRng,
  renderMultipleChoice,
  RPM_M1_CH1_TEMPLATES,
  type GcdParams,
  type VariantTemplate,
} from "@su-maek/core/variants";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const organizationId = arg("org") ?? "00000000-0000-7000-8000-000000000001";
const seed = Number(arg("seed") ?? 20260802);
const perQuestion = Number(arg("per") ?? 3);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 4 });

interface Row {
  printed_number: string;
  body: {
    type: string;
    runs?: { kind: string; text?: string; math?: { latex: string } }[];
    choices?: { choiceId: string; content: { kind: string; text?: string; math?: { latex: string } }[] }[];
  }[];
  answer: { kind: string; correctChoiceIds?: string[]; accepted?: { value: string }[] } | null;
}

const rows = await sql<Row[]>`
  select q.printed_number, qv.body, qv.answer
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

const sameAnswer = (a: string, b: string): boolean => {
  const x = evaluateNumericLatex(a);
  const y = evaluateNumericLatex(b);
  if (x !== null && y !== null) return x === y;
  const digits = (s: string): string => s.replace(/[^\d]/g, "");
  return digits(a) !== "" && digits(a) === digits(b);
};

const MARKERS = "①②③④⑤";
let made = 0;
let rejected = 0;
const rejectionReasons = new Map<string, number>();

for (const row of rows) {
  const stem = renderRuns(row.body.find((b) => b.type === "paragraph")?.runs);
  const group = row.body.find((b) => b.type === "choice_group");
  const choices = group?.choices?.map((c) => renderRuns(c.content)) ?? null;
  const printed = printedAnswerOf(row);
  if (printed === null) continue;

  for (const template of RPM_M1_CH1_TEMPLATES as readonly VariantTemplate<unknown>[]) {
    const params = template.parse(stem, choices);
    if (params === null) continue;

    /* 원본 재현 관문 — 통과 못 하면 이 문항에는 손대지 않는다 */
    const original = template.solve(params);
    if (!sameAnswer(original.display, printed)) break;

    console.log(`\n${"═".repeat(70)}`);
    console.log(`원본 [${row.printed_number}] · ${template.label}`);
    console.log(`  ${stem}`);
    if (choices) console.log(`  ${choices.map((c, i) => `${MARKERS[i]} ${c}`).join("  ")}`);
    console.log(`  답: ${original.display}  (교재 인쇄: ${printed}) ✓ 재현`);
    console.log("  ─── 변형 ───");

    const rng = makeRng(seed + Number(row.printed_number));
    let produced = 0;
    for (let attempt = 0; attempt < perQuestion * 12 && produced < perQuestion; attempt += 1) {
      const next = template.vary(params, rng);
      const solution = template.solve(next);
      const problems = template.check(next, solution, params);
      if (problems.length > 0) {
        rejected += 1;
        for (const p of problems) {
          rejectionReasons.set(p.split(" —")[0]!, (rejectionReasons.get(p.split(" —")[0]!) ?? 0) + 1);
        }
        continue;
      }
      produced += 1;
      made += 1;
      if (template.kind === "multiple_choice") {
        const built = renderMultipleChoice(
          template as VariantTemplate<GcdParams>,
          next as GcdParams,
          rng,
          /* 원본이 선택지를 평문 숫자로 썼으면 변형도 그렇게 — 같은 자리에
           * 놓았을 때 꼴이 달라 티가 나면 안 된다 */
          (choices ?? []).every((c) => /^\$\d+\$$/.test(c.trim())),
        );
        console.log(`  ${produced}. ${built.question.stem}`);
        console.log(
          `     ${built.question.choices!.map((c, i) => `${MARKERS[i]} ${c}`).join("  ")}`,
        );
        console.log(
          `     답: ${MARKERS[built.solution.correctIndex!]} ${built.solution.display}`,
        );
      } else {
        const built = template.render(next, solution);
        console.log(`  ${produced}. ${built.stem}`);
        console.log(`     답: ${solution.display}`);
      }
      console.log(`     ${solution.steps.join(" → ")}`);
    }
    break;
  }
}

console.log(`\n${"═".repeat(70)}`);
console.log(`만든 변형 ${made}개 · 거부 ${rejected}개`);
console.log("거부 사유:");
for (const [reason, n] of [...rejectionReasons].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${reason}`);
}
console.log(
  "\nDB에 쓰지 않았습니다. 답은 코드가 보증하지만 문장이 말이 되는지는 사람이 봅니다.",
);

await sql.end();
