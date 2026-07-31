import type { Metadata } from "next";
import Link from "next/link";

/* 데이터와 권한 원칙 (골프롬프트 6장 /security, 27장 보안·개인정보).
 * 취득하지 않은 인증, 가짜 고객, 검증되지 않은 수치를 표시하지 않는다.
 * 구현된 원칙과 아직 진행 중인 항목을 구분해 적는다. */

export const metadata: Metadata = {
  title: "데이터와 권한 원칙",
  description:
    "수맥이 어떤 데이터를 수집하지 않는지, 권한과 테넌트 격리를 어떻게 강제하는지, 무엇을 감사 기록으로 남기는지 정리했습니다.",
};

const MINIMAL_COLLECTION = [
  {
    label: "학생",
    collect: "불변 ID, 표시명 또는 외부 식별자, 소속 학습 그룹, 적용 교육과정, 진도·숙련도·평가 증거",
    skip: "보호자 연락처, 주소, 학교 생활기록, 상담 전문, 결제 정보",
  },
  {
    label: "교직원",
    collect: "계정 식별자, 이메일, 역할, 담당 범위, 승인 권한",
    skip: "급여, 근태, 인사 평가, 계약 정보",
  },
  {
    label: "수업 참여",
    collect: "일정 재계산에 필요한 수업 참여 여부와 학습 불참 이벤트",
    skip: "등하원 시각, 전자출결 원장, 차량 승하차 기록",
  },
] as const;

const PRINCIPLES = [
  {
    no: "01",
    title: "수집하지 않는 것을 먼저 정합니다",
    body: [
      "미성년자 데이터를 다룬다는 전제로 필요한 최소 항목만 스키마에 둡니다. 필드마다 목적, 접근 역할, 보존 기간을 정의합니다.",
      "제품 경계상 수납·상담·전자출결·차량·급여·CRM 데이터를 저장하지 않으므로, 이 정보는 유출될 대상 자체가 존재하지 않습니다.",
      "내부 처리에서는 이름 대신 불투명 학생 ID를 사용합니다.",
    ],
  },
  {
    no: "02",
    title: "권한은 역할과 담당 범위로 함께 제한합니다",
    body: [
      "기본값은 거부입니다. 역할이 허용하는 동작이라도 담당 범위 밖의 반·학습자에는 적용되지 않습니다.",
      "역할 변경, 대량 내보내기, 개인정보 삭제처럼 되돌리기 어려운 작업에는 재인증을 요구합니다.",
      "권한 검사는 캐시나 읽기 모델의 응답에 의존하지 않습니다. 검색 색인이 지연되어도 원본 권한 정책을 우회할 수 없습니다.",
    ],
  },
  {
    no: "03",
    title: "테넌트 격리는 데이터베이스에서 강제합니다",
    body: [
      "조직 스코프를 가진 모든 테이블에 PostgreSQL 행 수준 보안(RLS) 정책을 적용합니다. 애플리케이션 코드의 조건문만으로 격리를 보장하지 않습니다.",
      "서버는 인증 세션에서 확정한 조직 식별자만 사용합니다. 클라이언트가 보낸 테넌트 ID를 권한 근거로 신뢰하지 않습니다.",
      "같은 경계를 파일 저장소 경로, 캐시 키, 작업 큐 메시지, 내보내기 파일에도 적용합니다.",
    ],
  },
  {
    no: "04",
    title: "바뀐 일은 기록으로 남깁니다",
    body: [
      "루트 게시, 채점 확정, 숙련도 변경, 일정 재계산 같은 되돌리기 어려운 변경은 행위자·시각·이유·변경 전후와 함께 감사 기록으로 남습니다.",
      "자동 처리와 사람의 수동 변경을 구분해 기록하므로, 어떤 변경이 규칙에 의한 것이고 어떤 변경이 판단에 의한 것인지 나중에도 확인할 수 있습니다.",
      "일반 관리자는 감사 기록을 수정할 수 없습니다.",
    ],
  },
  {
    no: "05",
    title: "검수를 통과한 문항만 출제합니다",
    body: [
      "출처와 사용 권한이 확인되지 않았거나 품질 검수를 통과하지 못한 문항은 자동 출제 풀에 들어가지 않습니다.",
      "수식이 파싱되지 않거나 웹과 인쇄 결과가 달라지는 문항은 중립 텍스트로 조용히 대체하지 않고 검수 격리합니다.",
      "권한이 만료되거나 사용 중지되면 신규 배정과 이미 만들어진 인쇄 파일·다운로드 링크까지 영향 범위를 추적해 차단합니다.",
    ],
  },
  {
    no: "06",
    title: "업로드와 AI 처리를 데이터로만 취급합니다",
    body: [
      "업로드 파일은 확장자가 아니라 실제 파일 서명으로 확인하고, 크기·페이지 수·해상도 한도를 적용합니다.",
      "PDF와 이미지에서 추출한 텍스트에 지시문이 섞여 있어도 데이터로만 처리합니다. 추출된 텍스트가 시스템 프롬프트, 도구 호출, 권한을 바꿀 수 없습니다.",
      "AI 공급자에는 해당 작업에 필요한 최소 데이터만 전송하며, 결과는 서버의 허용 목록과 수학 검증을 통과한 것만 저장·게시합니다.",
    ],
  },
] as const;

