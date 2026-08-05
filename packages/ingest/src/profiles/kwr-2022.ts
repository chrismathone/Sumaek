import type { ConceptWeight } from "./rpm-2022-concepts";

/* ─────────────────────────────────────────────────────────────
 * 개념원리 (2022 개정) 본책 — **개념 설명** 추출 프로파일
 *
 * RPM 프로파일(rpm-2022)이 「문항」을 뽑는 규칙이라면, 이 프로파일은
 * 같은 출판사 개념서의 「개념 블록」을 뽑는 규칙이다. 조판 시스템이
 * 같아서(수식 EH*, 한글 YDVY*, HWP 인코딩) 해독표는 그대로 쓰고,
 * 지면 구획 신호만 여기서 새로 잡는다.
 *
 * 아래 값은 전부 실제 PDF(22개정 개념원리 중 1-1 교사용, 224쪽)의
 * 텍스트 레이어를 열어 실측한 것이다. 지면 크기 609.45×807.87pt.
 *
 * 이 교재의 구획 리듬 (소단원마다 반복):
 *   소단원 제목(SDGyeokdong 24~27pt)
 *     → 개념 N (DINPro-Bold 19pt 번호 + YDVYGOStd14 10.3pt 질문형 제목
 *        + YDVYGOStd13 7.3pt 「핵심문제 NN」 상호참조)
 *     → 본문: ⑴⑵⑶ 정의 · 예/참고/주의 배지(YDVYGOStd14 7.3pt)
 *        · 보충학습(Tenada) · ❶❷❸ 단계
 *     → 「개념원리 확인하기」「핵심문제 익히기」「시험에 이런 문제가
 *        나온다」(GangwonEduPower 13pt+) — 여기부터는 문제 구역
 *
 * 교사용 특유: 여백의 「강의 Plus」 상자(테두리 상자 + '강의' 배지
 * YDVYGOStd23 7.5pt). 학생에게 나가는 본문이 아니므로 본문에서 빼고
 * 출처 메타데이터에 교사 주석으로 남긴다.
 * ───────────────────────────────────────────────────────────── */

export interface ConceptExtractionProfile {
  /** 안정적인 식별자 — DB에 적히는 값 */
  id: string;
  /** 이 프로파일을 고칠 때마다 올린다 */
  version: string;
  label: string;
  appliesTo: string;

  /** 수식 폰트 — 이 폰트의 span은 HWP 해독표로 옮긴다 */
  mathFont: RegExp;
  /** 인라인 분수·세로셈 조각 폰트 (기준선이 내려앉는다) */
  inlineFractionFont: RegExp;
  /** 그림 조각 폰트 (밑줄 중괄호 등) — 글자가 아니므로 버린다 */
  decorationFont: RegExp;
  /**
   * 장식 라벨 폰트 — 내용이 아니라 지면 꾸밈이다.
   * OTOmniGothic(세로 「개념원리 이해」 배지), BodoniStd(옆 탭 「I」),
   * GmarketSans(차례 머리), KIMM(대단원 표지), Bebas·FuturaStd(문제 번호).
   */
  dropFonts: RegExp;
  /**
   * 구매자 식별 워터마크. 이메일 형태 외에 **아이디 단독**(`st2000423`)으로도
   * 찍힌다(p.11에서 실측) — 이메일 패턴만 거르면 아이디가 본문에 남는다.
   */
  purchaserStamp: RegExp;

  /** 같은 줄로 묶을 기준선 허용 오차(pt) */
  lineToleranceY: number;
  /** 이 위는 위 러닝헤드 (「1. 소인수분해」) */
  topMarginY: number;
  /** 이 아래는 푸터 (쪽 번호 + 중단원) */
  footerY: number;

  /** 소단원 제목 — 「공약수와 최대공약수」 27pt */
  subsectionTitle: { font: RegExp; minSize: number };
  /** 개념 번호 — 제목 왼쪽 위에 19pt로 찍힌다 */
  conceptNumber: { font: RegExp; minSize: number; maxSize: number };
  /** 개념 제목 — 질문형 (「최대공약수는 어떻게 구하는가?」) */
  conceptTitle: { font: RegExp; minSize: number; maxSize: number };
  /** 개념 → 핵심문제 상호참조 (「핵심문제 02~04」) */
  xref: { font: RegExp; maxSize: number; pattern: RegExp };
  /** 문제 구역 머리 배지 — 여기부터 개념 수집을 멈춘다 */
  problemBadge: { font: RegExp; minSize: number };
  /** 보충학습 배지 폰트 — 두 span(보충/학습)이 세로로 온다 */
  supplementBadge: RegExp;
  /** 「강의 Plus」 상자의 '강의' 배지 폰트 — 이 배지가 든 상자는 교사 주석 */
  teacherBadge: RegExp;
  /** 예·참고·주의 항목 배지 — 본문에 글자로 남긴다 */
  itemBadge: { font: RegExp; maxSize: number; pattern: RegExp };

