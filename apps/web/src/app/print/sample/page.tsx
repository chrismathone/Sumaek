import type { Metadata } from "next";
import {
  ExamPaper,
  type ExamPaperQuestion,
} from "@/components/print/ExamPaper";

export const metadata: Metadata = {
  title: "인쇄 미리보기 샘플",
  robots: { index: false },
};

/**
 * 인쇄 파이프라인 검증용 샘플 시험지 — 합성 문항 (시드와 동일 세트).
 * PDF 출력 워커·시각 회귀 테스트의 골든 대상이다.
 */
const SAMPLE_QUESTIONS: ExamPaperQuestion[] = [
  {
    number: 1,
    kind: "multiple_choice",
    points: 10,
    body: "다음 중 미지수가 2개인 일차방정식인 것을 고르시오.",
    choices: [
      { choiceId: "c1", order: 1, text: "$x^2+y=3$" },
      { choiceId: "c2", order: 2, text: "$2x+y=7$" },
      { choiceId: "c3", order: 3, text: "$x+3=8$" },
      { choiceId: "c4", order: 4, text: "$xy=6$" },
    ],
  },
  {
    number: 2,
    kind: "short_answer",
    points: 10,
    body: "연립방정식 $\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}$ 의 해를 구하시오.",
  },
  {
    number: 3,
    kind: "short_answer",
    points: 10,
    body: "연립방정식 $\\begin{cases} y=2x-1 \\\\ 3x+y=9 \\end{cases}$ 를 대입법으로 풀 때, $x$의 값을 구하시오.",
  },
  {
    number: 4,
    kind: "multiple_choice",
    points: 10,
    body: "두 분수의 합 $\\frac{1}{2} + \\frac{1}{3}$ 의 값은?",
    choices: [
      { choiceId: "c1", order: 1, text: "$\\frac{2}{5}$" },
      { choiceId: "c2", order: 2, text: "$\\frac{5}{6}$" },
      { choiceId: "c3", order: 3, text: "$\\frac{1}{6}$" },
      { choiceId: "c4", order: 4, text: "$\\frac{1}{5}$" },
      { choiceId: "c5", order: 5, text: "$1$" },
    ],
  },
  {
    number: 5,
    kind: "short_answer",
    points: 10,
    body: "농도가 $5\\%$인 소금물과 $10\\%$인 소금물을 섞어 농도가 $8\\%$인 소금물 $300\\,\\mathrm{g}$을 만들려고 한다. $5\\%$ 소금물의 양을 구하시오.",
  },
  {
    number: 6,
    kind: "short_answer",
    points: 10,
    body: "$\\overline{AB} = 6\\,\\mathrm{cm}$, $\\angle ABC = 60^\\circ$인 삼각형에서 $\\triangle ABC$의 조건을 만족하는 점 $C$의 위치에 대해, 합이 $27$이고 차가 $5$인 두 자연수 중 큰 수를 구하시오.",
  },
  {
    number: 7,
    kind: "short_answer",
    points: 10,
    body: "극한 $$\\lim_{n \\to \\infty} \\frac{3n^2 + n}{n^2 - 2} $$ 의 값을 구하시오.",
  },
  {
    number: 8,
    kind: "short_answer",
    points: 10,
    body: "합 $$\\sum_{k=1}^{10} k = ?$$",
  },
];

export default function SamplePrintPage() {
  return (
    <ExamPaper
      organizationName="수맥 데모 학원"
      title="중2 심화 A — 일일테스트"
      subtitle="연립방정식 활용 · 2026년 8월 3일"
      timeLimitMinutes={15}
      questions={SAMPLE_QUESTIONS}
    />
  );
}
