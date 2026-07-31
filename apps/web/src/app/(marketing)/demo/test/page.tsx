import type { Metadata } from "next";
import Link from "next/link";
import { renderMixedText } from "@su-maek/core/math";
import { TestRunner } from "@/components/runner/TestRunner";
import type { RunnerQuestion } from "@/components/runner/types";

export const metadata: Metadata = {
  title: "일일테스트 체험",
  description: "샘플 일일테스트를 응시하고 즉시 채점을 체험합니다.",
};

/** 서버에서 게시 모드로 사전 렌더 — 실패 수식이 있으면 빌드가 실패한다 (게이트) */
function publish(text: string): string {
  const { html, failures } = renderMixedText(text, "publish");
  if (failures.length > 0) {
    throw new Error(`수식 게이트 위반: ${failures[0]}`);
  }
  return html;
}

const QUESTIONS: RunnerQuestion[] = [
  {
    questionId: "demo-1",
    number: 1,
    kind: "multiple_choice",
    points: 10,
    conceptName: "연립일차방정식의 뜻",
    bodyHtml: publish("다음 중 미지수가 2개인 일차방정식인 것을 고르시오."),
    choices: [
      { choiceId: "c1", order: 1, html: publish("$x^2+y=3$") },
      { choiceId: "c2", order: 2, html: publish("$2x+y=7$") },
      { choiceId: "c3", order: 3, html: publish("$x+3=8$") },
      { choiceId: "c4", order: 4, html: publish("$xy=6$") },
    ],
    answerKey: { kind: "multiple_choice", correctChoiceIds: ["c2"] },
  },
  {
    questionId: "demo-2",
    number: 2,
    kind: "short_answer",
    points: 10,
    conceptName: "가감법",
    bodyHtml: publish(
      "연립방정식 $\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}$ 의 해가 $(a, b)$일 때, $a$의 값을 구하시오.",
    ),
    answerKey: {
      kind: "short_answer",
      accepted: [{ value: "3", form: "number", allowEquivalence: true }],
    },
  },
  {
    questionId: "demo-3",
    number: 3,
    kind: "short_answer",
    points: 10,
    conceptName: "대입법",
    bodyHtml: publish(
      "연립방정식 $\\begin{cases} y=2x-1 \\\\ 3x+y=9 \\end{cases}$ 를 대입법으로 풀 때, $x$의 값을 구하시오.",
    ),
    answerKey: {
      kind: "short_answer",
      accepted: [{ value: "2", form: "number", allowEquivalence: true }],
    },
  },
  {
    questionId: "demo-4",
    number: 4,
    kind: "short_answer",
    points: 10,
    conceptName: "분수의 계산 (복습)",
    bodyHtml: publish("$\\frac{1}{2} + \\frac{1}{3}$ 의 값을 구하시오."),
    answerKey: {
      kind: "short_answer",
      accepted: [{ value: "5/6", form: "fraction", allowEquivalence: true }],
    },
  },
  {
    questionId: "demo-5",
    number: 5,
    kind: "short_answer",
    points: 10,
    conceptName: "연립방정식의 활용",
    bodyHtml: publish(
      "합이 $27$이고 차가 $5$인 두 자연수 중 큰 수를 구하시오.",
    ),
    answerKey: {
      kind: "short_answer",
      accepted: [{ value: "16", form: "number", allowEquivalence: true }],
    },
  },
];

export default function DemoTestPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 lg:px-6">
      <p className="font-mono text-sm text-pen">샘플 반 체험 — 학생 화면</p>
      <h1 className="mt-2 font-[MaruBuri] text-2xl font-semibold">
        일일테스트 · 연립방정식
      </h1>
      <p className="mt-2 text-sm text-ink-soft">
        5문항 · 제한 시간 5분 · 임시 저장과 즉시 채점을 체험해 보세요. 분수
        답은 <code className="font-mono">5/6</code>이나{" "}
        <code className="font-mono">0.5</code>처럼 어떤 동치 표기든 정답으로
        인정됩니다.
      </p>

      <div className="mt-6">
        <TestRunner questions={QUESTIONS} timeLimitMinutes={5} />
      </div>

      <p className="mt-6 text-center text-sm">
        <Link href="/demo" className="text-pen underline underline-offset-4">
          ← 수업 궤도판 데모로 돌아가기
        </Link>
      </p>
    </div>
  );
}
