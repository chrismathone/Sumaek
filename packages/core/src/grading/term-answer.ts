/* ─────────────────────────────────────────────────────────────
 * 용어 답 채점 — 빈칸(개념 인출)의 정답 비교.
 *
 * 기존 `normalizeShortAnswer`는 **수**를 위한 것이다(분수·소수·단위). 빈칸의
 * 정답은 「소인수」·「거듭제곱」·「밑」 같은 **한글 용어**라 축이 다르다.
 * 같은 함수에 우겨넣으면 수 정규화가 용어를 망가뜨린다(예: 「1의 자리」의
 * 1이 유리수로 해석된다).
 *
 * 무엇을 같다고 볼 것인가:
 *  - 띄어쓰기는 무시한다. 「소인수분해」와 「소인수 분해」는 같은 말이고,
 *    학생이 어느 쪽으로 쓸지는 교과서 판본마다 다르다.
 *  - 말끝은 떼어 낸다. **음성 입력**이 「소인수분해입니다」처럼 문장으로
 *    받아쓰기 때문이다. 조사(은·는·이·가)는 떼지 않는다 — 「지수가」에서
 *    「가」를 떼는 것은 맞지만 용어 자체가 그 글자로 끝나는 경우를 구별할
 *    수 없어, 잘못 떼면 오답이 정답이 된다. 말끝만 목록으로 좁게 다룬다.
 *  - 괄호와 문장부호는 버린다.
 *  - 라틴 문자는 대소문자를 무시한다(LCM/lcm).
 *
 * **동의어는 추측하지 않는다.** 「약수」와 「인수」가 같은 뜻인지는 맥락이
 * 정하는 문제이고, 함수가 임의로 같다고 하면 틀린 답이 통과한다. 허용할
 * 표기는 빈칸 데이터의 alternatives에 사람이 적는다.
 * ───────────────────────────────────────────────────────────── */

/** 말끝 — 긴 것부터 지운다(「입니다」를 「다」보다 먼저) */
const TRAILING_ENDINGS = [
  "입니다",
  "이에요",
  "예요",
  "이다",
  "라고 합니다",
  "라고 해요",
  "라 합니다",
  "이요",
  "요",
];

/**
 * 용어 답의 정규화. 결정론적.
 * 빈 문자열이 나올 수 있다(입력이 부호뿐인 경우) — 호출자가 빈 답을 오답으로
 * 다룬다. 여기서 임의로 되돌리지 않는다.
 */
export function normalizeTermAnswer(raw: string): string {
  let s = raw.normalize("NFC").trim();
  // 수식 구분자·문장부호·괄호 — 뜻을 바꾸지 않는 장식이다
  s = s.replace(/[$"'`«»“”‘’()（）[\]{}<>]/g, "");
  s = s.replace(/[.,·、。!?！？~〜]/g, "");
  // 말끝 — 한 번만 뗀다. 반복해 떼면 「요요」 같은 용어가 사라진다
  for (const ending of TRAILING_ENDINGS) {
    if (s.length > ending.length && s.endsWith(ending)) {
      s = s.slice(0, -ending.length);
      break;
    }
  }
  // 띄어쓰기는 통째로 없앤다 — 판본마다 다르다
  s = s.replace(/\s+/g, "");
  return s.toLowerCase();
}

/**
 * 제출이 정답인가. `alternatives`는 사람이 적은 허용 표기다.
 * 빈 제출은 언제나 오답이다 — 「안 썼다」를 맞았다고 하지 않는다.
 */
export function matchesTermAnswer(
  submitted: string,
  answer: string,
  alternatives: readonly string[] = [],
): boolean {
  const got = normalizeTermAnswer(submitted);
  if (got.length === 0) return false;
  return [answer, ...alternatives].some((a) => normalizeTermAnswer(a) === got);
}

export interface KeywordCoverage {
  /** 글에 담긴 핵심어 */
  found: string[];
  /** 빠진 핵심어 */
  missing: string[];
}

/**
 * 자유 서술(3단계 — 개념을 통째로 다시 쓰기)의 채점.
 *
 * 문장을 이해하지 않는다. **핵심어가 글 안에 나타났는가**만 센다 — 그것이
 * 규칙으로 설명할 수 있는 한계이고, 여기서 더 나가면 「그럴듯한데 틀린」
 * 판정을 학생에게 정답으로 돌려주게 된다. 채점 결과도 점수가 아니라
 * 「담은 것/빠진 것」 목록으로 낸다: 무엇을 더 써야 하는지가 학생에게
 * 필요한 정보다.
 *
 * 띄어쓰기를 없앤 글에서 찾으므로 「소인수 분해」라 써도 잡힌다.
 */
export function keywordCoverage(
  text: string,
  keywords: readonly string[],
): KeywordCoverage {
  const haystack = normalizeTermAnswer(text);
  const found: string[] = [];
  const missing: string[] = [];
  for (const k of keywords) {
    const needle = normalizeTermAnswer(k);
    if (needle.length > 0 && haystack.includes(needle)) found.push(k);
    else missing.push(k);
  }
  return { found, missing };
}
