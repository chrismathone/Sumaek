import type { Metadata } from "next";
import Link from "next/link";

/* 제품 상세 (골프롬프트 6장 /product, 1A장 제품 경계).
 * 핵심 범위 다섯 가지와 명시적 비범위를 함께 밝힌다.
 * "학원 운영을 한 번에" 류의 통합 관리 카피를 쓰지 않는다. */

export const metadata: Metadata = {
  title: "제품 상세",
  description:
    "수맥은 수학을 무엇부터 어떤 순서로 가르치고, 오늘 무엇을 풀리고, 어떤 증거로 이해를 판단할지 다루는 도구입니다. 핵심 범위 다섯 가지와 다루지 않는 영역을 함께 정리했습니다.",
};

const CORE_SCOPES = [
  {
    no: "01",
    title: "수학 지식 모델",
    lead: "교육과정·개념·성취기준과 교재·문항을 하나로 연결합니다.",
    body: [
      "개념을 변하지 않는 기준축으로 둡니다. 교재가 바뀌어도 진도 기록은 페이지가 아니라 개념에 남습니다.",
      "개념 사이의 선수·후속 관계를 그래프로 관리해, 중1에서 놓친 개념이 중3 단원에서 어떤 영향을 주는지 추적할 수 있습니다.",
      "교육과정 버전과 적용 학년군을 명시합니다. 이미 게시된 루트와 평가를 새 교육과정으로 자동 재매핑하지 않습니다.",
    ],
  },
  {
    no: "02",
    title: "학습 루트",
    lead: "반 공통 진도와 학생별 보충·선행·재합류가 한 화면에서 공존합니다.",
    body: [
      "실제 학생 계획은 게시된 반 루트 버전에 학생별 오버라이드를 얹어 계산합니다. 학생마다 반 루트를 복사하지 않습니다.",
      "저장하는 것은 차이뿐입니다. 분기, 보충, 건너뛰기, 교재 대체, 기한 변경, 재합류만 기록하므로 한 학생의 조정이 다른 학생의 계획을 건드리지 않습니다.",
      "반 루트를 고치면 어떤 학생의 미래 일정이 어떻게 달라지는지 게시 전에 확인할 수 있습니다.",
    ],
  },
  {
    no: "03",
    title: "일정 계산",
    lead: "수업일·휴일·목표일·가용 시간을 입력으로 미래 진도를 배치합니다.",
    body: [
      "같은 입력에는 같은 결과를 냅니다. 일정 엔진은 결정론적으로 동작하며, 계산 결과에는 적용된 규칙이 함께 남습니다.",
      "완료된 과거 수업·응시·채점 기록과 선생님이 잠근 일정은 자동 재계산이 변경하지 않습니다. 바뀌는 것은 미래 구간뿐입니다.",
      "학습 불참 이벤트가 전달되면 해당 학생의 미래 경로만 다시 그리고, 보강 시점과 예상 재합류일을 제안합니다. 전자출결 기능이 아니라 이미 전달된 사실을 일정에 반영하는 계산입니다.",
    ],
  },
  {
    no: "04",
    title: "자동 평가",
    lead: "일일테스트·확인테스트·오답 복습을 설계하고, 출제하고, 채점하고, 다시 계획합니다.",
    body: [
      "시험지는 수업 계획에서 나옵니다. 오늘 학습·누적 복습·취약 개념 비율과 난이도 분포를 블루프린트로 정하면 그 규칙대로 출제합니다.",
      "객관식과 정규화 가능한 단답형은 즉시 채점합니다. 서술형과 판정 신뢰도가 낮은 답안은 임의로 확정하지 않고 선생님의 채점 예외함으로 보냅니다.",
      "게시된 시험은 스냅샷으로 고정되어 응시 도중 조용히 바뀌지 않습니다. 채점 결과는 숙련도 추정과 다음 복습 일정으로 이어집니다.",
    ],
  },
  {
    no: "05",
    title: "콘텐츠 파이프라인",
    lead: "문제집을 권리·출처·수식·도형·정답 품질까지 검수해 문제은행으로 만듭니다.",
    body: [
      "사용 권한 확인, 문항 분리, 수식·도형 추출, 개념·난이도 분류, 정답·해설 검증, 사람 검수를 차례로 거칩니다.",
      "권한 상태가 ‘사용 가능’인 문항만 자동 출제 풀에 들어갑니다. 미확인·검토 중·제한·만료·사용 중지 문항은 제외됩니다.",
      "수식은 원문·정규화 결과·렌더 결과를 구분해 보관합니다. KaTeX가 파싱하지 못하거나 웹과 인쇄 결과가 달라지는 문항은 중립 텍스트로 조용히 출제하지 않고 검수 격리합니다.",
    ],
  },
] as const;