  /**
   * 여백·그림 상자로 볼 drawings 크기. 개념 제목 띠(높이 20pt)를
   * 상자로 잡으면 제목이 상자 속으로 사라지므로 minH가 그보다 크다.
   * maxW는 지면 테두리(656pt)를 거른다.
   */
  asideBox: { minW: number; minH: number; maxW: number };
  /**
   * 곁줄 나누기 — 한 줄 안에서 이만큼 벌어진 틈 뒤가 이 x 이상에서
   * 시작하면 오른쪽 곁블록(방법 2 수형도, 참고 세로셈)으로 가른다.
   * 본문 줄바꿈 들여쓰기(141~170pt)와 겹치지 않는 값이어야 한다.
   */
  sideClusterX: number;
  sideGap: number;

  /** 러닝헤드의 중단원 표기 — 「2. 최대공약수와 최소공배수」 */
  runningUnit: RegExp;

  /**
   * 화살표 도해의 **사람이 쓴 대체 문장.**
   *
   * 지면의 도해(「5³의 3을 화살표로 가리키며 '지수'」)는 글자만 옮기면
   * 「5×5×5=5³지수 밑」처럼 뜻이 사라진다. 격자표(체)는 좌표·사선으로
   * 재구성할 수 있지만 화살표의 「무엇을 가리키는가」는 텍스트에 없다 —
   * 그래서 **지어내지 않고 사람이 지면을 보고 문장으로 옮긴다**
   * (개념 매핑 표와 같은 원칙). region 안에서 시작하는 곁블록·그림
   * 상자가 이 문장으로 대체된다.
   */
  figureOverrides: readonly {
    page: number;
    region: { x0: number; y0: number; x1: number; y1: number };
    /** 혼합 텍스트 (`$…$` 수식 포함 가능) */
    text: string;
  }[];
}

export const KWR_2022: ConceptExtractionProfile = {
  id: "kwr-2022",
  version: "1.0.0",
  label: "개념원리 중학 수학 (2022 개정) 교사용 — 개념 블록",
  appliesTo: "개념원리 중학 수학 시리즈 · 2022 개정 교육과정 · 본책 개념 설명 쪽",

  mathFont: /^EH/,
  inlineFractionFont: /EHboNA/,
  decorationFont: /EHSunm/,
  dropFonts: /OTOmniGothic|BodoniStd|GmarketSans|KIMM_|Bebas|FuturaStd/,
  purchaserStamp: /[\w.+-]+@[\w-]+\.[\w.-]+|\bst\d{6,}\b/,

  lineToleranceY: 4,
  /* 위 브레드크럼(「2 최대공약수와 최소공배수」)은 y1≈48.8까지 내려온다.
   * 본문 최상단은 소단원 제목 y0=52 — 그 사이 50으로 긋는다. */
  topMarginY: 50,
  footerY: 755,

  subsectionTitle: { font: /SDGyeokdongGL2-eBd/, minSize: 23 },
  conceptNumber: { font: /DINPro-Bold/, minSize: 17.5, maxSize: 20 },
  conceptTitle: { font: /YDVYGOStd14/, minSize: 9.5, maxSize: 11 },
  xref: { font: /YDVYGOStd13/, maxSize: 8.5, pattern: /핵심문제/ },
  problemBadge: { font: /GangwonEduPower/, minSize: 13 },
  supplementBadge: /Tenada/,
  teacherBadge: /YDVYGOStd23/,
  itemBadge: { font: /YDVYGOStd14/, maxSize: 8.5, pattern: /^(예|참고|주의)$/ },

  asideBox: { minW: 40, minH: 26, maxW: 600 },
  sideClusterX: 330,
  /* 본문 낱말 틈은 10pt를 넘지 않는다 (실측). 30으로 두면 ❸ 문장 옆
   * 23pt 떨어진 「(최대공약수)=2×3」 정렬 블록이 문장 한가운데 끼었다. */
  sideGap: 22,

  runningUnit: /^(\d+)\s*[.·]\s*(\S.{1,30})$/,

  /* 중1-1 I단원 — 지면을 눈으로 보고 옮긴 문장 (렌더 이미지 대조) */
  figureOverrides: [
    {
      /* p.10 개념2 옆 도해: 5×5×5=5³에서 화살표로 지수·밑을 가리킨다 */
      page: 10,
      region: { x0: 425, y0: 628, x1: 535, y1: 680 },
      text: "$5\\times 5\\times 5=5^{3}$ — 여기서 $5$는 밑, $3$은 지수다.",
    },
    {
      /* p.11 방법 2 수형도: 가지를 치며 소수만 남을 때까지 나눈다 */
      page: 11,
      region: { x0: 340, y0: 295, x1: 545, y1: 385 },
      text:
        "방법 2 — 가지의 끝이 모두 소수가 될 때까지 나눈다: " +
        "$60=2\\times 30$, $30=2\\times 15$, $15=3\\times 5$ 이므로 " +
        "$60=2^{2}\\times 3\\times 5$",
    },
    {
      /* p.17 설명의 약수 곱셈표 — 괘선·칠이 그림이라 줄로 풀면
       * 「2 / 의 약수[ 2 2×1=2…」처럼 흩어진다. 지면의 표를 그대로 옮겼다. */
      page: 17,
      region: { x0: 150, y0: 278, x1: 370, y1: 342 },
      text:
        "$\\begin{array}{c|ccc} \\times & 1 & 3 & 3^{2} \\\\ \\hline " +
        "1 & 1\\times 1=1 & 1\\times 3=3 & 1\\times 3^{2}=9 \\\\ " +
        "2 & 2\\times 1=2 & 2\\times 3=6 & 2\\times 3^{2}=18 \\end{array}$ " +
        "(가로줄은 $3^{2}$의 약수, 세로줄은 $2$의 약수)",
    },
  ],
};

