"use server";

import { createSql } from "@su-maek/db";
import {
  DEMO_REQUEST_FIELDS,
  DemoRequestSchema,
  type DemoRequestField,
  type DemoRequestState,
} from "./schema";

/* 도입 문의 접수 (골프롬프트 6장 /request-demo).
 * demo_requests는 테넌트 이전 데이터로, RLS에서 authenticated 접근이 차단되어 있고
 * 서버에서만 기록한다. 저장에 실패하면 성공으로 표시하지 않고 그대로 알린다. */

/** 빈 문자열은 미입력으로 취급한다. */
function readField(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function submitDemoRequest(
  _prevState: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  const values: Partial<Record<DemoRequestField, string>> = {};
  for (const field of DEMO_REQUEST_FIELDS) {
    const value = readField(formData, field);
    if (value !== undefined) values[field] = value;
  }

  // 봇 차단용 숨김 필드. 사람에게 보이지 않으므로 값이 있으면 저장하지 않는다.
  if (readField(formData, "website") !== undefined) {
    return {
      status: "error",
      message: "문의를 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      fieldErrors: {},
      values,
    };
  }

  const parsed = DemoRequestSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<DemoRequestField, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (
        typeof key === "string" &&
        (DEMO_REQUEST_FIELDS as readonly string[]).includes(key)
      ) {
        const field = key as DemoRequestField;
        fieldErrors[field] ??= issue.message;
      }
    }
    return {
      status: "error",
      message: "입력한 내용을 확인해 주세요.",
      fieldErrors,
      values,
    };
  }

  const data = parsed.data;
  let sql: ReturnType<typeof createSql> | undefined;
  try {
    sql = createSql({ pooled: true });
    await sql`
      insert into demo_requests (name, email, organization_name, role, message)
      values (
        ${data.name},
        ${data.email},
        ${data.organizationName ?? null},
        ${data.role ?? null},
        ${data.message ?? null}
      )
    `;
  } catch (error) {
    // DATABASE_URL 미설정과 연결 실패가 모두 여기로 온다. 원인은 서버 로그에만 남긴다.
    console.error("[request-demo] 도입 문의 저장 실패", error);
    return {
      status: "error",
      message: "일시적으로 접수가 어렵습니다. 이메일로 문의해 주세요.",
      fieldErrors: {},
      values,
    };
  } finally {
    if (sql) {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  }

  return {
    status: "success",
    message: "문의를 접수했습니다.",
    fieldErrors: {},
    values: {},
  };
}
