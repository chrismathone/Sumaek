/* 추출 파이프라인의 자료형 — 파이썬 덤프(packages/ingest/python/extract.py)의 계약. */

export interface Span {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 부분집합 접두사가 없는 폰트 이름 (예: EHsang-Italic) */
  font: string;
  size: number;
  flags: number;
  color: number;
  /**
   * 글자 하나하나의 상자 `[x0, y0, x1, y1]` — `text`와 자리수가 같다.
   *
   * span 좌표만으로는 **한 span 안에 섞인 위첨자**를 알 수 없다. 이 교재는
   * `2^a×3^b`를 span 두 개(`2` + `` b`_3º` ``)로 내는데, 뒤 span의 첫 글자
   * `b`가 폭 0인 위첨자 글리프다. 글자 상자를 봐야 그것이 갈린다.
   */
  chars?: [number, number, number, number][];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageDump {
  page: number;
  width: number;
  height: number;
  spans: Span[];
  drawings: (Rect & { fill: boolean })[];
  images: (Rect & { xref: number })[];
}

export interface SourceDump {
  source: {
    fileName: string;
    checksum: string;
    pageCount: number;
    extractedRange: [number, number];
  };
  pages: PageDump[];
}

/** 본문 한 조각 — 한글이거나 수식이거나 */
export type Run =
  | { kind: "text"; text: string }
  | {
      kind: "math";
      /** PDF가 준 원문 그대로 — 불변 (원칙 2O) */
      raw: string;
      latex: string;
      /** 해독표가 확신하지 못한 글리프 */
      unknown: string[];
    };

export interface ChoiceItem {
  /** ①②③④⑤ */
  marker: string;
  order: number;
  runs: Run[];
}

export interface ConditionItem {
  marker?: string;
  runs: Run[];
}

/** 문항이 속한 유형(출제 유형) 또는 소단원 맥락 */
export interface TypeContext {
  /**
   * `type` — 「유형 01 서로소」 (유형 익히기 쪽)
   * `section` — 「소수와 합성수」 (개념 익히기 쪽의 소단원 머리글)
   * 둘은 같은 폰트를 쓰지만 유형에만 「유형」 라벨이 붙는다.
   */
  kind: "type" | "section";
  /** 유형 번호 (01, 02 …). 소단원 머리글에는 없다. */
  number: string;
  title: string;
  /** 「개념원리 중학 수학 1-1 32쪽」 같은 교과서 참조 */
  textbookRef: string | null;
}

export interface ExtractedQuestion {
  printedNumber: string;
  page: number;
  column: number;
  bbox: Rect;
  /** 발문 (선택지·보기 박스 앞까지) */
  stem: Run[];
  choices: ChoiceItem[] | null;
  conditionBox: { label: string; items: ConditionItem[] } | null;
  /** 이 문항 영역에 벡터 도형 뭉치가 있는가 — 그림 없이는 못 푸는 문항 표시 */
  figureBoxes: Rect[];
  /** 그림 안에 찍힌 글자 (치수·꼭짓점 라벨). 발문이 아니라 그림의 일부다. */
  figureLabels: string[];
  typeContext: TypeContext | null;
  /** 러닝헤드에서 읽은 중단원 — 유형 머리글이 없는 쪽에서 유일한 계층 */
  unit?: { number: string; title: string };
  /** 커버리지 계산용 — 이 문항이 소비한 span의 페이지 내 인덱스 */
  consumedSpanIndexes: number[];
}

/**
 * 쪽 아래 러닝헤드가 알려 주는 것 — **교재의 계층**.
 *
 * 짝수 쪽은 대단원(「20 I. 소인수분해」), 홀수 쪽은 중단원
 * (「02 최대공약수와 최소공배수 21」)을 싣는다. 러닝헤드라고 버렸더니
 * 「중단원 마무리」 51문항이 아무 계층에도 걸리지 않았다 — 그 쪽에는
 * 유형 머리글이 **아예 없어서** 러닝헤드가 유일한 단서다.
 */
export interface RunningHead {
  /** 「I. 소인수분해」 */
  chapter?: string;
  /** 「02 최대공약수와 최소공배수」 */
  unit?: { number: string; title: string };
}

export interface PageExtraction {
  page: number;
  /** 이 쪽의 러닝헤드에서 읽은 계층 (없을 수 있다) */
  runningHead: RunningHead;
  questions: ExtractedQuestion[];
  /** 문항에도, 알려진 비문항 영역에도 속하지 않은 span (= 누락 후보) */
  unaccounted: Span[];
  /** 알려진 비문항 영역으로 분류된 span 수 */
  accountedNonQuestion: number;
}
