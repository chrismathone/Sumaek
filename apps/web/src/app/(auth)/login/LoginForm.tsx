"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    signIn,
    { error: null },
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1.5 w-full rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2.5 focus:border-pen focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1.5 w-full rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2.5 focus:border-pen focus:outline-none"
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-grade-soft px-3 py-2 text-sm text-grade">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[var(--radius-control)] bg-pen py-2.5 font-medium text-white transition-colors hover:bg-ink disabled:opacity-60"
      >
        {pending ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
