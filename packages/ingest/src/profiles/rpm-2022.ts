import type { ExtractionProfile } from "./types";

/* ─────────────────────────────────────────────────────────────
 * 개념원리 RPM (2022 개정) — 중학 수학 학생용
 *
 * 아래 값은 전부 실제 PDF의 텍스트 레이어를 열어 확인한 것이다.
 * (22개정 RPM 중 1-1 학생용.pdf, 184쪽)
 *
 * 이 교재의 특징 — 다른 교재를 붙일 때 비교 기준이 된다:
 *   · 2단 조판. 왼쪽 단을 끝까지 읽고 오른쪽 단으로 간다.
 *   · **수식과 한글이 폰트로 완전히 갈린다.** 수식은 EH* 계열(EHsang-Italic
 *     등), 한글 본문은 YDVY*·SMSS* 계열이다. 그래서 수식 구간을 추측할
 *     필요가 없다 — 이게 이 교재가 반입하기 쉬운 가장 큰 이유다.
 *   · 문항 번호는 DINPro-Bold 14pt이고 "0"과 "131"처럼 두 span으로 쪼개져
 *     들어온다. 붙인 뒤에 판정해야 한다.
 *   · 난이도 뱃지(대표문제·중하·중·상)는 **텍스트가 아니라 벡터 그림**이다.
 *     텍스트 레이어에서 뽑을 수 없다 — 검수 때 사람이 지정하거나 위치로
 *     추정해야 한다.
 *   · 도형·그래프는 래스터가 아니라 벡터다(쪽당 평균 244개 path).
 * ───────────────────────────────────────────────────────────── */

export const RPM_2022: ExtractionProfile = {
  id: "rpm-2022",
  version: "1.0.0",
  label: "개념원리 RPM (2022 개정) 학생용",
  appliesTo: "RPM 중학 수학 시리즈 · 2022 개정 교육과정 · 학생용 본책",

  layout: {
    columns: 2,
    /* 여백선은 실측으로 잡았다. 홀수 쪽 위에는 「정답 및 풀이 9쪽」이
     * y1=46.8까지, 짝수 쪽 아래에는 러닝헤드가 y0=791.3부터 온다.
     * 본문이 가장 아래까지 내려간 값은 771.8(p.8)이므로 그 사이를 딴다. */
    topMarginRatio: 0.06, // 50.5pt
    bottomMarginRatio: 0.925, // 778.7pt
    /* 수식 span은 한글보다 2pt 남짓 위에 앉는다(p.20 y=346 대 348).
     * 4pt면 그 차이는 흡수하고 다음 줄(간격 15pt 이상)과는 섞이지 않는다. */
    lineToleranceY: 4,
  },

  fonts: {
    /* NPSUSP은 도형 기호 전용 글꼴이다 — `s`가 △, `f`가 □ (본책 p.40
     * 「□ABCD와 같이 나타낸다」). 본문 글꼴로 두면 발문이 「s ABC」가 된다. */
    math: /^(EH|NPSUSP)/,
    /* 도형 안의 글자는 이 글꼴로 온다 — 코드가 0x1F 밀려 있는 그 글꼴이다.
     * 이름이 두 꼴이다: 중2-2는 KSCms-UHC, 중1-2는 KSCpc-EUC. 하나만 적으면
     * 다른 권의 도형 치수가 통째로 사라지고 오류는 나지 않는다. */
    figureLabel: /KSC(ms-UHC|pc-EUC)/,
    questionNumber: { font: /DINPro-Bold/, minSize: 12 },
    choiceMarker: /SMSSMyungJo/,
    typeLabel: /SDGogoRound/,
    typeNumber: /ITCAvantGarde/,
    typeTitle: /YDVYGOStd14/,
    textbookRef: /YDVYGOStd1[13]/,
    conditionLabel: /YDVYGOStd13/,
    /* 쪽 번호 전용 폰트. 러닝헤드를 여백 비율만으로 거르면 쪽마다 위치가
     * 달라 놓친다(홀수 쪽은 위, 짝수 쪽은 아래). 이 폰트가 든 줄은
     * 통째로 문항이 아니다. */
    pageNumber: /DINMittelschrift/,
    /* 중단원 번호. 홀수 쪽 러닝헤드가 「02 최대공약수와 최소공배수」로
     * 중단원을 알려 준다 — 「중단원 마무리」 쪽에는 유형 머리글이 아예
     * 없어서 이것이 유일한 계층 단서다. */
    unitNumber: /DINPro-Medium/,
    inlineFraction: /EHboNA/,
  },

  patterns: {
    questionNumber: /^\d{4}$/,
    choiceMarker: /^[①②③④⑤]$/,
    conditionLabel: /^(보기|조건)$/,
    textbookRef: /중학 수학\s*\d\s*-\s*\d\s*\d+쪽/,
    runningHead: /^\s*\d+\s+[IVX]+\s*[.·]/,
    /* 구매자 식별 워터마크. 이 PDF는 쪽마다 **구매자 이메일 주소**를
     * 텍스트 레이어에 심어 두었다(p.30·p.33 등에서 확인). 문항 본문에
     * 섞여 들어가면 그대로 DB에 저장되고 학생 화면까지 간다.
     * 문항이 아니므로 반드시 걸러 낸다. */
    purchaserStamp: /[\w.+-]+@[\w-]+\.[\w.-]+/,
    /* 공통 지시문 — 「[0023~0030] 다음 수를 소인수분해하시오.」
     * 「개념 익히기」 쪽은 지시문을 한 번만 쓰고 그 아래 문항은 숫자만
     * 적는다. 지시문을 안 붙이면 발문이 「24」 하나뿐인 문항이 된다. */
    sharedInstruction: /\[\s*(\d{4})\s*~\s*(\d{4})\s*\]/,
  },

  figures: {
    minDrawings: 12,
    clusterGap: 14,
    minWidth: 28,
    minHeight: 28,
  },
};
