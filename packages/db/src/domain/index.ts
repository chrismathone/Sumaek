/** 도메인 오케스트레이션 — 코어 엔진 + SQL 트랜잭션. 웹·워커가 공유한다. */
export * from "./schedule";
export * from "./learner-schedule";
export * from "./learner-day-plan";
/** 반 수업 마감 — SessionCompleted(E-02)를 발행하는 유일한 경로 (T4.2 · G-03). */
export * from "./session-execution";
/** 평가 정책 해석 — 준비도 게이트와 생성기가 **같은 답**을 본다 (T3.3). */
export * from "./assessment-policy";
/** 평가 자동 생성 — 웹 액션과 워커 핸들러가 같은 함수를 쓴다 (ADR-0018 §5). */
export * from "./assessment-generation";
/** 그 생성을 **때가 되면 스스로** 부르는 주기 생산자 (T3.2 · G-04). */
export * from "./assessment-schedule";
export * from "./ingestion";
export * from "./privacy";
export * from "./ai-usage";
export * from "./ai-canary";
export * from "./operator-access";
export * from "./curriculum-release";
