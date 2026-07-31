import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "로그인" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="text-lg font-bold">
          수맥
          <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-soft">
            Su-Maek
          </span>
        </Link>
        <h1 className="mt-6 font-[MaruBuri] text-2xl font-semibold">로그인</h1>
        <p className="mt-1 text-sm text-ink-soft">
          수업 운영 워크스페이스로 들어갑니다.
        </p>
        <div className="mt-6">
          <LoginForm next={next ?? "/app/today"} />
        </div>
        <p className="mt-6 text-center text-sm text-ink-soft">
          아직 워크스페이스가 없나요?{" "}
          <Link href="/request-demo" className="text-pen underline underline-offset-4">
            도입 문의
          </Link>
        </p>
      </div>
    </main>
  );
}
