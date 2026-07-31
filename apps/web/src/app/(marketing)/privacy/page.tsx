import type { Metadata } from "next";
import Link from "next/link";

/* 개인정보 처리방침 초안 (골프롬프트 6장 /privacy, 27장 개인정보).
 * 최소 수집 원칙에 근거한 초안이며 법률 자문 전임을 하단에 명시한다. */

export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description:
    "수맥이 수집하는 항목과 이용 목적, 보존·삭제, 처리 위탁 현황, 정정·삭제 요청 절차를 정리한 초안입니다.",
};

const COLLECTED = [
  {
    subject: "교직원 계정",
    items: "이름 또는 표시명, 이메일, 소속 워크스페이스, 역할·담당 범위, 최근 접속 기록",
    purpose: "로그인과 세션 유지, 역할 기반 접근 통제, 변경 이력 감사",
  },
  {
    subject: "학습자",
    items: "불변 식별자, 표시명 또는 외부 시스템 식별자, 소속 학습 그룹, 적용 교육과정, 진도·숙련도·평가 응답과 채점 결과",
    purpose: "학습 루트 계산, 진도·평가 일정 배치, 자동 출제와 채점, 숙련도 추정",
  },
  {
    subject: "수업 참여 사실",
    items: "수업 참여 여부, 학습 불참 이벤트와 발생 일자",
    purpose: "일정 재계산의 입력값. 전자출결 원장을 만들거나 보관하지 않습니다.",
  },
  {
    subject: "도입 문의",
    items: "이름, 이메일, 소속(선택), 역할(선택), 문의 내용(선택)",
    purpose: "문의 회신과 도입 안내",
  },
  {
    subject: "서비스 운영 기록",
    items: "접속 시각과 IP, 브라우저 정보, 오류 로그, 주요 변경 작업의 감사 기록",
    purpose: "보안 사고 대응, 장애 원인 분석, 변경 이력 확인",
  },
] as const;

const NOT_COLLECTED = [
  "보호자 연락처, 주소, 가족 관계",
  "학교 생활기록, 상담 내용",
  "결제 수단·카드·계좌 정보와 수납 기록",
  "등하원 시각, 차량 승하차 기록",
  "주민등록번호를 비롯한 고유식별정보",
] as const;

const RETENTION = [
  ["교직원 계정 정보", "계정 삭제 또는 워크스페이스 해지 후 30일 이내 파기"],
  ["학습자 학습 데이터", "워크스페이스 해지 후 30일 이내 파기. 그 전이라도 고객의 삭제 요청 시 즉시 처리"],
  ["도입 문의", "회신 완료 후 1년 이내 파기"],
  ["접속·오류 로그", "최대 90일 보관 후 자동 삭제"],
  ["감사 기록", "법령상 보존 의무 또는 분쟁 대응에 필요한 기간"],
] as const;

const PROCESSORS = [
  {
    name: "Supabase",
    role: "데이터베이스·인증·파일 저장 호스팅",
    scope:
      "서비스 운영에 필요한 전체 저장 데이터. 전송 구간은 TLS로, 저장 데이터와 백업은 암호화합니다.",
  },
  {
    name: "AI 공급자",
    role: "문항 분석, 서술형 채점 보조",
    scope:
      "해당 작업에 필요한 최소 데이터만 전송합니다. 문항 본문과 학생 답안 텍스트는 전송하되 학습자 이름은 전송하지 않고 불투명 식별자를 사용합니다. 전송 데이터의 학습 사용 여부, 보존 기간, 처리 지역과 삭제 정책을 계약으로 확인합니다.",
  },
] as const;

