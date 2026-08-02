/* ─────────────────────────────────────────────────────────────
 * 테스트 계정 — 한 곳에서만 정의한다.
 *
 * 예전에는 이메일·비밀번호가 스펙 15개에 그대로 박혀 있었다. 비밀번호를
 * 한 번 바꾸려면 15곳을 고쳐야 했고, 한 곳을 놓치면 그 스펙만 로그인부터
 * 깨진다. 바뀌는 값은 한 곳에 둔다.
 *
 * 사람이 손으로 확인하는 계정(st2000423 / st2000424)은 **여기 없다.**
 * 테스트는 그 계정을 건드리지 않는다 — 같은 계정을 사람과 테스트가 나눠
 * 쓰다가 테스트가 도는 사이 로그인하면 「학습자 정보가 연결되지 않았습니다」가
 * 뜨는 일을 겪었다. 계정도 학습자도 갈라 두는 것이 그 답이다.
 * ───────────────────────────────────────────────────────────── */

export interface TestAccount {
  email: string;
  password: string;
}

/** 시드가 만드는 데모 계정의 기본 비밀번호 (packages/db/src/seed/demo-account.ts와 같은 값) */
const DEFAULT_PASSWORD = "1234@@@@";

export const TEACHER: TestAccount = {
  email: "demo-teacher@su-maek.app",
  password: process.env.DEMO_TEACHER_PASSWORD ?? DEFAULT_PASSWORD,
};

export const STUDENT: TestAccount = {
  email: "demo-student@su-maek.app",
  password: process.env.DEMO_STUDENT_PASSWORD ?? DEFAULT_PASSWORD,
};
