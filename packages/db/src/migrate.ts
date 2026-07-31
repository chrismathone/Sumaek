import { config } from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// 워크스페이스 루트의 .env를 로드 (패키지 디렉터리에서 실행되므로)
config({ path: [".env", "../../.env"] });

/**
 * SQL 마이그레이션 러너.
 * migrations/*.sql을 파일명 순으로 적용하고 su_maek_migrations 테이블에 기록한다.
 * drizzle-kit generate 산출물과 수기 RLS·제약 SQL을 같은 폴더에서 관리한다.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    await sql`
      create table if not exists su_maek_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    const applied = new Set(
      (await sql`select name from su_maek_migrations`).map((r) => r.name as string),
    );
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(join(migrationsDir, file), "utf8");
      console.log(`[migrate] 적용: ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into su_maek_migrations (name) values (${file})`;
      });
    }
    console.log("[migrate] 완료");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[migrate] 실패", error);
  process.exit(1);
});