/* ─────────────────────────────────────────────────────────────
 * 개념 블록 → 정본 개념(canonical_concepts) 잇기
 *
 * **이 표는 사람이 쓴다** (rpm-2022-concepts와 같은 원칙). 소단원 제목과
 * 개념 번호가 열쇠다 — 질문형 제목은 판이 바뀌면 문구가 흔들리지만
 * 소단원·번호는 차례에 박혀 있다.
 *
 * RPM 문항이 이미 걸려 있는 개념(m1-*)에 같은 열쇠로 잇는다. 그래서
 * 학생 화면에서 「이 개념의 설명 → 이 개념의 문항」이 한 줄로 이어진다.
 * ───────────────────────────────────────────────────────────── */

export interface ConceptTarget {
  /** canonical_concepts.slug */
  slug: string;
  weight?: ConceptWeight[];
}

/**
 * 열쇠: `쪽|소단원 제목|개념 번호` (공백 하나로 눌러 비교)
 *
 * **쪽이 열쇠에 들어가는 이유.** 이 책은 소단원 제목의 「(1)」·「(2)」를
 * 다른 글꼴로 찍어서 추출된 제목에서 빠진다. 그래서 p.111 「일차식의
 * 계산 (1)」의 개념1과 p.117 「(2)」의 개념1이 `소단원|번호`만으로는
 * **똑같은 열쇠**가 되고, Map은 뒤엣것만 남긴다. p.156·163 「일차방정식의
 * 활용 (1)·(2)」도 마찬가지다.
 *
 * 지금 표에서는 그 네 자리가 어차피 같은 정본 개념을 가리켜서 결과가
 * 달라지지 않는다 — **아직은.** 개념을 더 잘게 나누면 그날부터 조용히
 * 틀리기 시작한다. 쪽은 허용목록에 이미 사람이 확인해 적어 둔 값이므로
 * 열쇠에 넣어도 새로 알아낼 것이 없다.
 */
export function conceptTargetKey(
  page: number,
  subsection: string,
  no: string | null,
): string {
  return `${page}|${subsection.replace(/\s+/g, " ").trim()}|${no ?? "?"}`;
}

/** I. 소인수분해 — 개념서 p.10·11·17·30·35 */
export const KWR_M11_CH1_TARGETS: ReadonlyMap<string, string> = new Map([
  ["10|소인수분해|1", "m1-prime-composite"],
  ["10|소인수분해|2", "m1-prime-factorization"],
  ["11|소인수분해|3", "m1-prime-factorization"],
  ["17|소인수분해를 이용하여 약수 구하기|1", "m1-divisors"],
  ["30|공약수와 최대공약수|1", "m1-gcd"],
  ["30|공약수와 최대공약수|2", "m1-gcd"],
  ["35|공배수와 최소공배수|1", "m1-lcm"],
  ["35|공배수와 최소공배수|2", "m1-lcm"],
  /* 개념3 「최대공약수와 최소공배수의 관계」는 제목이 질문형이 아니라
   * 예전 파서가 통째로 놓쳤다. 두 개념을 함께 쓰지만 자료는 한 곳에만
   * 걸 수 있으므로, 뒤에 배우는 최소공배수 쪽에 둔다. */
  ["35|공배수와 최소공배수|3", "m1-lcm"],
]);

/** II. 정수와 유리수 — 개념서 p.50·51·56·70·71·81·89 */
export const KWR_M11_CH2_TARGETS: ReadonlyMap<string, string> = new Map([
  ["50|정수와 유리수|1", "m1-integers-rationals"],
  ["50|정수와 유리수|2", "m1-integers-rationals"],
  ["51|정수와 유리수|3", "m1-integers-rationals"],
  ["51|정수와 유리수|4", "m1-integers-rationals"],
  ["56|수의 대소 관계|1", "m1-rational-order"],
  ["56|수의 대소 관계|2", "m1-rational-order"],
  ["56|수의 대소 관계|3", "m1-rational-order"],
  ["70|유리수의 덧셈과 뺄셈|1", "m1-rational-arithmetic"],
  ["70|유리수의 덧셈과 뺄셈|2", "m1-rational-arithmetic"],
  ["71|유리수의 덧셈과 뺄셈|3", "m1-rational-arithmetic"],
  ["71|유리수의 덧셈과 뺄셈|4", "m1-rational-arithmetic"],
  ["71|유리수의 덧셈과 뺄셈|5", "m1-rational-arithmetic"],
  ["81|유리수의 곱셈|1", "m1-rational-arithmetic"],
  ["81|유리수의 곱셈|2", "m1-rational-arithmetic"],
  ["89|유리수의 곱셈|3", "m1-rational-arithmetic"],
  /* 네 연산이 섞인 계산 — RPM의 「덧셈 뺄셈 곱셈 나눗셈의 혼합 계산」과
   * 같은 자리다. 곱셈·나눗셈이 아니라 혼합 계산 개념에 건다. */
  ["89|유리수의 곱셈|4", "m1-rational-arithmetic"],
]);

