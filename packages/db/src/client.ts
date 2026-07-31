import postgres from "postgres";

/**
 * 서버 전용 DB 클라이언트. 클라이언트 번들에 포함되어서는 안 된다.
 * DATABASE_URL: Supabase Direct 연결(마이그레이션·워커),
 * DATABASE_POOLER_URL: 트랜잭션 풀러(웹 요청 경로) — 없으면 DATABASE_URL 사용.
 */
export function createSql(options?: { pooled?: boolean }): postgres.Sql {
  const url = options?.pooled
    ? (process.env.DATABASE_POOLER_URL ?? process.env.DATABASE_URL)
    : process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL이 설정되지 않았습니다. .env를 확인하세요 (.env.example 참고).",
    );
  }
  return postgres(url, {
    prepare: options?.pooled ? false : true,
    max: options?.pooled ? 10 : 4,
    idle_timeout: 30,
  });
}

let sharedSql: postgres.Sql | undefined;

/**
 * 프로세스 공유 커넥션 풀 — 웹 요청 경로 표준.
 * 요청마다 만들지 말고 이것을 사용한다. 종료하지 않는다 (프로세스 수명).
 */
export function getSharedSql(): postgres.Sql {
  if (!sharedSql) {
    sharedSql = createSql({ pooled: true });
  }
  return sharedSql;
}
