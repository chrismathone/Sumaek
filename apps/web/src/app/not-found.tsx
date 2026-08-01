import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "찾을 수 없는 화면" };

/* 전역 404 착지 지점 — notFound()는 제품 7곳(문항·테스트·결과·반·학생·경로)에서 불린다.
 * 이 화면은 교사인지 학생인지 모른 채 렌더되므로 역할 전용 경로로 보내지 않는다.
 * 조회를 소유자·조직으로 걸러낸 뒤 없으면 404로 끝내는 곳들도 여기로 온다 —
 * 그래서 "없다"와 "내 것이 아니다"를 구분해서 말하지 않는다 (구분해 주면 존재가 새어 나간다). */

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <p className="font-mono text-xs text-ink-soft">404</p>
      <h1 className="mt-1 font-[MaruBuri] text-2xl font-semibold">
        요청한 화면을 찾을 수 없습니다
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        주소가 잘못되었거나, 자료가 지워졌거나, 지금 로그인한 계정으로는 열 수 없는
        자료입니다.
      </p>

      <div className="mt-6 rounded-[var(--radius-control)] border border-rule bg-surface p-4">
        <p className="text-sm font-medium">여기서 갈 수 있는 곳</p>
        <p className="mt-2 text-sm text-ink-soft">
          보던 화면으로는 브라우저 뒤로가기로 돌아갈 수 있습니다.
        </p>
        <Link
          href="/"
          className="mt-3 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
        >
          홈으로
        </Link>
      </div>
    </div>
  );
}
