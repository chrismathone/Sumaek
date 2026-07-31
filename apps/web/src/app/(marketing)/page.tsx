import Link from "next/link";
import { FlowTabs } from "@/components/marketing/FlowTabs";
import { OrbitBoard } from "@/components/marketing/OrbitBoard";

/* 랜딩 (골프롬프트 6장) — 지정된 카피를 사용하며 검증되지 않은 수치·가짜
 * 고객·가짜 요금제를 표시하지 않는다. */

export default function LandingPage() {
  return (
    <>
      {/* ── 히어로 ── */}
      <section className="mx-auto grid max-w-[1280px] items-center gap-10 px-4 py-14 lg:grid-cols-12 lg:px-6 lg:py-20">
        <div className="lg:col-span-5">
          <p className="font-mono text-sm text-pen">
            수학 선생님을 위한 수업 운영 시스템
          </p>
          <h1 className="mt-4 font-[MaruBuri] text-4xl leading-snug font-semibold lg:text-[2.75rem]">
            수업이 시작되기 전에,
            <br />
            오늘의 진도와 테스트는
            <br />
            이미 준비되어 있습니다.
          </h1>
          <p className="mt-5 max-w-md leading-relaxed text-ink-soft">
            반 공통 진도부터 학생별 분기, 자동 출제·채점, 학습 불참 이후 일정
            재계산까지. 선생님은 오늘 판단할 것만 확인합니다.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/demo"
              className="rounded-[var(--radius-control)] bg-pen px-5 py-2.5 font-medium text-white transition-colors hover:bg-ink"
            >
              샘플 반으로 오늘 수업 보기
            </Link>
            <Link
              href="#operations"
              className="rounded-[var(--radius-control)] border border-rule px-5 py-2.5 font-medium text-ink transition-colors hover:border-pen"
            >
              운영 방식 살펴보기
            </Link>
          </div>
          <p className="mt-4 text-xs text-ink-soft">
            실제 학생 정보 없이 샘플 데이터로 체험합니다.
          </p>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <OrbitBoard />
        </div>
      </section>

      {/* ── 문제 인식: 전후 비교표 ── */}
      <section className="border-y border-rule-soft bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
          <p className="font-mono text-sm text-pen">전날 밤에 하지 않아도 되는 일</p>
          <h2 className="mt-3 font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
            수업 준비를 ‘매일 반복’에서 ‘한 번 설계’로 바꿉니다.
          </h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left">
                  <th scope="col" className="w-1/2 py-3 pr-6 font-semibold text-ink-soft">
                    지금의 운영
                  </th>
                  <th scope="col" className="w-1/2 py-3 font-semibold text-pen">
                    수업 루트를 설계한 뒤
                  </th>
                </tr>
              </thead>
              <tbody className="[&_td]:py-3 [&_td]:align-top [&_tr]:border-b [&_tr]:border-rule-soft">
                <tr>
                  <td className="pr-6">엑셀에서 날짜별 진도를 다시 계산</td>
                  <td>목표일과 수업일을 기준으로 미래 진도를 배치</td>
                </tr>
                <tr>
                  <td className="pr-6">수업 전날 문제를 골라 시험지 제작</td>
                  <td>오늘 학습·누적 복습·취약 개념으로 자동 출제</td>
                </tr>
                <tr>
                  <td className="pr-6">수업에 참여하지 못한 학생 때문에 여러 표를 수정</td>
                  <td>전달받은 학습 불참 이벤트로 해당 학생의 미래 경로만 분기하고 재합류</td>
                </tr>
                <tr>
                  <td className="pr-6">점수 확인 후 복습 일정을 수기로 결정</td>
                  <td>오답과 숙련도를 반영해 확인테스트 예약</td>
                </tr>
                <tr>
                  <td className="pr-6">무엇을 놓쳤는지 선생님이 찾아야 함</td>
                  <td>판단이 필요한 예외만 오늘 화면에 표시</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── 운영 흐름 ── */}
      <section id="operations" className="mx-auto max-w-[1280px] scroll-mt-16 px-4 py-16 lg:px-6">
        <h2 className="font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
          한 번 만든 계획이 매일의 수업으로 이어집니다.
        </h2>
        <div className="mt-8">
          <FlowTabs />
        </div>
      </section>

      {/* ── 반·개별 진도 ── */}
      <section id="tracks" className="border-y border-rule-soft bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
          <h2 className="font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
            같이 가르치고, 다르게 따라갑니다.
          </h2>
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {[
              {
                title: "이 학생만 조정",
                body: "정하린의 8월 3일 불참은 정하린의 미래 경로만 바꿉니다. 반 공통 진도선과 다른 학생의 계획은 그대로입니다.",
              },
              {
                title: "반 전체에 적용",
                body: "8월 15일 휴강을 반영하면 반 공통 경로의 미래 차시가 밀리고, 목표 종료일 변화가 게시 전에 표시됩니다.",
              },
              {
                title: "합류 지점 변경",
                body: "보강·재시험을 마친 학생이 어느 차시에서 반 진도로 돌아올지 예상 합류일과 함께 지정합니다. 선생님이 잠근 일정은 자동 재계산이 건드리지 않습니다.",
              },
            ].map((card) => (
              <div key={card.title} className="rounded-lg border border-rule bg-paper p-5">
                <h3 className="font-semibold">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 자동 테스트 ── */}
      <section id="assessment" className="mx-auto max-w-[1280px] scroll-mt-16 px-4 py-16 lg:px-6">
        <h2 className="font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
          시험지는 수업 계획에서 자동으로 나옵니다.
        </h2>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="rounded-lg border border-rule bg-surface p-5">
            <p className="font-mono text-xs text-ink-soft">샘플 평가 규칙</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-soft">오늘 학습</dt>
              <dd className="font-mono">60%</dd>
              <dt className="text-ink-soft">누적 복습</dt>
              <dd className="font-mono">25%</dd>
              <dt className="text-ink-soft">취약 개념</dt>
              <dd className="font-mono">15%</dd>
              <dt className="text-ink-soft">총 문항</dt>
              <dd className="font-mono">12문항 (하 3 · 중 6 · 상 3)</dd>
              <dt className="text-ink-soft">제한 시간</dt>
              <dd className="font-mono">20분</dd>
            </dl>
          </div>
          <div className="rounded-lg border border-rule bg-surface p-5">
            <p className="font-mono text-xs text-ink-soft">시험지 미리보기 — 문항별 선정 이유</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex items-start justify-between gap-3 border-b border-rule-soft pb-2">
                <span>3번 · 연립방정식 활용 · 중</span>
                <span className="shrink-0 font-mono text-xs text-pen">오늘 배운 개념</span>
              </li>
              <li className="flex items-start justify-between gap-3 border-b border-rule-soft pb-2">
                <span>7번 · 일차방정식 풀이 · 하</span>
                <span className="shrink-0 font-mono text-xs text-pen">누적 복습</span>
              </li>
              <li className="flex items-start justify-between gap-3 pb-1">
                <span>11번 · 부등식 성질 · 중</span>
                <span className="shrink-0 font-mono text-xs text-pen">약점 보강</span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-ink-soft">
              ‘다른 문제로 교체’는 한 문항만 바꾸고 전체 선정 규칙은 유지합니다.
            </p>
          </div>
        </div>
        <p className="mt-6 rounded-lg border border-pen-soft bg-pen-soft/40 px-4 py-3 text-sm">
          객관식과 단답형은 즉시 채점합니다. 서술형과 판정 신뢰도가 낮은 답안만
          선생님의 검토함으로 보냅니다.
        </p>
      </section>

      {/* ── 개념 중심 문제은행 ── */}
      <section id="bank" className="border-y border-rule-soft bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
          <h2 className="font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
            교재가 달라도, 진도 기록은 개념에 남습니다.
          </h2>
          <ol className="mt-8 flex flex-wrap items-center gap-2 text-sm">
            {[
              "사용 권한이 확인된 교재",
              "문항 분리",
              "수식·도형 추출",
              "개념·난이도 분류",
              "정답·해설 검증",
              "사람 검수",
              "출제 가능",
            ].map((step, i, arr) => (
              <li key={step} className="flex items-center gap-2">
                <span
                  className={`rounded-[var(--radius-control)] border px-3 py-1.5 ${
                    i === arr.length - 1
                      ? "border-pen bg-pen font-medium text-white"
                      : "border-rule bg-paper"
                  }`}
                >
                  {step}
                </span>
                {i < arr.length - 1 && (
                  <span aria-hidden className="text-rule">→</span>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm text-ink-soft">
            검수 전, 출처 불명, 중복 의심, 권한 미확인 문항은 자동 출제에서
            제외됩니다. 수식이 깨진 문항은 게시되지 않습니다.
          </p>
        </div>
      </section>

      {/* ── 오늘의 운영 화면 ── */}
      <section className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
        <h2 className="font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
          선생님이 아침에 보는 화면은 하나면 됩니다.
        </h2>
        <p className="mt-3 max-w-2xl text-ink-soft">
          정상적으로 진행되는 일은 조용히 처리하고, 결정이 필요한 일만 위로
          올립니다.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["오늘 수업할 반과 시간", "16:00 중2 심화 A · 18:10 중3 정규 B"],
            ["학생별 다른 진도", "분기 중 2명 · 재합류 예정 1명"],
            ["오늘 배정할 테스트", "일일테스트 2건 준비 완료 · 재시험 1건"],
            ["자동 처리된 변경", "간격 복습 6건 배치 · 문항 교체 1건"],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-lg border border-rule bg-surface p-4">
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1.5 font-mono text-xs text-ink-soft">{detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <span className="rounded-[var(--radius-control)] bg-highlight-soft px-3 py-1.5 text-sm font-medium">
            예외 3건 검토하기
          </span>
          <span className="rounded-[var(--radius-control)] bg-highlight-soft px-3 py-1.5 text-sm font-medium">
            변경 일정 승인하기
          </span>
          <span className="rounded-[var(--radius-control)] bg-highlight-soft px-3 py-1.5 text-sm font-medium">
            테스트 미리보기
          </span>
        </div>
      </section>

      {/* ── 일정 변경 원칙 ── */}
      <section className="border-y border-rule-soft bg-ink text-white">
        <div className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
          <h2 className="font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
            과거는 잠그고, 미래만 바꿉니다.
          </h2>
          <div className="mt-6 max-w-2xl rounded-lg border border-white/20 bg-white/5 p-5 text-sm leading-relaxed">
            <p>
              정하린 학생에게 8월 3일 학습 불참 이벤트가 전달되었습니다. 완료된
              7월 기록은 유지하고, 8월 5일 보강과 8월 10일 반 진도 합류를
              제안합니다.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs">
              {["변경 전후 비교", "이 일정 승인", "직접 수정", "원래 계획 유지"].map(
                (action) => (
                  <span
                    key={action}
                    className="rounded-[var(--radius-control)] border border-white/30 px-2.5 py-1"
                  >
                    {action}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 신뢰와 통제 ── */}
      <section className="mx-auto max-w-[1280px] px-4 py-16 lg:px-6">
        <h2 className="font-[MaruBuri] text-2xl font-semibold lg:text-3xl">
          자동화되어도 결정권은 선생님에게 있습니다.
        </h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            "변경 근거 확인",
            "역할별 권한",
            "자동·수동 변경 이력 보존",
            "검수된 문제만 출제",
            "불확실한 채점의 예외 처리",
          ].map((item) => (
            <li
              key={item}
              className="rounded-lg border border-rule bg-surface p-4 text-sm font-medium"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* ── FAQ ── */}
      <section className="border-t border-rule-soft bg-surface">
        <div className="mx-auto max-w-[880px] px-4 py-16 lg:px-6">
          <h2 className="font-[MaruBuri] text-2xl font-semibold">자주 묻는 질문</h2>
          <div className="mt-6 divide-y divide-rule-soft">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer items-center justify-between gap-4 font-medium">
                  {q}
                  <span aria-hidden className="text-rule transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── 최종 CTA ── */}
      <section className="mx-auto max-w-[1280px] px-4 py-20 text-center lg:px-6">
        <h2 className="font-[MaruBuri] text-3xl font-semibold">
          다음 수업을 준비하지 말고, 다음 학기를 설계하세요.
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/demo"
            className="rounded-[var(--radius-control)] bg-pen px-6 py-3 font-medium text-white transition-colors hover:bg-ink"
          >
            샘플 반 10분 체험하기
          </Link>
          <Link
            href="/request-demo"
            className="rounded-[var(--radius-control)] border border-rule px-6 py-3 font-medium transition-colors hover:border-pen"
          >
            도입 문의
          </Link>
        </div>
      </section>
    </>
  );
}

const FAQ = [
  {
    q: "반 진도와 학생별 진도를 동시에 운영할 수 있나요?",
    a: "네. 실제 학생 계획은 게시된 반 루트에 학생별 오버라이드를 얹어 계산합니다. 반 루트를 복사하지 않으므로 한 학생의 분기·보강·재합류가 다른 학생이나 반 공통 계획을 바꾸지 않습니다.",
  },
  {
    q: "일정 변경을 선생님 승인 후 적용할 수 있나요?",
    a: "네. 반·테스트 정책별로 자동 적용, 선생님 승인 후 적용, 수동 중에서 선택합니다. 변경안에는 이유·영향 범위·변경 전후가 함께 표시되고 되돌릴 수 있습니다.",
  },
  {
    q: "서술형도 자동 채점되나요?",
    a: "객관식과 정규화 가능한 단답형은 즉시 채점합니다. 서술형은 핵심 단계·추론 루브릭 기준으로 AI가 근거와 신뢰도를 제안하지만 최종 확정 권한은 선생님에게 있습니다. 판정이 불확실한 답은 임의로 확정하지 않고 검토함으로 보냅니다.",
  },
  {
    q: "문제집은 어떤 과정을 거쳐 문제은행에 들어가나요?",
    a: "사용 권한 확인 → 문항 분리 → 수식·도형 추출 → 개념·난이도 분류 → 정답·해설 검증 → 사람 검수를 거친 문항만 출제 풀에 들어갑니다. 출처·권한이 불명확하거나 수식 검증에 실패한 문항은 자동 출제되지 않습니다.",
  },
  {
    q: "기존 최소 명단과 진도 데이터는 어떻게 옮기나요?",
    a: "CSV 가져오기와 외부 학사 시스템 연동을 지원합니다. 업로드 전에 행 단위 미리보기로 중복·누락·형식 오류를 확인하고, 오류 행만 수정해 다시 처리할 수 있습니다. 결제·상담·출결 원장 같은 행정 데이터는 받지 않습니다.",
  },
  {
    q: "자동 생성된 시험지를 선생님이 수정할 수 있나요?",
    a: "네. 게시 전에 문항 잠금·교체·순서·배점 변경이 가능하며, ‘다른 문제로 교체’는 해당 문항만 바꾸고 전체 선정 규칙을 유지합니다. 게시 후에는 스냅샷이 고정되어 응시 중 시험이 조용히 바뀌지 않습니다.",
  },
] as const;