const SECRETS = [
  "전송 구간은 TLS로 보호하고, 저장 데이터와 백업은 암호화합니다.",
  "서버 전용 키는 클라이언트 번들·저장소·설정 파일에 넣지 않습니다.",
  "비밀번호, 토큰, API 키, 학생 답안 전문은 로그에 남기지 않습니다.",
  "파일 다운로드는 만료가 짧은 서명 URL을 사용하고 내려받는 시점에 권한을 다시 확인합니다.",
  "운영·개발·스테이징 환경의 계정과 데이터를 분리하고, 개발·테스트에 실제 학생 정보를 복사하지 않습니다.",
  "공개 데모와 샘플 화면은 합성 데이터만 사용합니다.",
] as const;

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-12 lg:px-6 lg:py-16">
      <p className="font-mono text-sm text-pen">데이터와 권한 원칙</p>
      <h1 className="mt-2 font-[MaruBuri] text-3xl font-semibold">
        지키기 쉬운 방법은 처음부터 갖지 않는 것입니다.
      </h1>
      <p className="mt-5 leading-relaxed text-ink-soft">
        수맥은 미성년자의 학습 데이터를 다룹니다. 그래서 보안을 기능 목록이
        아니라 데이터 수집 범위와 권한 구조 자체로 설계했습니다. 아래는 제품이
        따르는 원칙이며, 취득하지 않은 인증이나 검증되지 않은 수치는 적지
        않습니다.
      </p>

      {/* ── 수집 범위 ── */}
      <section className="mt-12">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          무엇을 수집하고, 무엇을 수집하지 않는지
        </h2>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left">
                <th scope="col" className="w-[15%] py-3 pr-4 font-semibold text-ink-soft">
                  대상
                </th>
                <th scope="col" className="w-[45%] py-3 pr-4 font-semibold text-pen">
                  수집
                </th>
                <th scope="col" className="py-3 font-semibold text-grade">
                  수집하지 않음
                </th>
              </tr>
            </thead>
            <tbody className="[&_td]:py-3 [&_td]:align-top [&_tr]:border-b [&_tr]:border-rule-soft">
              {MINIMAL_COLLECTION.map((row) => (
                <tr key={row.label}>
                  <td className="pr-4 font-medium">{row.label}</td>
                  <td className="pr-4 leading-relaxed">{row.collect}</td>
                  <td className="leading-relaxed text-ink-soft">{row.skip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 원칙 ── */}
      <section className="mt-14">
        <h2 className="font-[MaruBuri] text-xl font-semibold">여섯 가지 원칙</h2>
        <div className="mt-6 space-y-6">
          {PRINCIPLES.map((p) => (
            <article
              key={p.no}
              className="rounded-lg border border-rule bg-surface p-5"
            >
              <p className="font-mono text-xs text-pen">{p.no}</p>
              <h3 className="mt-1.5 font-semibold">{p.title}</h3>
              <ul className="mt-3 space-y-2.5">
                {p.body.map((line) => (
                  <li
                    key={line}
                    className="border-l-2 border-rule-soft pl-4 text-sm leading-relaxed text-ink-soft"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* ── 비밀값과 환경 ── */}
      <section className="mt-14">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          비밀값과 환경 분리
        </h2>
        <ul className="mt-5 space-y-2.5">
          {SECRETS.map((line) => (
            <li
              key={line}
              className="flex items-start gap-2.5 text-sm leading-relaxed"
            >
              <span aria-hidden className="mt-0.5 font-mono text-pen">
                ·
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 운영자 접근 ── */}
      <section className="mt-14">
        <h2 className="font-[MaruBuri] text-xl font-semibold">
          고객지원을 위한 접근
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          운영자가 고객 데이터를 봐야 하는 상황에서는 상시 권한을 주지 않고,
          사유와 시간 제한과 승인이 붙는 임시 접근 방식을 사용합니다. 접근
          사실은 감사 기록에 남으며, 가능한 경우 워크스페이스 소유자에게
          표시합니다.
        </p>
      </section>

      {/* ── 정직한 고지 ── */}
      <section className="mt-14 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">밝혀 두는 것</h2>
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-soft">
          <li>
            이 문서는 제품이 따르는 설계 원칙을 설명합니다. 현재 수맥은 외부
            보안 인증이나 제3자 감사 보고서를 보유하고 있지 않으며, 보유하지
            않은 인증을 보유한 것처럼 표시하지 않습니다.
          </li>
          <li>
            적용 법률과 출판사 계약의 최종 판단은 법률 검토 대상입니다. 시스템은
            권한 상태를 기록하고 강제할 뿐, 권리 확보 자체를 보증하지 않습니다.
          </li>
          <li>
            보안 취약점을 발견하셨다면{" "}
            <Link href="/request-demo" className="text-pen underline underline-offset-2">
              문의 양식
            </Link>
            으로 알려 주세요. 확인 후 처리 경과를 회신합니다.
          </li>
        </ul>
      </section>

      <nav aria-label="관련 문서" className="mt-12 flex flex-wrap gap-3 text-sm">
        <Link
          href="/privacy"
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 transition-colors hover:border-pen"
        >
          개인정보 처리방침
        </Link>
        <Link
          href="/content-policy"
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 transition-colors hover:border-pen"
        >
          콘텐츠 출처·사용 권한 정책
        </Link>
        <Link
          href="/terms"
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 transition-colors hover:border-pen"
        >
          이용약관
        </Link>
      </nav>
    </div>
  );
}