/** III. 문자와 식 — 개념서 p.104·105·111·117·132·133·139·156·163 */
export const KWR_M11_CH3_TARGETS: ReadonlyMap<string, string> = new Map([
  ["104|문자의 사용|1", "m1-algebraic-expressions"],
  ["104|문자의 사용|2", "m1-algebraic-expressions"],
  ["105|문자의 사용|3", "m1-algebraic-expressions"],
  /* p.111은 「일차식의 계산 (1)」, p.117은 「(2)」 — 제목만으로는 못 가른다 */
  ["111|일차식의 계산|1", "m1-linear-expression-ops"],
  ["111|일차식의 계산|2", "m1-linear-expression-ops"],
  ["117|일차식의 계산|1", "m1-linear-expression-ops"],
  ["117|일차식의 계산|2", "m1-linear-expression-ops"],
  ["132|방정식과 그 해|1", "m1-equation-basics"],
  ["132|방정식과 그 해|2", "m1-equation-basics"],
  ["132|방정식과 그 해|3", "m1-equation-basics"],
  ["133|방정식과 그 해|4", "m1-equation-basics"],
  ["139|일차방정식의 풀이|1", "m1-linear-equation"],
  ["139|일차방정식의 풀이|2", "m1-linear-equation"],
  ["139|일차방정식의 풀이|3", "m1-linear-equation"],
  /* p.156은 「일차방정식의 활용 (1)」, p.163은 「(2)」 */
  ["156|일차방정식의 활용|1", "m1-linear-equation"],
  ["156|일차방정식의 활용|2", "m1-linear-equation"],
  ["163|일차방정식의 활용|1", "m1-linear-equation"],
  ["163|일차방정식의 활용|2", "m1-linear-equation"],
]);

/** IV. 좌표평면과 그래프 — 개념서 p.176·177·184·198·208 */
export const KWR_M11_CH4_TARGETS: ReadonlyMap<string, string> = new Map([
  ["176|순서쌍과 좌표|1", "m1-coordinates"],
  ["176|순서쌍과 좌표|2", "m1-coordinates"],
  ["176|순서쌍과 좌표|3", "m1-coordinates"],
  ["177|순서쌍과 좌표|4", "m1-coordinates"],
  ["184|그래프와 그 해석|1", "m1-graphs"],
  ["184|그래프와 그 해석|2", "m1-graphs"],
  ["198|정비례|1", "m1-proportionality"],
  ["198|정비례|2", "m1-proportionality"],
  ["198|정비례|3", "m1-proportionality"],
  ["208|반비례|1", "m1-proportionality"],
  ["208|반비례|2", "m1-proportionality"],
  ["208|반비례|3", "m1-proportionality"],
]);

/* ── 개념원리 중2-1 (교사용 224쪽) ──────────────────────────────
 *
 * 쪽 목록은 `concept-page-scan`으로 뽑고 제목을 눈으로 확인한 값이다.
 * 이어지는 쪽(37·67·83·131·169·179)은 개념 하나가 다음 쪽까지 흐르는
 * 자리라 홀로 스캔하면 잡히지 않는다 — 짝으로 돌려야 나온다.
 * ───────────────────────────────────────────────────────────── */

/** I. 유리수와 순환소수 — 개념서 p.10·15·21 */
export const KWR_M21_CH1_TARGETS: ReadonlyMap<string, string> = new Map([
  ["10|유리수와 소수|1", "m2-repeating-decimals"],
  ["10|유리수와 소수|2", "m2-repeating-decimals"],
  ["10|유리수와 소수|3", "m2-repeating-decimals"],
  ["15|유한소수로 나타낼 수 있는 분수|1", "m2-repeating-decimals"],
  ["15|유한소수로 나타낼 수 있는 분수|2", "m2-repeating-decimals"],
  ["21|순환소수를 분수로 나타내기|1", "m2-repeating-decimals"],
  ["21|순환소수를 분수로 나타내기|2", "m2-repeating-decimals"],
]);

/** II. 식의 계산 — 개념서 p.36·37·46·60·66·67 */
export const KWR_M21_CH2_TARGETS: ReadonlyMap<string, string> = new Map([
  ["36|지수법칙|1", "m2-exponent-laws"],
  ["36|지수법칙|2", "m2-exponent-laws"],
  ["36|지수법칙|3", "m2-exponent-laws"],
  ["37|지수법칙|4", "m2-exponent-laws"],
  ["37|지수법칙|5", "m2-exponent-laws"],
  ["46|단항식의 곱셈과 나눗셈|1", "m2-monomial-polynomial-ops"],
  ["46|단항식의 곱셈과 나눗셈|2", "m2-monomial-polynomial-ops"],
  ["46|단항식의 곱셈과 나눗셈|3", "m2-monomial-polynomial-ops"],
  ["60|다항식의 덧셈과 뺄셈|1", "m2-polynomial-add-sub"],
  ["60|다항식의 덧셈과 뺄셈|2", "m2-polynomial-add-sub"],
  ["66|단항식과 다항식의 곱셈과 나눗셈|1", "m2-monomial-polynomial-ops"],
  ["66|단항식과 다항식의 곱셈과 나눗셈|2", "m2-monomial-polynomial-ops"],
  ["67|단항식과 다항식의 곱셈과 나눗셈|3", "m2-monomial-polynomial-ops"],
]);

