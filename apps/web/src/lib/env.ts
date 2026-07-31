/**
 * 환경변수 정리 — CLI로 주입된 값의 잔여 개행·공백(\r 포함)을 제거한다.
 * eywa 실사고 반영: CRLF가 섞인 키는 "Invalid API key"가 되고, 상위의
 * 포괄 오류 처리에 가려 로그인 실패로 오인된다.
 */
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
export const SUPABASE_ANON_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
).trim();