const MINIMAL_DATA = [
  {
    subject: "학생",
    holds: "불변 ID, 표시명 또는 외부 시스템 식별자, 소속 학습 그룹, 적용 교육과정, 진도·숙련도·평가 증거",
  },
  {
    subject: "반·학습 그룹",
    holds: "수학 과정, 수업 가능 시간, 기본 루트, 평가 정책, 담당 선생님",
  },
  {
    subject: "선생님",
    holds: "역할, 담당 범위, 콘텐츠·루트 승인 권한",
  },
] as const;

const OUT_OF_SCOPE = [
  "수강료 청구·결제·미납·현금영수증·회계",
  "출퇴근·급여·강사 계약·인사 평가",
  "등하원 전자출결·차량 노선·승하차", // boundary-allow: 명시적 비범위 목록 (1A장)
  "입학 상담·영업 퍼널·리드·CRM·상담 이력", // boundary-allow: 명시적 비범위 목록 (1A장)
  "보호자 마케팅 메시지·대량 광고·재등록 영업",
  "좌석·강의실·비품·지점 손익 관리",
  "일반 과목용 범용 LMS·전 과목 통합 포털",
] as const;

const INTEGRATION_BOUNDARY = [
  ["사용자·학습 그룹 동기화", "외부 시스템의 명단을 최소 필드로 받습니다."],
  ["수업 참여 이벤트 수신", "일정 재계산의 입력으로 참여 여부만 받습니다."],
  ["평가 결과 내보내기", "채점·숙련도 결과를 외부 시스템으로 보냅니다."],
  ["오늘 학습 링크 전달", "학생에게 오늘 할 학습의 링크만 전달합니다."],
] as const;