/** III. 일차부등식 — 개념서 p.82·83·89·106·113 */
export const KWR_M21_CH3_TARGETS: ReadonlyMap<string, string> = new Map([
  ["82|부등식과 그 성질|1", "m2-inequality-basics"],
  ["82|부등식과 그 성질|2", "m2-inequality-basics"],
  ["83|부등식과 그 성질|3", "m2-inequality-basics"],
  ["89|일차부등식의 풀이|1", "m2-linear-inequality"],
  ["89|일차부등식의 풀이|2", "m2-linear-inequality"],
  ["89|일차부등식의 풀이|3", "m2-linear-inequality"],
  /* 106과 113은 소단원 제목이 「일차부등식의 활용 ⑴·⑵」로 같은데
   * 원문자가 다른 글꼴이라 제목에서 빠진다 — 쪽이 열쇠에 있어 갈린다 */
  ["106|일차부등식의 활용|1", "m2-linear-inequality"],
  ["106|일차부등식의 활용|2", "m2-linear-inequality"],
  ["113|일차부등식의 활용|1", "m2-linear-inequality"],
  ["113|일차부등식의 활용|2", "m2-linear-inequality"],
]);

/** IV. 연립일차방정식 — 개념서 p.124·130·131·150·157 */
export const KWR_M21_CH4_TARGETS: ReadonlyMap<string, string> = new Map([
  ["124|연립방정식과 그 해|1", "m2-simeq-intro"],
  ["124|연립방정식과 그 해|2", "m2-simeq-intro"],
  ["130|연립일차방정식의 풀이|1", "m2-simeq-substitution"], // 대입법
  ["130|연립일차방정식의 풀이|2", "m2-simeq-elimination"], // 가감법
  /* 복잡한 연립·A=B=C 꼴·해가 특수한 경우는 전부 가감법으로 푼다 */
  ["131|연립일차방정식의 풀이|3", "m2-simeq-elimination"],
  ["131|연립일차방정식의 풀이|4", "m2-simeq-elimination"],
  ["131|연립일차방정식의 풀이|5", "m2-simeq-elimination"],
  ["150|연립일차방정식의 활용|1", "m2-simeq-application"],
  ["150|연립일차방정식의 활용|2", "m2-simeq-application"],
  ["157|연립일차방정식의 활용|1", "m2-simeq-application"],
  ["157|연립일차방정식의 활용|2", "m2-simeq-application"],
]);

/** V. 일차함수 — 개념서 p.168·169·178·179·185·190·195·208·214 */
export const KWR_M21_CH5_TARGETS: ReadonlyMap<string, string> = new Map([
  ["168|일차함수와 그 그래프|1", "m2-function-concept"], // 함수란 무엇인가
  ["168|일차함수와 그 그래프|2", "m2-function-concept"], // 함숫값이란 무엇인가
  ["169|일차함수와 그 그래프|3", "m2-linear-fn-intro"], // 일차함수란 무엇인가
  ["169|일차함수와 그 그래프|4", "m2-linear-fn-graph"], // 그래프는 어떻게 그리는가
  ["178|일차함수의 그래프의 절편과 기울기|1", "m2-linear-fn-graph"],
  ["178|일차함수의 그래프의 절편과 기울기|2", "m2-linear-fn-graph"],
  ["179|일차함수의 그래프의 절편과 기울기|3", "m2-linear-fn-graph"],
  ["179|일차함수의 그래프의 절편과 기울기|4", "m2-linear-fn-graph"],
  ["185|일차함수의 그래프의 성질|1", "m2-linear-fn-properties"],
  ["185|일차함수의 그래프의 성질|2", "m2-linear-fn-properties"],
  ["190|일차함수의 식 구하기|1", "m2-linear-fn-properties"],
  ["195|일차함수의 활용|1", "m2-linear-fn-properties"],
  ["195|일차함수의 활용|2", "m2-linear-fn-properties"],
  ["208|일차함수와 일차방정식|1", "m2-linear-fn-vs-equation"],
  ["208|일차함수와 일차방정식|2", "m2-linear-fn-vs-equation"],
  ["214|일차방정식의 그래프와 연립방정식의 해|1", "m2-linear-fn-vs-simeq"],
  ["214|일차방정식의 그래프와 연립방정식의 해|2", "m2-linear-fn-vs-simeq"],
]);

/* ── 개념원리 중2-2 (교사용 232쪽) ────────────────────────────── */

