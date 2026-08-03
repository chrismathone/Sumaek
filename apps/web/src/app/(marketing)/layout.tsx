import Link from "next/link";
import { SumaekLogo } from "@/components/brand/SumaekLogo";

const NAV_ITEMS = [
  { href: "/#operations", label: "운영 방식" },
  { href: "/#tracks", label: "반·개별 진도" },
  { href: "/#assessment", label: "자동 평가" },
  { href: "/#bank", label: "문제은행" },
  { href: "/request-demo", label: "도입 안내" },
];

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:px-4 focus:py-2"
      >
        본문으로 건너뛰기
      </a>
      <header className="sticky top-0 z-40 border-b border-rule-soft bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-2 px-4 lg:px-6">
          <Link href="/" aria-label="수맥 홈" className="inline-flex shrink-0 items-center">
            <SumaekLogo
              variant="header"
              className="h-8 w-auto sm:h-11"
              sizes="128px"
            />
          </Link>
          <nav aria-label="주요 메뉴" className="hidden items-center gap-5 md:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-ink-soft transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/login"
              className="whitespace-nowrap rounded-[var(--radius-control)] px-2 py-1.5 text-sm text-ink-soft hover:text-ink sm:px-3"
            >
              로그인
            </Link>
            <Link
              href="/demo"
              className="whitespace-nowrap rounded-[var(--radius-control)] bg-pen px-2.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-ink sm:px-3.5"
            >
              샘플 반 체험하기
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-rule-soft bg-ink text-white/80">
        <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:px-6">
          <div>
            <SumaekLogo
              variant="reverse"
              className="h-14 w-auto"
              sizes="128px"
            />
            <p className="mt-2 font-mono text-[10px] tracking-[0.13em] text-wash">
              THE CONTEXT OF MATHEMATICS
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              수업 계획은 한 번.
              <br />
              오늘의 진도와 테스트는 자동으로.
            </p>
          </div>
          <nav aria-label="제품" className="text-sm">
            <p className="mb-2 font-semibold text-white">제품</p>
            <ul className="space-y-1.5">
              <li><Link href="/product" className="hover:text-white">제품 상세</Link></li>
              <li><Link href="/demo" className="hover:text-white">샘플 반 체험</Link></li>
              <li><Link href="/security" className="hover:text-white">데이터와 권한 원칙</Link></li>
            </ul>
          </nav>
          <nav aria-label="정책" className="text-sm">
            <p className="mb-2 font-semibold text-white">정책</p>
            <ul className="space-y-1.5">
              <li><Link href="/privacy" className="hover:text-white">개인정보 처리방침</Link></li>
              <li><Link href="/terms" className="hover:text-white">이용약관</Link></li>
              <li><Link href="/content-policy" className="hover:text-white">콘텐츠 출처·사용 권한 정책</Link></li>
            </ul>
          </nav>
          <nav aria-label="문의" className="text-sm">
            <p className="mb-2 font-semibold text-white">문의</p>
            <ul className="space-y-1.5">
              <li><Link href="/request-demo" className="hover:text-white">도입 문의</Link></li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
