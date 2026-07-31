import type { Metadata } from "next";
import Link from "next/link";
import { DemoRequestForm } from "./DemoRequestForm";

/* 도입 문의 (골프롬프트 6장 /request-demo).
 * 가격 정책이 정해지기 전이므로 요금제·"가장 인기" 표시를 만들지 않는다. */

export const metadata: Metadata = {
  title: "도입 문의",
  description:
    "가르치는 학년과 반 구성을 알려 주시면 수맥 도입 절차와 준비 사항을 안내해 드립니다.",
};

const WHAT_HAPPENS = [
  {
    step: "01",
    title: "문의 확인",
    body: "남겨 주신 학년·반 구성과 지금 가장 오래 걸리는 작업을 먼저 읽습니다.",
  },
  {
    step: "02",
    title: "회신",
    body: "영업일 기준 2일 안에 이메일로 답변드립니다. 별도의 전화 영업은 하지 않습니다.",
  },
  {
    step: "03",
    title: "적용 범위 확인",
    body: "쓰시는 교재와 교육과정, 옮겨야 할 진도 데이터의 형태를 함께 확인합니다.",
  },
] as const;

export default function RequestDemoPage() {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-12 lg:px-6 lg:py-16">
      <p className="font-mono text-sm text-pen">도입 문의</p>
      <h1 className="mt-2 font-[MaruBuri] text-3xl font-semibold">
        어떤 반을 가르치고 계신지 알려 주세요.
      </h1>
      <p className="mt-5 leading-relaxed text-ink-soft">
        학년, 반 구성, 지금 수업 준비에서 가장 오래 걸리는 작업을 적어 주시면
        그에 맞춰 안내드립니다. 화면을 먼저 보고 싶으시면 문의 없이{" "}
        <Link href="/demo" className="text-pen underline underline-offset-2">
          샘플 반 체험
        </Link>
        을 이용하실 수 있습니다.
      </p>

      <div className="mt-10 rounded-lg border border-rule bg-surface p-6 lg:p-8">
        <DemoRequestForm />
      </div>

      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          문의 이후에 일어나는 일
        </h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-3">
          {WHAT_HAPPENS.map((item) => (
            <li key={item.step} className="rounded-lg border border-rule bg-surface p-4">
              <p className="font-mono text-xs text-pen">{item.step}</p>
              <p className="mt-1.5 text-sm font-semibold">{item.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                {item.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">문의 단계에서 보내지 마세요</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          실제 학생 명단, 보호자 연락처, 성적 원본 같은 개인정보는 이 양식으로
          보내지 말아 주세요. 수맥은 도입 검토 단계에서 학생 개인정보를 받지
          않으며, 데이터 이전은 계약 이후 안전한 경로로 진행합니다. 자세한
          내용은{" "}
          <Link href="/security" className="text-pen underline underline-offset-2">
            데이터와 권한 원칙
          </Link>
          과{" "}
          <Link href="/privacy" className="text-pen underline underline-offset-2">
            개인정보 처리방침
          </Link>
          을 참고해 주세요.
        </p>
      </section>
    </div>
  );
}