export default function ProductPage() {
  return (
    <>
      {/* ── 도입 ── */}
      <section className="mx-auto max-w-[1280px] px-4 py-14 lg:px-6 lg:py-16">
        <p className="font-mono text-sm text-pen">제품 상세</p>
        <h1 className="mt-2 max-w-3xl font-[MaruBuri] text-3xl leading-snug font-semibold lg:text-4xl">
          수학을 무엇부터, 어떤 순서와 깊이로 가르칠지를 다루는 도구입니다.
        </h1>
        <p className="mt-5 max-w-3xl leading-relaxed text-ink-soft">
          수맥은 학원 경영 프로그램이 아닙니다. 오늘 무엇을 풀리고, 어떤 증거로
          이해 여부를 판단하며, 다음 수업을 어떻게 바꿀지를 자동화하는 전문
          도구입니다. 학생·반·선생님 정보는 이 일을 하는 데 필요한 최소 범위만
          가집니다.
        </p>
      </section>

      {/* ── 핵심 범위 다섯 가지 ── */}
      <section className="border-y border-rule-soft bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
          <p className="font-mono text-sm text-pen">핵심 범위</p>
          <h2 className="mt-2 font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
            다섯 가지를 합쳐 하나의 폐쇄 루프를 만듭니다.
          </h2>
          <p className="mt-3 max-w-3xl text-ink-soft">
            계획을 세우고, 수업하고, 평가하고, 그 결과로 다음 계획을 고치는
            흐름이 끊기지 않도록 설계했습니다.
          </p>

          <div className="mt-10 space-y-8">
            {CORE_SCOPES.map((scope) => (
              <article
                key={scope.no}
                className="grid gap-4 rounded-lg border border-rule bg-paper p-6 lg:grid-cols-12 lg:gap-8"
              >
                <div className="lg:col-span-4">
                  <p className="font-mono text-xs text-pen">{scope.no}</p>
                  <h3 className="mt-1.5 font-[MaruBuri] text-xl font-semibold">
                    {scope.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {scope.lead}
                  </p>
                </div>
                <ul className="space-y-3 lg:col-span-8">
                  {scope.body.map((line) => (
                    <li
                      key={line}
                      className="border-l-2 border-rule-soft pl-4 text-sm leading-relaxed"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 최소 데이터 ── */}
      <section className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
        <p className="font-mono text-sm text-pen">데이터 범위</p>
        <h2 className="mt-2 font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
          기능 수행에 필요한 최소한만 가집니다.
        </h2>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left">
                <th scope="col" className="w-1/4 py-3 pr-6 font-semibold text-ink-soft">
                  대상
                </th>
                <th scope="col" className="py-3 font-semibold text-ink-soft">
                  보관하는 항목
                </th>
              </tr>
            </thead>
            <tbody className="[&_td]:py-3 [&_td]:align-top [&_tr]:border-b [&_tr]:border-rule-soft">
              {MINIMAL_DATA.map((row) => (
                <tr key={row.subject}>
                  <td className="pr-6 font-medium">{row.subject}</td>
                  <td className="leading-relaxed text-ink-soft">{row.holds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 rounded-lg border border-rule bg-surface px-4 py-3 text-sm leading-relaxed">
          보호자 연락처, 주소, 학교 생활기록, 상담 전문, 결제 정보는 기본 데이터
          모델에 넣지 않습니다. 출결이 일정 재계산의 입력으로 필요한 경우에도
          수업 참여 여부와 학습 불참 이벤트만 받습니다.
        </p>
      </section>

      {/* ── 비범위 ── */}
      <section className="border-y border-rule-soft bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
          <p className="font-mono text-sm text-pen">다루지 않는 영역</p>
          <h2 className="mt-2 font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
            하지 않기로 정한 일을 먼저 밝힙니다.
          </h2>
          <p className="mt-3 max-w-3xl text-ink-soft">
            아래 기능은 핵심 제품 범위에서 명시적으로 제외합니다. 요구가
            들어와도 직접 확장하지 않고 외부 연동 계약으로 격리합니다.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {OUT_OF_SCOPE.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 rounded-lg border border-rule bg-paper p-4 text-sm leading-relaxed"
              >
                <span aria-hidden className="mt-0.5 font-mono text-grade">
                  ×
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="mt-12 font-[MaruBuri] text-xl font-semibold">
            이 데이터가 필요하면 외부 시스템과 얇게 연결합니다.
          </h3>
          <p className="mt-2 max-w-3xl text-sm text-ink-soft">
            연동 경계는 네 가지로 제한하며, 외부 시스템의 결제·상담·출결 데이터를
            복제하지 않습니다. 연동이 끊겨도 이미 동기화된 명단, 게시된 루트,
            오늘 수업, 응시와 채점은 계속 동작합니다.
          </p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {INTEGRATION_BOUNDARY.map(([title, detail]) => (
              <div key={title} className="rounded-lg border border-rule bg-paper p-4">
                <dt className="text-sm font-semibold">{title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                  {detail}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── 자동화 원칙 ── */}
      <section className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
        <p className="font-mono text-sm text-pen">자동화 원칙</p>
        <h2 className="mt-2 font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
          자동으로 처리하되, 결정권은 넘기지 않습니다.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: "결과가 아니라 근거",
              body: "자동 결정은 판단 이유, 적용된 규칙, 영향 범위, 변경 전후와 되돌리기 방법을 함께 보여줍니다.",
            },
            {
              title: "자동화 수준 선택",
              body: "조직·반·테스트 정책별로 자동 적용, 선생님 승인 후 적용, 수동 중에서 고를 수 있습니다.",
            },
            {
              title: "불확실하면 멈춤",
              body: "채점 판정이 불확실한 답을 임의로 확정하지 않고 채점 예외함으로 보냅니다.",
            },
            {
              title: "증거는 여러 개",
              body: "한 번의 점수로 숙련·미숙련을 단정하지 않고, 난이도·표상·시간이 다른 복수 증거를 함께 봅니다.",
            },
          ].map((card) => (
            <div key={card.title} className="rounded-lg border border-rule bg-surface p-4">
              <p className="text-sm font-semibold">{card.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-rule-soft bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-14 text-center lg:px-6">
          <p className="font-[MaruBuri] text-2xl font-semibold">
            샘플 반에서 이 흐름을 직접 확인해 보세요.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/demo"
              className="rounded-[var(--radius-control)] bg-pen px-6 py-3 font-medium text-white transition-colors hover:bg-ink"
            >
              샘플 반 체험하기
            </Link>
            <Link
              href="/request-demo"
              className="rounded-[var(--radius-control)] border border-rule px-6 py-3 font-medium transition-colors hover:border-pen"
            >
              도입 문의
            </Link>
          </div>
          <p className="mt-4 text-xs text-ink-soft">
            실제 학생 정보 없이 합성 데이터로 체험합니다.
          </p>
        </div>
      </section>
    </>
  );
}
