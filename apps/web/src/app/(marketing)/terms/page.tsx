import type { Metadata } from "next";
import Link from "next/link";

/* 이용약관 초안 (골프롬프트 6장 /terms).
 * 가격 정책이 확정되기 전이므로 요금·결제 조항을 만들지 않는다. */

export const metadata: Metadata = {
  title: "이용약관",
  description:
    "수맥 서비스의 정의, 계정과 보안 책임, 콘텐츠 권리, 서비스 변경·중단, 책임 제한을 정리한 초안입니다.",
};

type Article = {
  no: string;
  title: string;
  paragraphs: readonly string[];
  /** 본문 아래에 붙는 안내문. 다른 정책 문서로 연결할 때 사용한다. */
  note?: { lead: string; href: string; linkText: string; tail: string };
};

const ARTICLES: readonly Article[] = [
  {
    no: "제1조",
    title: "서비스의 정의",
    paragraphs: [
      "수맥(이하 “서비스”)은 수학 수업의 학습 루트 설계, 진도·평가 일정 계산, 문항 관리와 자동 출제·채점, 학습 증거 분석을 제공하는 소프트웨어입니다.",
      "서비스는 학원 경영 관리 프로그램이 아닙니다. 수납·회계, 입학 상담과 영업 관리, 등하원 전자출결, 차량 운행, 급여·인사 관리 기능은 제공하지 않습니다.",
      "자동 채점과 학습 분석 결과는 선생님의 교육적 판단을 돕는 참고 자료이며, 성적 확정과 학습 지도의 최종 결정은 이용자에게 있습니다.",
    ],
  },
  {
    no: "제2조",
    title: "이용 계약과 워크스페이스",
    paragraphs: [
      "서비스는 워크스페이스 단위로 제공되며, 워크스페이스 소유자가 소속 구성원의 계정 생성과 역할 부여를 관리합니다.",
      "워크스페이스에 등록된 학습자 정보의 수집 근거와 동의 확보는 해당 워크스페이스를 운영하는 이용자의 책임입니다. 회사는 이용자의 지시에 따라 해당 정보를 처리합니다.",
      "요금 정책이 확정되기 전까지 이 약관은 유상 서비스의 요금·결제·환불 조건을 정하지 않습니다. 해당 조건은 별도 계약 또는 개정 약관으로 정합니다.",
    ],
  },
  {
    no: "제3조",
    title: "계정과 보안 책임",
    paragraphs: [
      "이용자는 계정 인증 정보를 제3자와 공유해서는 안 되며, 계정으로 이루어진 활동에 대해 책임을 집니다.",
      "이용자는 담당 범위에 맞는 최소 권한만 구성원에게 부여해야 합니다. 퇴직·역할 변경이 발생하면 지체 없이 권한을 회수해야 합니다.",
      "계정 도용이나 무단 접근이 의심되면 즉시 회사에 알리고 비밀번호와 세션을 재설정해야 합니다.",
      "회사는 이상 접근을 탐지한 경우 이용자 보호를 위해 세션을 종료하거나 접근을 일시 제한할 수 있으며, 사후에 그 사실과 사유를 알립니다.",
    ],
  },
  {
    no: "제4조",
    title: "금지 행위",
    paragraphs: [
      "이용자는 다음 행위를 해서는 안 됩니다. 서비스의 취약점 탐색·우회를 시도하는 행위, 다른 워크스페이스의 데이터에 접근하려는 행위, 자동화 수단으로 과도한 부하를 발생시키는 행위, 시험 전 문항과 정답을 응시자에게 유출하는 행위.",
      "이용자는 권리를 보유하지 않은 저작물을 서비스에 업로드하거나, 업로드한 저작물의 허용 범위를 벗어나 사용해서는 안 됩니다.",
      "보안 취약점을 발견한 경우 이를 악용하지 않고 회사에 알려 주시면 확인 후 처리 경과를 회신합니다.",
    ],
  },
  {
    no: "제5조",
    title: "콘텐츠의 권리",
    paragraphs: [
      "이용자가 업로드한 교재·문항·자료(이하 “이용자 콘텐츠”)의 권리는 이용자 또는 원권리자에게 있습니다. 회사는 서비스 제공에 필요한 범위에서만 이를 저장·처리·표시합니다.",
      "이용자 콘텐츠의 출처와 사용 권한을 확인할 책임은 업로드한 이용자에게 있습니다. 회사는 권한 상태를 기록하고 자동 출제 여부를 제어할 뿐, 권리 확보 자체를 보증하지 않습니다.",
      "권한이 확인되지 않았거나 만료·중지된 콘텐츠는 자동 출제 대상에서 제외되며, 회사는 권리자의 정당한 요청이 있으면 해당 콘텐츠의 처리와 배포를 중단할 수 있습니다.",
      "서비스 자체의 소프트웨어, 화면 구성, 개념 체계와 알고리즘에 관한 권리는 회사에 있습니다. 서비스가 생성한 시험지·리포트의 이용 권한은 해당 워크스페이스에 부여됩니다.",
    ],
    note: {
      lead: "출처 확인 절차와 권한 상태별 처리 기준은 ",
      href: "/content-policy",
      linkText: "콘텐츠 출처·사용 권한 정책",
      tail: "에 정리했습니다.",
    },
  },
  {
    no: "제6조",
    title: "서비스의 변경과 중단",
    paragraphs: [
      "회사는 서비스의 기능을 개선·변경할 수 있습니다. 이용자의 기존 데이터 해석이나 자동화 동작에 영향을 주는 변경은 사전에 고지합니다.",
      "정기 점검, 설비 장애, 천재지변 등으로 서비스 제공이 일시 중단될 수 있습니다. 예정된 점검은 사전에, 불가피한 중단은 확인 즉시 알립니다.",
      "서비스 전체 또는 일부를 종료하는 경우 최소 30일 전에 고지하고, 이용자가 자신의 데이터를 표준 형식으로 내보낼 수 있는 기간과 수단을 제공합니다.",
      "이미 게시된 학습 루트, 오늘 수업, 응시와 채점 기록은 외부 연동이 끊기더라도 계속 동작하도록 설계합니다.",
    ],
  },
  {
    no: "제7조",
    title: "이용자의 데이터",
    paragraphs: [
      "워크스페이스의 데이터는 이용자에게 귀속됩니다. 회사는 서비스 제공, 장애 대응, 법령 준수 목적 외에 이를 이용하지 않습니다.",
      "이용자는 언제든 자신의 데이터를 내보낼 수 있으며, 계약 종료 시 정해진 기간이 지나면 데이터를 삭제합니다. 삭제 범위와 절차는 개인정보 처리방침에 따릅니다.",
      "회사는 이용자 데이터를 다른 이용자에게 광고·판매하지 않으며, 이용자 동의 없이 AI 모델 학습에 사용하지 않습니다.",
    ],
  },
  {
    no: "제8조",
    title: "책임의 제한",
    paragraphs: [
      "서비스는 제공되는 상태 그대로 제공되며, 회사는 특정 학습 성과나 성적 향상을 보증하지 않습니다.",
      "자동 생성된 일정·시험지·채점 결과는 이용자의 검토를 전제로 합니다. 이용자가 검토 없이 사용한 결과에 대해 회사는 책임을 지지 않습니다.",
      "회사는 고의 또는 중대한 과실이 없는 한, 이용자에게 발생한 간접·특별·결과적 손해와 데이터 이용 기회 상실에 대해 책임을 지지 않습니다.",
      "이용자가 업로드한 콘텐츠의 권리 침해로 발생한 분쟁은 해당 이용자가 해결하며, 회사에 손해가 발생한 경우 이를 배상합니다.",
    ],
  },
  {
    no: "제9조",
    title: "약관의 변경",
    paragraphs: [
      "회사는 약관을 변경할 수 있으며, 변경 시 적용일과 변경 내용을 최소 7일 전(이용자에게 불리한 변경은 30일 전)에 서비스 내 공지 또는 이메일로 알립니다.",
      "이용자가 변경에 동의하지 않는 경우 적용일 전에 이용 계약을 해지할 수 있습니다.",
    ],
  },
  {
    no: "제10조",
    title: "준거법과 분쟁 해결",
    paragraphs: [
      "이 약관은 대한민국 법률에 따릅니다.",
      "서비스 이용과 관련한 분쟁은 상호 협의로 해결하는 것을 원칙으로 하며, 협의가 이루어지지 않으면 관계 법령이 정한 절차에 따릅니다.",
    ],
  },
] as const;

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-12 lg:px-6 lg:py-16">
      <p className="font-mono text-sm text-pen">이용약관</p>
      <h1 className="mt-2 font-[MaruBuri] text-3xl font-semibold">이용약관</h1>
      <p className="mt-3 font-mono text-xs text-ink-soft">초안 · 법률 검토 전</p>
      <p className="mt-5 leading-relaxed text-ink-soft">
        수맥 서비스를 이용하실 때 적용되는 조건입니다. 서비스가 무엇을 하고
        무엇을 하지 않는지, 데이터와 콘텐츠의 권리가 누구에게 있는지를 먼저
        밝힙니다.
      </p>

      <div className="mt-12 space-y-10">
        {ARTICLES.map((article) => (
          <section key={article.no}>
            <h2 className="font-[MaruBuri] text-xl font-semibold">
              <span className="mr-2 font-mono text-sm font-normal text-pen">
                {article.no}
              </span>
              {article.title}
            </h2>
            <ol className="mt-4 space-y-3">
              {article.paragraphs.map((text, i) => (
                <li
                  key={text}
                  className="flex items-start gap-3 text-sm leading-relaxed"
                >
                  <span className="mt-0.5 shrink-0 font-mono text-xs text-ink-soft">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
            {article.note && (
              <p className="mt-3 pl-8 text-sm leading-relaxed text-ink-soft">
                {article.note.lead}
                <Link
                  href={article.note.href}
                  className="text-pen underline underline-offset-2"
                >
                  {article.note.linkText}
                </Link>
                {article.note.tail}
              </p>
            )}
          </section>
        ))}
      </div>

      <p className="mt-12 rounded-lg border border-rule bg-surface px-5 py-4 text-sm leading-relaxed text-ink-soft">
        이 문서는 서비스 설계 원칙에 근거해 작성한{" "}
        <strong className="font-semibold text-ink">초안</strong>이며 법률 자문을
        거치지 않았습니다. 정식 서비스 개시 전 법률 검토를 거쳐 확정하고,
        확정본에는 시행일과 개정 이력, 회사 정보와 연락처를 함께 표기합니다.
      </p>

      <nav aria-label="관련 문서" className="mt-8 flex flex-wrap gap-3 text-sm">
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
          href="/security"
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 transition-colors hover:border-pen"
        >
          데이터와 권한 원칙
        </Link>
      </nav>
    </div>
  );
}
