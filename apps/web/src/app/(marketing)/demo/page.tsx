import type { Metadata } from "next";
import Link from "next/link";
import { OrbitBoard } from "@/components/marketing/OrbitBoard";

export const metadata: Metadata = {
  title: "샘플 반 체험",
  description:
    "실제 학생 정보 없이 합성 데이터로 수업 궤도판과 자동 운영을 체험합니다.",
};

/** 샘플 반 체험 (골프롬프트 6장 /demo) — 합성 데이터만 사용. */
export default function DemoPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 lg:px-6">
      <p className="font-mono text-sm text-pen">샘플 반 체험</p>
      <h1 className="mt-2 font-[MaruBuri] text-3xl font-semibold">
        중2 심화 A — 8월 첫째 주
      </h1>
      <p className="mt-3 max-w-2xl text-ink-soft">
        아래 궤도판의 버튼을 눌러 학습 불참과 점수가 학습 경로에 미치는 영향을
        확인하세요. 이것은 전자출결 기능이 아니라, 이미 전달된 수업 불가 사실이
        학습 경로에 미치는 영향을 보여주는 데모입니다. 실제 학생 정보 없이 샘플
        데이터로 동작합니다.
      </p>

      <div className="mt-8">
        <OrbitBoard />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        {[
          {
            title: "완료된 과거는 유지",
            body: "7월 28일·30일 기록은 어떤 변경에도 다시 계산되지 않습니다.",
          },
          {
            title: "영향받는 미래만 재계산",
            body: "불참·점수 반영 시 해당 학생의 미래 경로만 다시 그려집니다.",
          },
          {
            title: "변경 이유와 전후 표시",
            body: "모든 자동 변경은 이유, 적용 규칙, 변경 전후를 함께 보여줍니다.",
          },
          {
            title: "자동 반영 vs 승인 필요",
            body: "정책에 따라 조용히 처리할 일과 선생님이 결정할 일을 구분합니다.",
          },
        ].map((card) => (
          <div key={card.title} className="rounded-lg border border-rule bg-surface p-4">
            <p className="text-sm font-semibold">{card.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{card.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-lg border border-rule bg-surface p-6 text-center">
        <p className="font-[MaruBuri] text-xl font-semibold">
          내 반의 학습 루트로 시작해 보세요.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link
            href="/demo/test"
            className="rounded-[var(--radius-control)] bg-pen px-5 py-2.5 font-medium text-white transition-colors hover:bg-ink"
          >
            학생 화면으로 일일테스트 응시하기
          </Link>
          <Link
            href="/request-demo"
            className="rounded-[var(--radius-control)] border border-rule px-5 py-2.5 font-medium hover:border-pen"
          >
            도입 문의
          </Link>
          <Link
            href="/"
            className="rounded-[var(--radius-control)] border border-rule px-5 py-2.5 font-medium hover:border-pen"
          >
            운영 방식 다시 보기
          </Link>
        </div>
      </div>
    </div>
  );
}
