/* 판별 문항(정답이 ◯·△·× 기호)의 화면 적응 — 순수 함수.
 *
 * 지면 발문은 지면의 상호작용을 말한다: 「()안에 써넣으시오」. 화면의
 * 상호작용은 고르기(기호 칩)이므로 **표시만** 그에 맞게 바꾼다 — DB의
 * 원본 본문은 손대지 않는다(원칙 12의 「지면과 같은가」는 저장본 기준).
 *
 * 칩은 발문이 실제로 언급한 기호만 보인다. 「옳으면 ◯, 옳지 않으면 ×」
 * 문항에 △ 칩이 있으면 학생이 △를 낼 수 있는데 그 문항에 △는 뜻이 없다.
 * 발문에 쌍이 이미 적혀 있으므로 이것은 정답 유출이 아니다. */

/** 화면에 내는 정본 기호 (채점 동치류의 대표 글자와 같다) */
const SYMBOL_CHIPS: ReadonlyArray<{ chip: string; mentions: RegExp }> = [
  { chip: "◯", mentions: /[◯○⭕]/ },
  { chip: "△", mentions: /[△▲]/ },
  { chip: "×", mentions: /[×✕✗]/ },
];

/**
 * 발문 텍스트가 언급한 기호 칩 목록 (정본 순서 ◯·△·×).
 * 수식은 `$…$`로 감싼 LaTeX(`\times`)라 곱셈 기호와 헷갈리지 않는다.
 * 두 개 미만이면 판별 쌍을 못 읽은 것이므로 전체를 돌려준다 — 칩이
 * 모자라 답을 못 내는 것보다 하나 남는 쪽이 낫다.
 */
export function symbolOptionsFromBodyText(bodyText: string): string[] {
  const text = bodyText.replace(/\$[^$]*\$/g, "");
  const options = SYMBOL_CHIPS.filter((s) => s.mentions.test(text)).map(
    (s) => s.chip,
  );
  return options.length >= 2 ? options : SYMBOL_CHIPS.map((s) => s.chip);
}

/**
 * 지면 발문을 고르기 발문으로 표시 전환:
 *   「…△를 ()안에 써넣으시오. 11()」 → 「…△를 고르시오. 11」
 * 괄호 유무·띄어쓰기 변형을 흡수하고, 지면의 답 빈칸 꼬리 「()」를 지운다.
 */
export function adaptInstructionForChoice(bodyText: string): string {
  return bodyText
    .replace(/를\s*\(\s*\)\s*안에\s*써넣으시오/g, "를 고르시오")
    .replace(/\(\s*\)\s*안에\s*써넣으시오/g, "고르시오")
    .replace(/\(\s*\)\s*$/, "")
    .trimEnd();
}

/**
 * 발문과 판별 대상을 **줄로 가른다.**
 *
 * 「다음 수가 소수이면 ◯, 합성수이면 △를 고르시오. 11」을 한 줄에 두면 11이
 * 발문의 꼬리처럼 읽혀서, 정작 판별할 수가 문장 끝에 묻힌다. 지면에서도
 * 판별 대상은 발문 아래에 따로 놓인다.
 *
 * 가르는 자리는 발문이 끝나는 「…시오.」다. 그 뒤에 남는 것이 없으면(본문이
 * 전부 발문인 객관식 따위) 그냥 한 줄이다.
 */
export function splitInstructionLine(line: string): string[] {
  const m = /^([\s\S]*?시오\.)[ \t]*(\S[\s\S]*)$/.exec(line);
  return m ? [m[1]!, m[2]!] : [line];
}

/* ── 발문 속 기호를 그림으로 그릴 자리 표시 ──────────────────────
 *
 * 발문의 ◯·△·×는 글자로 찍히고 답 칩은 그림(SVG)으로 그려서, 같은 뜻의
 * 기호가 한 문항 안에서 두 가지 모습으로 나왔다. 게다가 글자 쪽은 폰트
 * 글리프라 ◯는 크고 ×는 작게 나온다 — 문항마다 무게가 제각각이었다.
 *
 * 여기서는 **자리만 표시**한다. 렌더러(renderMixedText)가 HTML을 이스케이프
 * 하므로 SVG를 글자에 섞어 넣을 수 없지만, 사설 영역 문자는 그대로 통과한다.
 * 화면(QuestionLine)이 그 표식을 칩과 **같은 컴포넌트**로 바꿔 그린다.
 * 빈칸 표식(blank-render.ts)과 같은 수법이고, 겹치지 않는 부호를 쓴다. */
export const SYMBOL_MARK_OPEN = "";
export const SYMBOL_MARK_CLOSE = "";

/* 발문이 답 기호로 **선언한** 자리만 그린다.
 *
 * 선언 없이 글 속에 놓인 ×는 곱셈이다 — 「$2$ × $3$」처럼 수식 사이에 글자로
 * 남은 곱셈 기호를 도형으로 그리면 뜻이 뒤집힌다. 정답 키를 보면 확실하지만
 * 그건 화면마다 손에 쥐고 있지 않고(테스트·복습 질의는 정답을 아예 안
 * 가져온다 — 그게 옳다), 그리는 방식을 정하자고 정답을 끌고 올 일은 아니다.
 * 어차피 학생에게 그 기호를 답으로 만들어 주는 것은 **발문의 선언**이다 —
 * 칩 목록을 정할 때(symbolOptionsFromBodyText) 이미 같은 근거를 쓴다.
 *
 * 선언의 꼴은 둘이다: 조건 뒤(「…이면 ◯」)이거나 지시 앞(「◯를 고르시오」,
 * 「◯를 ( )안에 써넣으시오」). 실제 발문 세 꼴이 모두 여기 든다. */
const DECLARED_BEFORE = /면\s*$/;
const DECLARED_AFTER = /^\s*[를을]\s*(?:\(|고르|써넣|쓰)/;

function isDeclaredSymbol(text: string, at: number): boolean {
  return (
    DECLARED_BEFORE.test(text.slice(0, at)) ||
    DECLARED_AFTER.test(text.slice(at + 1))
  );
}

/**
 * 발문이 선언한 ◯·△·×를 표식으로 감싼다(정본 글자로 통일).
 * 수식(`$…$`) 안은 건드리지 않는다 — 거기의 `\times`는 곱셈이다.
 */
export function markSymbolGlyphs(text: string): string {
  return text
    .split(/(\$[^$]*\$)/g)
    .map((part) => {
      if (part.startsWith("$")) return part;
      let out = part;
      for (const { chip, mentions } of SYMBOL_CHIPS) {
        out = out.replace(new RegExp(mentions.source, "g"), (ch, at: number) =>
          isDeclaredSymbol(out, at)
            ? `${SYMBOL_MARK_OPEN}${chip}${SYMBOL_MARK_CLOSE}`
            : ch,
        );
      }
      return out;
    })
    .join("");
}

/** 정답이 전부 ◯·△·× 계열 기호인 답인가 — 값 자체는 화면으로 내보내지 않는다 */
export function isSymbolAnswerKey(
  answerKey: unknown,
  isSymbol: (s: string) => boolean,
): boolean {
  const accepted = (answerKey as { accepted?: { value?: unknown }[] } | null)
    ?.accepted;
  if (!Array.isArray(accepted) || accepted.length === 0) return false;
  return accepted.every(
    (a) => typeof a?.value === "string" && isSymbol(a.value),
  );
}
