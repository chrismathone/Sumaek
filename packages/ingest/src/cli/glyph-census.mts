/**
 * 기하 덤프에서 **아직 못 읽는 글리프**를 글꼴별로 세어 준다.
 *
 *   pnpm --filter @su-maek/ingest glyph-census <dump.json> [<dump2.json> …]
 *
 * 새 교재를 반입할 때 가장 먼저 돌린다. 자가채점(extract)은 「이 문항이
 * 덜 나왔다」까지만 말해 주는데, 그 원인의 대부분은 해독표에 없는 글자
 * 하나다. 그 글자가 **어느 글꼴에서 몇 번, 어느 쪽 어느 좌표에** 있는지
 * 알아야 render-page.py로 지면을 열어 눈으로 확인할 수 있다.
 *
 * 글꼴별로 세는 이유는 이 저장소의 오래된 교훈이다 — 부분집합 글꼴이라
 * **코드는 글꼴 안에서만 뜻이 있다.** `y`가 EHyak에서는 말줄임이고
 * EHsang에서는 변수 y다. 글꼴을 뭉쳐 세면 한 표로 둘 다 맞출 수 있다고
 * 착각하게 된다.
 *
 * **span 하나씩 따로 돌린다.** 그래서 앞뒤 조각과 합쳐야 읽히는 글리프는
 * 여기서 계속 미해독으로 잡힌다 — 선분 기호 `Ó`가 그렇다(`AB` + `Ó`로
 * 따로 서 있다가 파서가 붙여 읽는다). 여기 남아 있다고 곧 결함은 아니고,
 * 실제 결과는 `extract`의 자가채점으로 확인해야 한다.
 */
import { readFileSync } from "node:fs";
import { decodeHwpMath } from "../hwp-encoding";
import type { SourceDump } from "../types";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("사용법: glyph-census <dump.json> [<dump2.json> …] [--all]");
  process.exit(1);
}

/* 수식 글꼴만 본다. 본문 글꼴(YDVY·SMSS…)의 ①②·㉠㉡·∴는 해독표가 아니라
 * cleanBodyText가 맡으므로 여기 섞이면 진짜 미해독 글리프를 덮어 버린다.
 * --all을 주면 전부 낸다 — 새 교재에서 본문 글꼴 이름이 바뀌었는지 볼 때. */
const MATH_FONT = /^EH/;
const showAll = process.argv.includes("--all");

interface Sample {
  page: number;
  size: number;
  box: [number, number, number, number];
  text: string;
}
interface Entry {
  count: number;
  samples: Sample[];
}

/** (글꼴, 글자) → 횟수 + 지면을 열어 볼 좌표 */
const seen = new Map<string, Entry>();

for (const file of files) {
  const dump = JSON.parse(readFileSync(file, "utf8")) as SourceDump;
  for (const page of dump.pages) {
    for (const span of page.spans) {
      const font = span.font ?? "";
      if (!showAll && !MATH_FONT.test(font)) continue;
      /* **해독기를 실제로 돌린다.** 「표에 있느냐」만 물으면 안 된다 —
       * 분수 표(SHIFT_ROW·FRACTION_NUMERATOR)는 `;…;` 안에서만 보는
       * 표인데, 그것까지 「아는 글자」로 세면 분수 밖에서 만난 같은 코드가
       * 조용히 넘어간다. EHSunm의 `¥`가 그랬다 — 분수에서는 8이지만
       * 이 글꼴에서는 연립방정식의 큰 중괄호 조각이다. */
      for (const ch of new Set(decodeHwpMath(span.text, font).unknown.join(""))) {
        /* 한글·기본 문장부호는 수식 글리프가 아니다 — 본문이 섞여 든 것뿐 */
        if (/[가-힣ㄱ-ㆎ]/.test(ch)) continue;
        const key = `${font}\t${ch}`;
        const entry = seen.get(key) ?? { count: 0, samples: [] };
        entry.count += [...span.text].filter((c) => c === ch).length;
        if (entry.samples.length < 3) {
          entry.samples.push({
            page: page.page,
            size: span.size,
            box: [span.x0, span.y0, span.x1, span.y1],
            text: span.text,
          });
        }
        seen.set(key, entry);
      }
    }
  }
}

const rows = [...seen.entries()].sort((a, b) => b[1].count - a[1].count);
const total = rows.reduce((n, [, e]) => n + e.count, 0);
console.log(`미해독 글리프 ${rows.length}종 · ${total}회\n`);

for (const [key, entry] of rows) {
  const [font = "", ch = ""] = key.split("\t");
  const code = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
  console.log(`${JSON.stringify(ch)} ${code}  ${font}  — ${entry.count}회`);
  for (const s of entry.samples) {
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = s.box.map((v) => Math.round(v));
    /* render-page.py에 그대로 넣을 수 있게 여백을 조금 준 clip을 함께 낸다 */
    console.log(
      `    p.${s.page} ${s.size}pt  --clip ${x0 - 20} ${y0 - 6} ${x1 + 20} ${y1 + 6}`,
    );
    console.log(`      ${JSON.stringify(s.text)}`);
  }
}
