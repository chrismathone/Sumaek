import "dotenv/config";

/** 합성 시드 — 실제 학생 개인정보를 절대 사용하지 않는다. DB 스키마 구축 후 구현. */
async function main(): Promise<void> {
  console.log("[seed] 스키마 구축 후 합성 데이터 시드가 구현된다.");
}

main().catch((error) => {
  console.error("[seed] 실패", error);
  process.exit(1);
});
