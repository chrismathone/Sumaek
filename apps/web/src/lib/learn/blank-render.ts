import "server-only";

/* ─────────────────────────────────────────────────────────────
 * 읽기 자료 본문에 빈칸을 뚫는다 — **화면은 개념 섹션과 똑같이 두고** 낱말만
 * 입력칸으로 바꾼다.
 *
 * 따로 만든 문장(templateText)을 보여 주면 학생이 방금 읽은 것과 다른 글을
 * 보게 된다. 같은 자료, 같은 카드(정의·예·핵심·순서), 같은 배치에서 낱말만
 * 사라져 있어야 「배운 것을 떠올린다」가 된다.
 *
 * 어떻게: 본문 JSON의 글자에 **사설 영역 표식**(U+E000 … U+E001)을 심는다.
 * 렌더러(renderMixedText)는 HTML을 이스케이프하므로 `<input>`을 글자에 섞어
 * 넣을 수 없지만, 사설 영역 문자는 건드리지 않고 그대로 통과시킨다. 그래서
 * 렌더가 끝난 HTML에서 표식만 입력칸으로 바꾼다(ReadingBody).
 *
 * 수식($...$) 안은 건드리지 않는다 — 수식은 통째로 KaTeX가 그리고, 그 안에
 * 표식을 넣으면 수식 자체가 깨진다.
 * ───────────────────────────────────────────────────────────── */

export const BLANK_OPEN = "";
export const BLANK_CLOSE = "";

/** 표식 — 자리 번호와 글자 수(입력칸 너비의 근거)를 담는다 */
export function blankToken(position: number, width: number): string {
  return `${BLANK_OPEN}${position}:${width}${BLANK_CLOSE}`;
}

export interface BlankTarget {
  position: number;
  answer: string;
}

/** 수식 밖에서 첫 등장만 바꾼다. 이미 바꾼 자리는 표식이라 다시 안 걸린다. */
function replaceOutsideMath(
  text: string,
  answer: string,
  token: string,
): { text: string; hit: boolean } {
  /* $...$ 구간을 건너뛴다. 수식 안의 같은 글자를 바꾸면 KaTeX가 깨진다. */
  const parts = text.split(/(\$[^$]*\$)/g);
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]!.startsWith("$")) continue;
    const at = parts[i]!.indexOf(answer);
    if (at === -1) continue;
    parts[i] =
      parts[i]!.slice(0, at) + token + parts[i]!.slice(at + answer.length);
    return { text: parts.join(""), hit: true };
  }
  return { text, hit: false };
}

/**
 * 본문(블록 배열)에 빈칸 표식을 심는다. 원본을 바꾸지 않는다(깊은 복사).
 *
 * 긴 답부터 심는다 — 짧은 답이 긴 답의 일부를 먼저 먹으면 안 된다
 * (소인수 ⊂ 소인수분해).
 *
 * 자리를 못 찾은 답은 `missing`으로 돌려준다. 화면은 그 자리를 빈칸 대신
 * 별도 입력칸으로 낼지 정할 수 있다 — 조용히 사라지면 학생이 채울 칸보다
 * 채점되는 칸이 많아진다.
 */
export function applyBlanks(
  body: unknown,
  targets: readonly BlankTarget[],
): { body: unknown; missing: BlankTarget[] } {
  if (!Array.isArray(body)) return { body, missing: [...targets] };
  const clone = JSON.parse(JSON.stringify(body)) as unknown;
  const remaining = new Map(targets.map((t) => [t.position, t]));
  const order = [...targets].sort((a, b) => b.answer.length - a.answer.length);

  /* 블록 트리의 모든 문자열을 훑는다 — text·runs.text·term·title·items…
   * 계약(reading.ts)이 문자열을 담는 키를 여럿 두고 있어 형태로 찾는다. */
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      let s = node;
      for (const t of order) {
        if (!remaining.has(t.position)) continue;
        const r = replaceOutsideMath(s, t.answer, blankToken(t.position, t.answer.length));
        if (r.hit) {
          s = r.text;
          remaining.delete(t.position);
        }
      }
      return s;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        // latex는 수식 원문이다 — 표식이 들어가면 KaTeX가 죽는다
        out[k] = k === "latex" ? v : walk(v);
      }
      return out;
    }
    return node;
  };

  const blanked = walk(clone);
  return { body: blanked, missing: [...remaining.values()] };
}
