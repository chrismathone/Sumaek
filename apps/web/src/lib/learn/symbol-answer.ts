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