/** I. 삼각형의 성질 — 개념서 p.10·11·18·19·34·35·40·41 */
export const KWR_M22_CH1_TARGETS: ReadonlyMap<string, string> = new Map([
  ["10|이등변삼각형의 성질|1", "m2-isosceles-right-triangles"],
  ["10|이등변삼각형의 성질|2", "m2-isosceles-right-triangles"],
  ["10|이등변삼각형의 성질|3", "m2-isosceles-right-triangles"],
  ["11|이등변삼각형의 성질|4", "m2-isosceles-right-triangles"],
  ["18|직각삼각형의 합동 조건|1", "m2-isosceles-right-triangles"],
  ["19|직각삼각형의 합동 조건|2", "m2-isosceles-right-triangles"],
  ["34|삼각형의 외심|1", "m2-circumcenter-incenter"],
  ["34|삼각형의 외심|2", "m2-circumcenter-incenter"],
  ["35|삼각형의 외심|3", "m2-circumcenter-incenter"],
  ["40|삼각형의 내심|1", "m2-circumcenter-incenter"],
  ["40|삼각형의 내심|2", "m2-circumcenter-incenter"],
  ["41|삼각형의 내심|3", "m2-circumcenter-incenter"],
]);

/** II. 사각형의 성질 — 개념서 p.56·62·63·78·79·86·91 */
export const KWR_M22_CH2_TARGETS: ReadonlyMap<string, string> = new Map([
  ["56|평행사변형의 성질|1", "m2-quadrilateral-properties"],
  ["56|평행사변형의 성질|2", "m2-quadrilateral-properties"],
  ["62|평행사변형이 되는 조건|1", "m2-quadrilateral-properties"],
  ["63|평행사변형이 되는 조건|2", "m2-quadrilateral-properties"],
  ["63|평행사변형이 되는 조건|3", "m2-quadrilateral-properties"],
  ["78|여러 가지 사각형|1", "m2-quadrilateral-properties"],
  ["78|여러 가지 사각형|2", "m2-quadrilateral-properties"],
  ["79|여러 가지 사각형|3", "m2-quadrilateral-properties"],
  ["79|여러 가지 사각형|4", "m2-quadrilateral-properties"],
  ["86|여러 가지 사각형 사이의 관계|1", "m2-quadrilateral-properties"],
  ["86|여러 가지 사각형 사이의 관계|2", "m2-quadrilateral-properties"],
  ["91|평행선과 넓이|1", "m2-quadrilateral-properties"],
  ["91|평행선과 넓이|2", "m2-quadrilateral-properties"],
]);

/** III. 도형의 닮음과 피타고라스 정리 — 개념서 p.104·105·112·113·128·133·137·150·156·157·172·173·179 */
export const KWR_M22_CH3_TARGETS: ReadonlyMap<string, string> = new Map([
  ["104|닮음과 닮은 도형|1", "m2-similarity-basics"],
  ["104|닮음과 닮은 도형|2", "m2-similarity-basics"],
  ["105|닮음과 닮은 도형|3", "m2-similarity-basics"],
  ["105|닮음과 닮은 도형|4", "m2-similarity-basics"],
  ["112|삼각형의 닮음 조건|1", "m2-triangle-similarity"],
  ["113|삼각형의 닮음 조건|2", "m2-triangle-similarity"],
  ["113|삼각형의 닮음 조건|3", "m2-triangle-similarity"],
  ["128|삼각형과 평행선|1", "m2-parallel-segments"],
  ["133|삼각형의 각의 이등분선|1", "m2-parallel-segments"],
  ["133|삼각형의 각의 이등분선|2", "m2-parallel-segments"],
  ["137|평행선 사이의 선분의 길이의 비|1", "m2-parallel-segments"],
  ["137|평행선 사이의 선분의 길이의 비|2", "m2-parallel-segments"],
  ["137|평행선 사이의 선분의 길이의 비|3", "m2-parallel-segments"],
  ["150|삼각형의 두 변의 중점을 연결한 선분|1", "m2-parallel-segments"],
  ["150|삼각형의 두 변의 중점을 연결한 선분|2", "m2-parallel-segments"],
  /* 무게중심은 정본 목록에 따로 없다 — 중점연결정리와 같은 성취기준이다 */
  ["156|삼각형의 무게중심|1", "m2-parallel-segments"],
  ["156|삼각형의 무게중심|2", "m2-parallel-segments"],
  ["157|삼각형의 무게중심|3", "m2-parallel-segments"],
  ["172|피타고라스 정리|1", "m2-pythagorean"],
  ["172|피타고라스 정리|2", "m2-pythagorean"],
  ["173|피타고라스 정리|3", "m2-pythagorean"],
  ["173|피타고라스 정리|4", "m2-pythagorean"],
  ["179|피타고라스 정리의 활용|1", "m2-pythagorean"],
  ["179|피타고라스 정리의 활용|2", "m2-pythagorean"],
]);