const RIGHTS = [
  "본인 또는 법정대리인은 개인정보의 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다.",
  "학습자 정보는 해당 워크스페이스(학원·교습소)가 관리 주체이므로, 먼저 소속 기관의 담당 선생님에게 요청해 주세요.",
  "기관을 통한 처리가 어려운 경우 문의 양식으로 직접 알려 주시면 본인 확인 절차를 거쳐 처리합니다.",
  "요청은 접수일로부터 10일 이내에 처리하고 결과를 회신합니다.",
  "삭제 요청 처리 시 활성 데이터베이스뿐 아니라 검색 색인, 캐시, 생성된 인쇄 파일과 백업의 만료 일정까지 함께 관리합니다.",
] as const;

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-12 lg:px-6 lg:py-16">
      <p className="font-mono text-sm text-pen">개인정보 처리방침</p>
      <h1 className="mt-2 font-[MaruBuri] text-3xl font-semibold">
        개인정보 처리방침
      </h1>
      <p className="mt-3 font-mono text-xs text-ink-soft">초안 · 법률 검토 전</p>
      <p className="mt-5 leading-relaxed text-ink-soft">
        수맥은 수학 수업의 계획·평가를 돕는 도구이며, 그 일을 하는 데 필요한
        최소한의 정보만 수집합니다. 이 방침은 무엇을 받고, 왜 받고, 언제
        지우는지를 설명합니다.
      </p>

      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          1. 수집하는 항목과 이용 목적
        </h2>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left">
                <th scope="col" className="w-[18%] py-3 pr-4 font-semibold text-ink-soft">
                  구분
                </th>
                <th scope="col" className="w-[45%] py-3 pr-4 font-semibold text-ink-soft">
                  항목
                </th>
                <th scope="col" className="py-3 font-semibold text-ink-soft">
                  이용 목적
                </th>
              </tr>
            </thead>
            <tbody className="[&_td]:py-3 [&_td]:align-top [&_tr]:border-b [&_tr]:border-rule-soft">
              {COLLECTED.map((row) => (
                <tr key={row.subject}>
                  <td className="pr-4 font-medium">{row.subject}</td>
                  <td className="pr-4 leading-relaxed">{row.items}</td>
                  <td className="leading-relaxed text-ink-soft">{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          내부 처리와 로그에서는 학습자의 이름 대신 불투명 식별자를 사용합니다.
          비밀번호, 인증 토큰, 학생 답안 전문은 로그에 남기지 않습니다.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          2. 수집하지 않는 항목
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          아래 항목은 제품 경계상 필요하지 않으므로 데이터 모델에 두지 않습니다.
          고객이 요청하더라도 저장하지 않습니다.
        </p>
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {NOT_COLLECTED.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm"
            >
              <span aria-hidden className="mt-0.5 font-mono text-grade">
                ×
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          3. 보존 기간과 파기
        </h2>
        <dl className="mt-5 divide-y divide-rule-soft border-y border-rule-soft">
          {RETENTION.map(([term, period]) => (
            <div key={term} className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium">{term}</dt>
              <dd className="text-sm leading-relaxed text-ink-soft sm:col-span-2">
                {period}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          보존 기간이 지난 정보는 복구할 수 없는 방식으로 삭제합니다. 백업본은
          정해진 백업 주기가 지나면서 자연 만료되며, 만료 전까지는 접근이
          제한됩니다.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          4. 처리 위탁
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          서비스 운영을 위해 아래 수탁자에게 처리 업무를 위탁합니다. 위탁 목적을
          벗어난 이용을 금지하고, 각 수탁자에게 전달되는 데이터는 목적에 필요한
          최소 범위로 제한합니다.
        </p>
        <div className="mt-5 space-y-4">
          {PROCESSORS.map((p) => (
            <div key={p.name} className="rounded-lg border border-rule bg-surface p-5">
              <p className="font-semibold">{p.name}</p>
              <p className="mt-1 font-mono text-xs text-pen">{p.role}</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                {p.scope}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          수탁자와 처리 지역이 변경되면 이 문서를 갱신하고 워크스페이스
          관리자에게 사전 고지합니다. AI 처리 기능은 워크스페이스 설정에서 끌 수
          있으며, 끈 상태에서는 해당 데이터가 AI 공급자에게 전송되지 않습니다.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          5. 정정·삭제 요청 절차
        </h2>
        <ol className="mt-5 space-y-3">
          {RIGHTS.map((line, i) => (
            <li key={line} className="flex items-start gap-3 text-sm leading-relaxed">
              <span className="mt-0.5 shrink-0 font-mono text-xs text-pen">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          6. 안전성 확보 조치
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          기본 거부 원칙의 역할·범위 기반 접근 통제, 데이터베이스 행 수준
          보안에 의한 워크스페이스 간 격리, 되돌리기 어려운 변경에 대한 감사
          기록, 전송·저장 구간 암호화, 운영·개발 환경 분리와 실제 학습자 정보의
          개발 환경 복사 금지를 적용합니다. 자세한 내용은{" "}
          <Link href="/security" className="text-pen underline underline-offset-2">
            데이터와 권한 원칙
          </Link>
          에 정리했습니다.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          7. 문의
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          개인정보 처리에 관한 문의와 열람·정정·삭제 요청은{" "}
          <Link href="/request-demo" className="text-pen underline underline-offset-2">
            문의 양식
          </Link>
          으로 접수해 주세요. 개인정보 보호책임자와 연락처는 정식 공개 시점에
          이 항목에 기재합니다.
        </p>
      </section>

      <p className="mt-12 rounded-lg border border-rule bg-surface px-5 py-4 text-sm leading-relaxed text-ink-soft">
        이 문서는 최소 수집 원칙에 근거해 작성한 <strong className="font-semibold text-ink">초안</strong>이며 법률 자문을
        거치지 않았습니다. 정식 서비스 개시 전 법률 검토를 거쳐 확정하고,
        확정본에는 시행일과 개정 이력을 함께 표기합니다.
      </p>
    </div>
  );
}
