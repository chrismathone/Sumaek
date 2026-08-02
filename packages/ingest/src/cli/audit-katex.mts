/**
 * 수식 렌더 전수검사 — **화면에 나가는 그대로** 확인한다.
 *
 *   pnpm --filter @su-maek/ingest audit-katex [--org=<uuid>] [--verbose]
 *
 * `math_expressions.parse_status`만 보면 안 되는 이유: 그 표는 body 안의
 * 수식만 담는다. 정답·해설·채점기준·선택지는 화면에서 따로 조립되고,
 * 조립 규칙이 다르면 **거기서만 깨진다.** 실제로 정답 칸은
 * `renderMixedText`를 거치지 않아 `$3$`이 글자 그대로 나오고 있었다.
 *
 * 그래서 화면이 만드는 것과 **같은 문자열**을 만들어 같은 함수에 넣는다.
 * 화면 코드(apps/web/.../questions/[id]/page.tsx)의 조립 규칙을 그대로 옮겼다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import postgres from "postgres";
import { renderMixedText } from "@su-maek/core/math";

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

interface Run {
  kind: string;
  text?: string;
  math?: { latex: string };
}
interface Block {
  type?: string;
  runs?: Run[];
  label?: string;
  items?: { marker?: string; content?: Run[] }[];
  choices?: { choiceId: string; content?: Run[] }[];
}
interface Row {
  printed_number: string;
  kind: string;
  body: Block[];
  choices: { choiceId: string; order: number }[] | null;
  answer: {
    kind?: string;
    correctChoiceIds?: string[];
    accepted?: { value?: string; unit?: string; form?: string }[];
  } | null;
  explanation: Block[] | null;
  rubric: { raw?: string } | null;
}

const rows = await sql<Row[]>`
  select q.printed_number, q.kind, qv.body, qv.choices, qv.answer, qv.explanation, qv.rubric
  from questions q join question_versions qv on qv.id = q.current_version_id
  where q.organization_id = ${organizationId} and q.source_ref is not null
  order by q.printed_number
`;

/** 화면과 같은 규칙: 수식은 `$…$`로 감싸 이어 붙인다 */
const runsToText = (runs: Run[] | undefined): string =>
  (runs ?? [])
    .map((r) => (r.kind === "math" ? `$${r.math?.latex ?? ""}$` : (r.text ?? "")))
    .join("");

function blocksToText(blocks: Block[] | null): string {
  const lines: string[] = [];
  for (const b of blocks ?? []) {
    if (b.type === "paragraph") lines.push(runsToText(b.runs));
    else if (b.type === "condition_box") {
      lines.push(`<${b.label ?? "조건"}>`);
      for (const item of b.items ?? []) {
        lines.push(`${item.marker ? `${item.marker} ` : ""}${runsToText(item.content)}`);
      }
    }
  }
  return lines.join("\n");
}

interface Finding {
  number: string;
  surface: string;
  detail: string;
}

const findings: Finding[] = [];
const bySurface = new Map<string, { checked: number; failed: number }>();

const check = (number: string, surface: string, text: string): void => {
  const stat = bySurface.get(surface) ?? { checked: 0, failed: 0 };
  if (text.trim() === "") {
    bySurface.set(surface, stat);
    return;
  }
  stat.checked += 1;

  const result = renderMixedText(text, "publish");
  if (result.failures.length > 0) {
    stat.failed += 1;
    findings.push({ number, surface, detail: `렌더 실패: ${result.failures.join(" | ")}` });
  } else if (/\\[a-zA-Z]+/.test(stripMath(text))) {
    /* 수식 구분자 **밖에** LaTeX 명령이 있다 — 화면에는 `\times`가 글자
     * 그대로 나온다. 렌더는 성공했다고 나오므로 이 검사가 없으면 안 보인다. */
    stat.failed += 1;
    findings.push({
      number,
      surface,
      detail: `수식 밖에 LaTeX 명령이 남았다: ${
        stripMath(text).match(/\\[a-zA-Z]+/g)?.slice(0, 3).join(" ") ?? ""
      }`,
    });
  }
  bySurface.set(surface, stat);
};

/** `$…$` 안쪽을 지운 나머지 — 여기 LaTeX 명령이 있으면 안 된다 */
const stripMath = (s: string): string =>
  s.replace(/\$\$[\s\S]*?\$\$/g, " ").replace(/\$[^$]*\$/g, " ");

for (const row of rows) {
  check(row.printed_number, "발문(body)", blocksToText(row.body));

  const group = row.body.find((b) => b.type === "choice_group");
  for (const choice of group?.choices ?? []) {
    check(row.printed_number, "선택지", runsToText(choice.content));
  }

  check(row.printed_number, "해설", blocksToText(row.explanation));

  /* 정답 — 화면의 formatAnswerKey가 만드는 문자열 그대로.
   * 이 칸은 renderMixedText를 **거치지 않는다**. 그래서 여기에 `$`나
   * LaTeX 명령이 있으면 그대로 사용자에게 보인다. */
  if (row.answer?.kind === "short_answer") {
    for (const accepted of row.answer.accepted ?? []) {
      /* 화면의 formatAnswerKey와 **같은 규칙**으로 만든다 —
       * form이 expression이면 `$…$`로 감싸고, 그 문자열을 렌더한다.
       * 화면이 무엇을 그리는지와 다른 것을 검사하면 검사가 거짓말한다. */
      const raw = accepted.value ?? "";
      const shown = accepted.form === "expression" ? `$${raw}$` : raw;
      check(row.printed_number, "정답(단답)", shown);
    }
  }

  if (row.rubric?.raw) {
    const stat = bySurface.get("채점기준") ?? { checked: 0, failed: 0 };
    stat.checked += 1;
    if (/\\[a-zA-Z]+/.test(stripMath(row.rubric.raw))) {
      stat.failed += 1;
      findings.push({
        number: row.printed_number,
        surface: "채점기준",
        detail: `수식 밖에 LaTeX 명령: ${row.rubric.raw.slice(0, 60)}`,
      });
    }
    bySurface.set("채점기준", stat);
  }
}

console.log(`문항 ${rows.length}개 · 화면이 만드는 문자열 그대로 검사\n`);
console.log("표시 자리별:");
for (const [surface, stat] of [...bySurface].sort((a, b) => b[1].failed - a[1].failed)) {
  const mark = stat.failed === 0 ? "○" : "×";
  const rate = stat.checked === 0 ? 0 : (stat.failed / stat.checked) * 100;
  console.log(
    `  ${mark} ${surface.padEnd(14)} ${String(stat.failed).padStart(4)} / ${String(stat.checked).padStart(4)} 깨짐  ${rate.toFixed(1)}%`,
  );
}

const byDetail = new Map<string, Finding[]>();
for (const f of findings) {
  const key = `${f.surface} · ${f.detail.split(":")[0]}`;
  byDetail.set(key, [...(byDetail.get(key) ?? []), f]);
}
console.log(`\n총 ${findings.length}건`);
for (const [key, list] of [...byDetail].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ● ${key} — ${list.length}건`);
  for (const f of list.slice(0, verbose ? 20 : 4)) {
    console.log(`      [${f.number}] ${f.detail.slice(0, 130)}`);
  }
  if (!verbose && list.length > 4) console.log(`      … 외 ${list.length - 4}건`);
}

await sql.end();
