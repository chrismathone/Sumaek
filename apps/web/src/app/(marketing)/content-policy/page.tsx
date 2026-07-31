import type { Metadata } from "next";
import Link from "next/link";

/* 콘텐츠 출처·사용 권한 정책 (골프롬프트 6장 /content-policy, 27장 콘텐츠 사용 권한).
 * `사용 가능` 상태만 자동 출제 풀에 들어간다.
 * 시스템이 권리 확보 자체를 보증한다고 표현하지 않는다. */

export const metadata: Metadata = {
  title: "콘텐츠 출처·사용 권한 정책",
  description:
    "교재와 문항의 출처·사용 권한을 어떻게 확인하고 기록하는지, 권한 상태에 따라 자동 출제를 어떻게 제어하는지 정리했습니다.",
};

const PROVENANCE_FIELDS = [
  ["출판 정보", "출판사, 교재명, ISBN, 판본, 페이지, 문항 번호"],
  ["파일 계보", "원본 파일 해시와 취득 경로"],
  ["권리 근거", "권리자와 계약·허락 증빙"],
  ["허용 범위", "허용 용도, 적용 조직·지역·기간"],
  ["처리 허용", "변형·AI 처리·인쇄·온라인 제공 허용 여부"],
] as const;

const PERMISSION_STATES = [
  {
    state: "미확인",
    tone: "rule" as const,
    meaning: "출처나 권리 근거가 아직 입력되지 않은 상태입니다.",
    effect: "자동 출제 제외. 검수 대기열에만 표시됩니다.",
  },
  {
    state: "검토 중",
    tone: "highlight" as const,
    meaning: "증빙이 접수되어 담당자가 범위를 확인하고 있습니다.",
    effect: "자동 출제 제외. 검토 완료 전에는 사용할 수 없습니다.",
  },
  {
    state: "사용 가능",
    tone: "pen" as const,
    meaning: "권리 근거와 허용 범위가 확인되었습니다.",
    effect: "자동 출제 풀에 포함되는 유일한 상태입니다.",
  },
  {
    state: "제한",
    tone: "highlight" as const,
    meaning: "특정 용도·조직·기간에서만 사용할 수 있습니다.",
    effect: "허용 범위에 맞는 사용만 가능하며, 범위를 벗어난 배정은 차단됩니다.",
  },
  {
    state: "만료",
    tone: "grade" as const,
    meaning: "계약 기간이 끝났습니다.",
    effect: "신규 배정 중단. 기존 배포물의 영향 범위를 추적해 차단합니다.",
  },
  {
    state: "사용 중지",
    tone: "grade" as const,
    meaning: "권리자 요청이나 내부 판단으로 사용을 멈춘 상태입니다.",
    effect: "신규 배정 중단. 캐시·인쇄 파일·활성 다운로드 링크까지 차단합니다.",
  },
] as const;

const TONE_CLASS: Record<"rule" | "highlight" | "pen" | "grade", string> = {
  rule: "border-rule bg-paper",
  highlight: "border-highlight bg-highlight-soft",
  pen: "border-pen bg-pen-soft",
  grade: "border-grade bg-grade-soft",
};

const REVIEW_STEPS = [
  {
    no: "01",
    title: "출처 입력",
    body: "업로드 시 출판사·교재명·판본·페이지와 취득 경로를 함께 기록합니다. 파일 해시를 남겨 같은 원본이 다른 이름으로 다시 올라와도 식별합니다.",
  },
  {
    no: "02",
    title: "권리 근거 확인",
    body: "계약서·허락 증빙과 허용 용도, 적용 조직·지역·기간을 등록합니다. 변형·AI 처리·인쇄·온라인 제공 허용 여부를 각각 표시합니다.",
  },
  {
    no: "03",
    title: "품질 검수",
    body: "문항 분리, 수식·도형 추출, 개념·난이도 분류, 정답·해설 검증을 거칩니다. 수식이 파싱되지 않거나 웹과 인쇄 결과가 달라지는 문항은 검수 격리합니다.",
  },
  {
    no: "04",
    title: "사람 검수와 게시",
    body: "검수자가 최종 확인한 문항만 ‘사용 가능’으로 전환되어 자동 출제 풀에 들어갑니다. 검수자와 검수 시각이 기록됩니다.",
  },
] as const;

const AI_DERIVED = [
  "AI가 변형·생성한 문항에는 원본 문항 계보를 연결하고 원본과의 유사도를 함께 기록합니다.",
  "사용한 모델과 프롬프트 버전을 남겨 나중에 어떤 조건에서 만들어졌는지 확인할 수 있게 합니다.",
  "원본의 권한이 변형을 허용하지 않으면 변형 문항을 만들지 않습니다. 원본이 만료·중지되면 파생 문항의 사용도 함께 중단합니다.",
  "AI 결과라도 사람 검수를 거치지 않으면 자동 출제 풀에 들어가지 않습니다.",
] as const;

const REVOCATION = [
  "권한 상태가 만료 또는 사용 중지로 바뀌면 해당 문항의 신규 배정을 즉시 멈춥니다.",
  "이미 만들어진 시험지, 인쇄용 파일, 활성 다운로드 링크와 캐시를 영향 범위로 추적해 차단합니다.",
  "이미 응시가 끝난 기록은 학습 증거로 남기되, 해당 문항의 재출제와 재배포는 차단합니다.",
  "파생된 변형 문항이 있으면 함께 중단하고, 영향을 받는 워크스페이스 관리자에게 알립니다.",
  "권리자의 삭제 요청에 대해서는 처리 결과와 범위를 회신합니다.",
] as const;

