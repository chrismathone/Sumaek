/**
 * 결정론 유틸리티 — 일정 엔진·평가 생성의 재현성 기반 (불변 조건 12).
 * 같은 입력·버전·시드는 같은 해시·같은 난수열을 만든다.
 * 엔진 내부에서 Date.now()·Math.random()을 절대 사용하지 않는다.
 */

/** FNV-1a 64bit — 외부 의존성 없는 안정 해시. 결과는 16자리 hex 두 개 연결. */
export function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c;
    h2 = (Math.imul(h2, 0x01000193) + Math.imul(h1, 3)) >>> 0;
  }
  return (
    h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
  );
}

/**
 * 정렬 키 순서가 고정된 JSON 직렬화 — 해시 입력용.
 * 객체 키를 재귀적으로 정렬해 삽입 순서 차이가 해시를 바꾸지 않게 한다.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeys(v);
    return out;
  }
  return value;
}

export function hashObject(value: unknown): string {
  return stableHash(canonicalJson(value));
}

/**
 * mulberry32 시드 난수 — 같은 시드는 같은 수열.
 * 문자열 시드는 stableHash로 32bit 정수로 변환한다.
 */
export function createSeededRandom(seed: string): () => number {
  let a = parseInt(stableHash(seed).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 시드 기반 결정론적 셔플 (Fisher–Yates) — 원본을 변경하지 않는다. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rand = createSeededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}