/** IV. 확률 — 개념서 p.190·196·197·212·213·220 */
export const KWR_M22_CH4_TARGETS: ReadonlyMap<string, string> = new Map([
  ["190|경우의 수|1", "m2-counting"],
  ["190|경우의 수|2", "m2-counting"],
  ["190|경우의 수|3", "m2-counting"],
  ["196|여러 가지 경우의 수|1", "m2-counting"],
  ["196|여러 가지 경우의 수|2", "m2-counting"],
  ["197|여러 가지 경우의 수|3", "m2-counting"],
  ["197|여러 가지 경우의 수|4", "m2-counting"],
  ["212|확률의 뜻과 성질|1", "m2-probability"],
  ["212|확률의 뜻과 성질|2", "m2-probability"],
  ["212|확률의 뜻과 성질|3", "m2-probability"],
  ["213|확률의 뜻과 성질|4", "m2-probability"],
  ["213|확률의 뜻과 성질|5", "m2-probability"],
  ["220|확률의 계산|1", "m2-probability"],
  ["220|확률의 계산|2", "m2-probability"],
  ["220|확률의 계산|3", "m2-probability"],
]);

/* ── 개념원리 중3-1 (교사용 224쪽) ────────────────────────────── */

/** I. 실수와 그 연산 — 개념서 p.10·15·22·23·38·46 */
export const KWR_M31_CH1_TARGETS: ReadonlyMap<string, string> = new Map([
  ["10|제곱근의 뜻과 표현|1", "m3-square-root"],
  ["10|제곱근의 뜻과 표현|2", "m3-square-root"],
  ["15|제곱근의 성질|1", "m3-square-root"],
  ["15|제곱근의 성질|2", "m3-square-root"],
  ["15|제곱근의 성질|3", "m3-square-root"],
  ["22|무리수와 실수|1", "m3-irrational-numbers"],
  ["22|무리수와 실수|2", "m3-irrational-numbers"],
  ["22|무리수와 실수|3", "m3-irrational-numbers"],
  ["23|무리수와 실수|4", "m3-irrational-numbers"],
  ["23|무리수와 실수|5", "m3-real-order"], // 실수의 대소 관계
  ["23|무리수와 실수|6", "m3-real-order"], // 제곱근표
  ["38|제곱근의 곱셈과 나눗셈|1", "m3-radical-arithmetic"],
  ["38|제곱근의 곱셈과 나눗셈|2", "m3-radical-arithmetic"],
  ["38|제곱근의 곱셈과 나눗셈|3", "m3-radical-arithmetic"],
  ["46|제곱근의 덧셈과 뺄셈|1", "m3-radical-arithmetic"],
  ["46|제곱근의 덧셈과 뺄셈|2", "m3-radical-arithmetic"],
  ["46|제곱근의 덧셈과 뺄셈|3", "m3-radical-arithmetic"],
]);

/** II. 다항식의 곱셈과 인수분해 — 개념서 p.62·63·71·84·89·96 */
export const KWR_M31_CH2_TARGETS: ReadonlyMap<string, string> = new Map([
  ["62|곱셈 공식|1", "m3-poly-multiplication"],
  ["62|곱셈 공식|2", "m3-poly-multiplication"],
  ["62|곱셈 공식|3", "m3-poly-multiplication"],
  ["63|곱셈 공식|4", "m3-poly-multiplication"],
  ["63|곱셈 공식|5", "m3-poly-multiplication"],
  ["71|곱셈 공식의 응용|1", "m3-poly-multiplication"],
  ["71|곱셈 공식의 응용|2", "m3-poly-multiplication"],
  ["71|곱셈 공식의 응용|3", "m3-poly-multiplication"],
  ["84|인수분해 공식|1", "m3-factorization"],
  ["84|인수분해 공식|2", "m3-factorization"],
  ["84|인수분해 공식|3", "m3-factorization"],
  ["84|인수분해 공식|4", "m3-factorization"],
  /* p.89는 「인수분해 공식 ⑵」인데 원문자가 제목에서 빠져 p.84와 소단원
   * 이름이 같다 — 쪽이 열쇠에 있어 갈린다 */
  ["89|인수분해 공식|1", "m3-factorization"],
  ["89|인수분해 공식|2", "m3-factorization"],
  ["96|인수분해 공식의 응용|1", "m3-factorization"],
  ["96|인수분해 공식의 응용|2", "m3-factorization"],
  ["96|인수분해 공식의 응용|3", "m3-factorization"],
]);

/** III. 이차방정식 — 개념서 p.110·115·122·136·142·147 */
export const KWR_M31_CH3_TARGETS: ReadonlyMap<string, string> = new Map([
  ["110|이차방정식과 그 해|1", "m3-quadratic-equation"],
  ["110|이차방정식과 그 해|2", "m3-quadratic-equation"],
  ["115|인수분해를 이용한 이차방정식의 풀이|1", "m3-quadratic-equation"],
  ["115|인수분해를 이용한 이차방정식의 풀이|2", "m3-quadratic-equation"],
  ["122|제곱근을 이용한 이차방정식의 풀이|1", "m3-quadratic-equation"],
  ["122|제곱근을 이용한 이차방정식의 풀이|2", "m3-quadratic-equation"],
  ["136|이차방정식의 근의 공식|1", "m3-quadratic-equation"],
  ["136|이차방정식의 근의 공식|2", "m3-quadratic-equation"],
  ["142|이차방정식의 근의 개수|1", "m3-quadratic-equation"],
  ["142|이차방정식의 근의 개수|2", "m3-quadratic-equation"],
  ["147|이차방정식의 활용|1", "m3-quadratic-equation"],
  ["147|이차방정식의 활용|2", "m3-quadratic-equation"],
]);

