import { z } from "zod";

/* 도입 문의 폼의 계약. 서버 액션과 클라이언트 폼이 함께 참조한다.
 * ("use server" 파일은 async 함수만 내보낼 수 있으므로 상수·타입은 여기에 둔다.) */

export const ROLE_OPTIONS = [
  "개인 교사",
  "교무·교육과정 책임자",
  "콘텐츠팀",
  "기타",
] as const;

export type DemoRequestRole = (typeof ROLE_OPTIONS)[number];

export const DEMO_REQUEST_FIELDS = [
  "name",
  "email",
  "organizationName",
  "role",
  "message",
] as const;

export type DemoRequestField = (typeof DEMO_REQUEST_FIELDS)[number];

export type DemoRequestState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors: Partial<Record<DemoRequestField, string>>;
  /** 오류 시 입력값을 되살리기 위해 유지한다. 성공 시에는 비운다. */
  values: Partial<Record<DemoRequestField, string>>;
};

export const INITIAL_DEMO_REQUEST_STATE: DemoRequestState = {
  status: "idle",
  message: "",
  fieldErrors: {},
  values: {},
};

export const DemoRequestSchema = z.object({
  name: z
    .string("이름을 입력해 주세요.")
    .trim()
    .min(1, "이름을 입력해 주세요.")
    .max(80, "이름은 80자 이내로 입력해 주세요."),
  email: z
    .email("이메일 형식을 확인해 주세요.")
    .trim()
    .max(254, "이메일은 254자 이내로 입력해 주세요."),
  organizationName: z
    .string()
    .trim()
    .max(120, "소속은 120자 이내로 입력해 주세요.")
    .optional(),
  role: z.enum(ROLE_OPTIONS, "역할을 목록에서 선택해 주세요.").optional(),
  message: z
    .string()
    .trim()
    .max(2000, "문의 내용은 2000자 이내로 입력해 주세요.")
    .optional(),
});
