/**
 * 수맥 백그라운드 워커 진입점.
 * 일정·평가·리포트 워커, mathg-gen OCR·AI 워커, 수식 검증·PDF·HWP 출력 워커가
 * 하나의 프로세스 그룹에서 큐 토픽별로 실행된다. (독립 배포·확장 가능)
 */
async function main(): Promise<void> {
  // 구현 예정: SKIP LOCKED 기반 작업 큐 폴링 루프 (packages/db의 job 테이블)
  console.log("[su-maek worker] 부팅 — 큐 소비자는 DB 스키마 구축 후 연결된다.");
}

main().catch((error) => {
  console.error("[su-maek worker] 치명적 오류", error);
  process.exit(1);
});
