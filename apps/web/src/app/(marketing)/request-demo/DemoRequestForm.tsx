"use client";

import { useActionState } from "react";
import { submitDemoRequest } from "./actions";
import {
  INITIAL_DEMO_REQUEST_STATE,
  ROLE_OPTIONS,
  type DemoRequestField,
} from "./schema";

const FIELD_BASE =
  "mt-1.5 w-full rounded-[var(--radius-control)] border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-pen";

function fieldClass(hasError: boolean): string {
  return `${FIELD_BASE} ${hasError ? "border-grade" : "border-rule"}`;
}

function errorId(field: DemoRequestField): string {
  return `${field}-error`;
}

export function DemoRequestForm() {
  const [state, formAction, isPending] = useActionState(
    submitDemoRequest,
    INITIAL_DEMO_REQUEST_STATE,
  );

  const { fieldErrors, values } = state;

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="rounded-lg border border-pen bg-pen-soft/40 p-6"
      >
        <p className="font-[MaruBuri] text-xl font-semibold">{state.message}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          영업일 기준 2일 안에 남겨 주신 이메일로 회신합니다. 회신 전까지는{" "}
          <a href="/demo" className="text-pen underline underline-offset-2">
            샘플 반 체험
          </a>
          에서 실제 화면을 먼저 살펴보실 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.status === "error" && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-grade bg-grade-soft px-4 py-3 text-sm"
        >
          {state.message}
        </p>
      )}

      <div>
        <label htmlFor="name" className="text-sm font-medium">
          이름
          <span className="ml-1 text-grade" aria-hidden>
            *
          </span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="name"
          maxLength={80}
          defaultValue={values.name ?? ""}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? errorId("name") : undefined}
          className={fieldClass(Boolean(fieldErrors.name))}
        />
        {fieldErrors.name && (
          <p id={errorId("name")} className="mt-1.5 text-xs text-grade">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="email" className="text-sm font-medium">
          이메일
          <span className="ml-1 text-grade" aria-hidden>
            *
          </span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          maxLength={254}
          defaultValue={values.email ?? ""}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? errorId("email") : undefined}
          className={fieldClass(Boolean(fieldErrors.email))}
        />
        {fieldErrors.email && (
          <p id={errorId("email")} className="mt-1.5 text-xs text-grade">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="organizationName" className="text-sm font-medium">
            소속
            <span className="ml-1.5 font-normal text-ink-soft">(선택)</span>
          </label>
          <input
            id="organizationName"
            name="organizationName"
            type="text"
            maxLength={120}
            defaultValue={values.organizationName ?? ""}
            aria-invalid={fieldErrors.organizationName ? true : undefined}
            aria-describedby={
              fieldErrors.organizationName
                ? errorId("organizationName")
                : undefined
            }
            className={fieldClass(Boolean(fieldErrors.organizationName))}
          />
          {fieldErrors.organizationName && (
            <p
              id={errorId("organizationName")}
              className="mt-1.5 text-xs text-grade"
            >
              {fieldErrors.organizationName}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="role" className="text-sm font-medium">
            역할
            <span className="ml-1.5 font-normal text-ink-soft">(선택)</span>
          </label>
          <select
            id="role"
            name="role"
            defaultValue={values.role ?? ""}
            aria-invalid={fieldErrors.role ? true : undefined}
            aria-describedby={fieldErrors.role ? errorId("role") : undefined}
            className={fieldClass(Boolean(fieldErrors.role))}
          >
            <option value="">선택 안 함</option>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          {fieldErrors.role && (
            <p id={errorId("role")} className="mt-1.5 text-xs text-grade">
              {fieldErrors.role}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="message" className="text-sm font-medium">
          문의 내용
          <span className="ml-1.5 font-normal text-ink-soft">(선택)</span>
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          maxLength={2000}
          defaultValue={values.message ?? ""}
          placeholder="가르치는 학년과 반 구성, 지금 가장 오래 걸리는 작업을 적어 주시면 그에 맞춰 안내드립니다."
          aria-invalid={fieldErrors.message ? true : undefined}
          aria-describedby={fieldErrors.message ? errorId("message") : undefined}
          className={`${fieldClass(Boolean(fieldErrors.message))} resize-y leading-relaxed`}
        />
        {fieldErrors.message && (
          <p id={errorId("message")} className="mt-1.5 text-xs text-grade">
            {fieldErrors.message}
          </p>
        )}
      </div>

      {/* 봇 차단용 숨김 필드 — 사람에게 노출되지 않는다. */}
      <div aria-hidden className="hidden">
        <label htmlFor="website">웹사이트</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-[var(--radius-control)] bg-pen px-6 py-2.5 font-medium text-white transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:bg-rule"
        >
          {isPending ? "접수 중…" : "문의 보내기"}
        </button>
        <p className="text-xs text-ink-soft">
          보내 주신 정보는 도입 안내 목적으로만 사용합니다.
        </p>
      </div>
    </form>
  );
}
