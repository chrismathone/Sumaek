/* ─────────────────────────────────────────────────────────────
 * 정수론 — 문항 변형의 **정답 권한**
 *
 * 숫자를 바꾼 문항의 답은 여기서 나온다. AI가 계산하지 않는다.
 * "그럴듯한 답"은 학생이 맞는 답을 쓰고 틀렸다는 채점을 받게 만든다.
 *
 * 전부 순수 함수다 — 시각·난수를 읽지 않고, 같은 입력은 같은 출력.
 * 중1 교재가 다루는 범위(자연수, 대략 10⁶ 이하)만 감당하면 되므로
 * 시험 나눗셈으로 충분하다. 빠르기보다 **틀리지 않는 것**이 중요하다.
 * ───────────────────────────────────────────────────────────── */

/** 소인수분해 결과 — 밑 → 지수. 오름차순으로 정렬돼 있다. */
export type Factorization = ReadonlyMap<number, number>;

export function primeFactorize(n: number): Factorization {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`소인수분해는 자연수만 받는다: ${n}`);
  }
  const out = new Map<number, number>();
  let rest = n;
  for (let p = 2; p * p <= rest; p += p === 2 ? 1 : 2) {
    while (rest % p === 0) {
      out.set(p, (out.get(p) ?? 0) + 1);
      rest /= p;
    }
  }
  if (rest > 1) out.set(rest, (out.get(rest) ?? 0) + 1);
  return out;
}

export function fromFactorization(f: Factorization): number {
  let n = 1;
  for (const [base, exponent] of f) n *= base ** exponent;
  return n;
}

export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}

/** 1보다 큰 자연수 중 소수가 아닌 것 — 1은 소수도 합성수도 아니다 */
export function isComposite(n: number): boolean {
  return Number.isInteger(n) && n > 1 && !isPrime(n);
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

export function gcdAll(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("최대공약수는 수가 하나 이상 필요하다");
  return values.reduce((acc, v) => gcd(acc, v));
}

export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a / gcd(a, b)) * Math.abs(b);
}

export function lcmAll(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("최소공배수는 수가 하나 이상 필요하다");
  return values.reduce((acc, v) => lcm(acc, v));
}

export function areCoprime(a: number, b: number): boolean {
  return gcd(a, b) === 1;
}

/** 약수의 개수 — 소인수분해의 (지수+1) 곱 */
export function divisorCount(n: number): number {
  let count = 1;
  for (const exponent of primeFactorize(n).values()) count *= exponent + 1;
  return count;
}

/** 약수 전체 (오름차순) */
export function divisors(n: number): number[] {
  const out: number[] = [];
  for (let d = 1; d * d <= n; d += 1) {
    if (n % d !== 0) continue;
    out.push(d);
    if (d !== n / d) out.push(n / d);
  }
  return out.sort((a, b) => a - b);
}

/** 지수가 전부 짝수인가 — 「어떤 자연수의 제곱인 수」 판정 */
export function isPerfectSquare(n: number): boolean {
  const root = Math.round(Math.sqrt(n));
  return root * root === n;
}

/**
 * 소인수분해를 LaTeX으로. 지수 1은 쓰지 않는다 — 교재 표기와 같게.
 * 예: {2:2, 3:1, 5:3} → `2^{2}\times 3\times 5^{3}`
 */
export function factorizationToLatex(f: Factorization): string {
  const parts = [...f.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([base, exponent]) => (exponent === 1 ? `${base}` : `${base}^{${exponent}}`));
  return parts.join("\\times ");
}

/**
 * `2^{3}\times 3\times 5^{2}` 같은 LaTeX을 소인수분해로 되읽는다.
 * 원문 문항에서 숫자를 꺼낼 때 쓴다. 형태가 다르면 null — 억지로 읽지 않는다.
 */
export function parseFactorizationLatex(latex: string): Factorization | null {
  const cleaned = latex.replace(/[{}\s]/g, "").trim();
  if (cleaned === "") return null;
  const out = new Map<number, number>();
  for (const term of cleaned.split("\\times")) {
    const match = /^(\d+)(?:\^(\d+))?$/.exec(term);
    if (!match) return null;
    const base = Number(match[1]);
    const exponent = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isInteger(base) || base < 2) return null;
    out.set(base, (out.get(base) ?? 0) + exponent);
  }
  return out.size > 0 ? out : null;
}

/**
 * `2\times 3^{2}`이든 `18`이든 **값**으로 읽는다.
 *
 * 답을 문자열로 비교하면 안 되는 이유: 교재는 같은 답을 문항에 따라 다르게
 * 쓴다. 문항 0135는 「2×3²」로, 0136은 「15」로 인쇄한다. 둘 다 맞는 답이다.
 * 표기가 다르다고 재현 실패로 세면 멀쩡한 풀이기를 버리게 된다.
 */
export function evaluateNumericLatex(latex: string): number | null {
  const cleaned = latex.replace(/[$\s{}]/g, "");
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  const f = parseFactorizationLatex(cleaned);
  return f ? fromFactorization(f) : null;
}

/**
 * 결정론적 난수 — 같은 seed는 같은 수열.
 *
 * `Math.random`을 쓰지 않는 이유: 변형 문항을 다시 만들었을 때 같은 것이
 * 나와야 한다. 검수를 통과한 변형이 재실행에서 다른 숫자로 바뀌면 검수가
 * 무의미해진다.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [min, max] 정수 하나 (양끝 포함) */
export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** 배열에서 하나 — 비어 있으면 던진다 (조용히 undefined를 흘리지 않는다) */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError("고를 것이 없다");
  return items[randomInt(rng, 0, items.length - 1)]!;
}