export default function ContentPolicyPage() {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-12 lg:px-6 lg:py-16">
      <p className="font-mono text-sm text-pen">콘텐츠 출처·사용 권한 정책</p>
      <h1 className="mt-2 font-[MaruBuri] text-3xl font-semibold">
        출처를 모르는 문항은 출제하지 않습니다.
      </h1>
      <p className="mt-5 leading-relaxed text-ink-soft">
        문제은행은 편하려고 만드는 것이지만, 편의가 권리 확인을 건너뛸 이유는 될
        수 없습니다. 수맥은 문항마다 어디서 왔고 어디까지 쓸 수 있는지를
        기록하고, 그 상태에 따라 자동 출제를 제어합니다.
      </p>

      {/* ── 기록 항목 ── */}
      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          1. 문항마다 기록하는 것
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          문항과 원본 페이지에는 다음 정보가 연결됩니다. 하나라도 비어 있으면
          권한 상태는 ‘미확인’으로 유지됩니다.
        </p>
        <dl className="mt-5 divide-y divide-rule-soft border-y border-rule-soft">
          {PROVENANCE_FIELDS.map(([label, detail]) => (
            <div key={label} className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="text-sm leading-relaxed text-ink-soft sm:col-span-2">
                {detail}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── 권한 상태 ── */}
      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          2. 권한 상태와 자동 출제
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          권한 상태는 다음과 같이 이동합니다.
        </p>
        <p className="mt-3 font-mono text-sm">
          미확인 → 검토 중 → 사용 가능 / 제한 / 만료 / 사용 중지
        </p>
        <ul className="mt-6 space-y-3">
          {PERMISSION_STATES.map((s) => (
            <li
              key={s.state}
              className={`rounded-lg border p-4 ${TONE_CLASS[s.tone]}`}
            >
              <p className="font-mono text-sm font-medium">{s.state}</p>
              <p className="mt-1.5 text-sm leading-relaxed">{s.meaning}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                {s.effect}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-5 rounded-lg border border-pen bg-surface px-4 py-3 text-sm leading-relaxed">
          자동 출제 풀에 들어가는 상태는 <strong className="font-semibold">사용 가능</strong> 하나뿐입니다. 그 외의
          상태는 선생님이 직접 골라 넣으려 해도 허용 범위를 벗어나면 차단됩니다.
        </p>
      </section>

      {/* ── 확인 절차 ── */}
      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          3. 확인 절차
        </h2>
        <div className="mt-5 space-y-4">
          {REVIEW_STEPS.map((step) => (
            <div key={step.no} className="rounded-lg border border-rule bg-surface p-5">
              <p className="font-mono text-xs text-pen">{step.no}</p>
              <p className="mt-1.5 font-semibold">{step.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── AI 파생 문항 ── */}
      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          4. AI가 변형한 문항
        </h2>
        <ul className="mt-5 space-y-2.5">
          {AI_DERIVED.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-sm leading-relaxed">
              <span aria-hidden className="mt-0.5 font-mono text-pen">
                ·
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 권한 철회 ── */}
      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          5. 권한이 철회되면
        </h2>
        <ul className="mt-5 space-y-2.5">
          {REVOCATION.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-sm leading-relaxed">
              <span aria-hidden className="mt-0.5 font-mono text-grade">
                ·
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 권리자 문의 ── */}
      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          6. 권리자 문의
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          자신의 저작물이 허락 없이 사용되고 있다고 판단되시면{" "}
          <Link href="/request-demo" className="text-pen underline underline-offset-2">
            문의 양식
          </Link>
          으로 교재명·판본·해당 페이지와 권리 근거를 알려 주세요. 확인 즉시 해당
          콘텐츠의 상태를 ‘사용 중지’로 바꿔 신규 사용을 멈추고, 조사 결과와
          처리 범위를 회신합니다.
        </p>
      </section>

      {/* ── 한계 명시 ── */}
      <section className="mt-12 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">이 정책이 보증하지 않는 것</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          수맥은 권한 상태를 기록하고, 그 상태에 따라 자동 출제와 배포를 제어하는
          장치입니다. 개별 교재에 대한 사용 권리를 시스템이 확보해 주지는
          않습니다. 적용 법률과 출판사 계약의 최종 판단은 법률 검토 대상이며,
          업로드한 자료에 대한 권리 확인 책임은 업로드한 이용자에게 있습니다.
        </p>
      </section>

      <p className="mt-8 rounded-lg border border-rule bg-surface px-5 py-4 text-sm leading-relaxed text-ink-soft">
        이 문서는 제품 설계 원칙에 근거해 작성한{" "}
        <strong className="font-semibold text-ink">초안</strong>이며 법률 자문을
        거치지 않았습니다. 정식 서비스 개시 전 법률 검토를 거쳐 확정합니다.
      </p>

      <nav aria-label="관련 문서" className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link
          href="/security"
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 transition-colors hover:border-pen"
        >
          데이터와 권한 원칙
        </Link>
        <Link
          href="/terms"
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 transition-colors hover:border-pen"
        >
          이용약관
        </Link>
        <Link
          href="/privacy"
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 transition-colors hover:border-pen"
        >
          개인정보 처리방침
        </Link>
      </nav>
    </div>
  );
}