/**
 * IV. 이차함수 — 개념서 p.162·163·170·176·190·191·199·204·209
 *
 * 소단원 이름이 전부 「이차함수 y=ax²의 그래프」 꼴이라 수식이 빠지면
 * 「이차함수 의 그래프」로 똑같아진다. 쪽이 열쇠에 있어 갈린다.
 */
export const KWR_M31_CH4_TARGETS: ReadonlyMap<string, string> = new Map([
  ["162|이차함수 의 그래프|1", "m3-quadratic-fn-concept"], // 이차함수란 무엇인가
  ["162|이차함수 의 그래프|2", "m3-quadratic-fn-graph"],
  ["163|이차함수 의 그래프|3", "m3-quadratic-fn-graph"],
  ["163|이차함수 의 그래프|4", "m3-quadratic-fn-graph"],
  ["170|이차함수 의 그래프|1", "m3-quadratic-fn-graph"],
  ["170|이차함수 의 그래프|2", "m3-quadratic-fn-graph"],
  ["176|이차함수 의 그래프|1", "m3-quadratic-fn-graph"],
  ["176|이차함수 의 그래프|2", "m3-quadratic-fn-graph"],
  ["190|이차함수 의 그래프|1", "m3-quadratic-fn-graph"],
  ["191|이차함수 의 그래프|2", "m3-quadratic-fn-graph"],
  ["199|이차함수의 식 구하기|1", "m3-quadratic-fn-graph"],
  ["199|이차함수의 식 구하기|2", "m3-quadratic-fn-graph"],
  ["199|이차함수의 식 구하기|3", "m3-quadratic-fn-graph"],
  ["199|이차함수의 식 구하기|4", "m3-quadratic-fn-graph"],
  ["204|이차함수의 최댓값과 최솟값|1", "m3-quadratic-fn-graph"],
  ["204|이차함수의 최댓값과 최솟값|2", "m3-quadratic-fn-graph"],
  ["209|이차함수의 활용|1", "m3-quadratic-fn-graph"],
]);

/* ── 개념원리 중3-2 (교사용 144쪽) ────────────────────────────── */

/** I. 삼각비 — 개념서 p.10·21·36·37·44·45 */
export const KWR_M32_CH1_TARGETS: ReadonlyMap<string, string> = new Map([
  ["10|삼각비|1", "m3-trig-ratio"],
  ["21|임의의 예각의 삼각비의 값|1", "m3-trig-ratio"],
  ["21|임의의 예각의 삼각비의 값|2", "m3-trig-ratio"],
  ["21|임의의 예각의 삼각비의 값|3", "m3-trig-ratio"],
  ["36|길이 구하기|1", "m3-trig-applications"],
  ["36|길이 구하기|2", "m3-trig-applications"],
  ["37|길이 구하기|3", "m3-trig-applications"],
  ["44|넓이 구하기|1", "m3-trig-applications"],
  ["45|넓이 구하기|2", "m3-trig-applications"],
]);

/** II. 원의 성질 — 개념서 p.58·59·65·71·84·85·93·100 */
export const KWR_M32_CH2_TARGETS: ReadonlyMap<string, string> = new Map([
  ["58|원의 현|1", "m3-circle-chords-tangents"],
  ["59|원의 현|2", "m3-circle-chords-tangents"],
  /* p.65는 「원의 접선 ⑴」, p.71은 「⑵」 — 원문자가 제목에서 빠진다 */
  ["65|원의 접선|1", "m3-circle-chords-tangents"],
  ["71|원의 접선|1", "m3-circle-chords-tangents"],
  ["71|원의 접선|2", "m3-circle-chords-tangents"],
  ["84|원주각|1", "m3-inscribed-angle"],
  ["85|원주각|2", "m3-inscribed-angle"],
  ["85|원주각|3", "m3-inscribed-angle"],
  ["93|원과 사각형|1", "m3-inscribed-angle"],
  ["93|원과 사각형|2", "m3-inscribed-angle"],
  ["93|원과 사각형|3", "m3-inscribed-angle"],
  ["100|접선과 현이 이루는 각|1", "m3-inscribed-angle"],
  ["100|접선과 현이 이루는 각|2", "m3-inscribed-angle"],
]);

/** III. 통계 — 개념서 p.114·126·132 */
export const KWR_M32_CH3_TARGETS: ReadonlyMap<string, string> = new Map([
  ["114|산포도와 표준편차|1", "m3-dispersion"],
  ["114|산포도와 표준편차|2", "m3-dispersion"],
  ["126|상자그림|1", "m3-box-plot"],
  ["126|상자그림|2", "m3-box-plot"],
  ["132|산점도와 상관관계|1", "m3-scatter-correlation"],
  ["132|산점도와 상관관계|2", "m3-scatter-correlation"],
]);
