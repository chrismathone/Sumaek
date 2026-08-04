import type postgres from "postgres";

/* ─────────────────────────────────────────────────────────────
 * Kill switch 집행 (골프롬프트 28장 · 인수 40).
 *
 * 원칙: 스위치를 꺼도 수동 운영과 확정 데이터 열람은 가능해야 한다 —
 * 그래서 집행 지점은 자동화(워커 토픽)뿐이다. 교사의 명시적 버튼은
 * 막지 않는다.
 *
 * 전역 스위치(organization_id null)는 클레임 단계에서 토픽을 제외한다 —
 * 작업이 큐에 남으므로 스위치 복구 시 그대로 재개된다 (유실 0).
 * 조직 스위치는 클레임 후 핸들러에서 확인해 작업을 연기(defer)한다 —
 * 시도 횟수를 태우지 않아 DLQ로 밀리지 않는다.
 * ───────────────────────────────────────────────────────────── */

/**
 * 평가 자동 생성 작업 토픽 — 생산자·핸들러·스위치 표의 단일 정의처.
 *
 * 이 세 곳이 같은 문자열을 각자 적고 있으면 한 곳만 바뀌었을 때 조용히
 * 어긋난다: 생산자는 작업을 만드는데 아무도 클레임하지 않거나, 스위치를
 * 꺼도 멈추지 않는다. 그래서 여기 한 번만 적는다.
 */
export const ASSESSMENT_GENERATE_TOPIC = "assessment.generate";

/** 평가 자동 생성을 멈추는 스위치 키 */
export const ASSESSMENT_GENERATION_SWITCH = "auto_assessment_generation";

/** kill switch 키 → 워커 토픽 매핑 — 코드가 단일 정의처 */
export const KILL_SWITCH_TOPICS: Readonly<Record<string, readonly string[]>> = {
  auto_reschedule: [
    "schedule.recalculate",
    "schedule.materialize",
    // 학습자 스코프 자동 재계산도 같은 스위치로 멈춘다 (인수 4·40) —
    // 교사가 화면에서 직접 누르는 실체화는 그대로 동작한다.
    "schedule.materialize-learner",
  ],
  auto_grading: ["grading.auto"],
  /* 일일·확인테스트 자동 생성 (T3.2). 꺼져 있는 동안 생산자는 작업을 만들지
   * **않고**, 이미 만들어진 작업은 큐에 남아 복구 후 그대로 실행된다.
   * 교사가 화면에서 직접 누르는 생성은 이 스위치와 무관하다 — 자동화만
   * 멈추고 수동 운영은 계속 가능해야 한다는 원칙 그대로다. */
  [ASSESSMENT_GENERATION_SWITCH]: [ASSESSMENT_GENERATE_TOPIC],
  /* 주의: 이 두 토픽에는 **핸들러도 발행부도 없다.** 렌더러
   * (apps/worker/src/export/pdf-renderer.ts)는 구현돼 있지만 어떤 토픽에도
   * 배선되지 않았고, 그래서 이 스위치를 꺼도 지금은 아무것도 멈추지 않는다.
   * 이름만 남겨 두면 "끄면 CPU가 회수된다"는 거짓 기대를 만들지만, 지우면
   * 구현이 붙을 자리마저 사라진다. 그래서 남기고 결손을 드러낸다 —
   * 단일 정의처는 apps/worker/src/registry.ts의 TOPICS_WITHOUT_HANDLER이고
   * test/wiring/event-wiring.test.ts가 그 목록과 실제를 대조한다. */
  document_export: ["export.pdf", "export.hwpx"],
  // external_notifications는 외부 공급자 어댑터 도입 시 연결한다.
  // 앱 내 알림(notification.dispatch)은 대상이 아니다 — 업무함은 항상 동작 (22장).
};

/**
 * 워커 토픽이 아닌 곳에서 집행되는 스위치 — **어디서** 막히는지의 단일 정의처.
 *
 * KILL_SWITCH_TOPICS만 보면 "집행 미연결"로 보이지만 실제로는 집행되는
 * 키가 있다. CLI가 그것을 "끈 것처럼 보이지만 멈추지 않습니다"라고
 * 잘못 경고하지 않도록 여기 적는다.
 */
export const KILL_SWITCH_DIRECT_ENFORCEMENT: Readonly<Record<string, string>> =
  {
    ai_model_canary:
      "AI 섀도 평가 — domain/ai-canary.ts runCanaryShadow가 카나리 호출 자체를 건너뛴다",
    curriculum_release:
      "릴리스 발행 게이트 — domain/curriculum-release.ts publishCurriculumRelease가 발행 전이를 차단한다 (읽기·그래프 탐색·매핑 검수는 그대로)",
  };

/** 사람이 끌 수 있는 스위치 키 전체 — 설정 화면·CLI의 선택지 */
export const KILL_SWITCH_KEYS = [
  "auto_reschedule",
  "auto_publish_questions",
  "auto_grading",
  ASSESSMENT_GENERATION_SWITCH,
  "curriculum_release",
  "formula_autofix",
  "document_export",
  "external_notifications",
  // 카나리 섀도 평가 (인수 36). 끄면 카나리 호출이 사라진다 — 실사용
  // 추출은 그대로 돈다 (섀도는 애초에 사용자 경로가 아니다).
  "ai_model_canary",
] as const;

/** 카나리 섀도 평가 kill switch 키 — 문자열 중복을 막는 단일 정의처 */
export const CANARY_KILL_SWITCH_KEY = "ai_model_canary";

/** 전역으로 중지된 스위치 키 집합 (만료된 중지는 자동 복구로 간주) */
export async function loadGloballyDisabledSwitches(
  sql: postgres.Sql,
): Promise<Set<string>> {
  const rows = await sql<{ key: string }[]>`
    select distinct key from kill_switches
    where organization_id is null
      and enabled = false
      and (expires_at is null or expires_at > now())
  `;
  return new Set(rows.map((r) => r.key));
}

/**
 * 조직에서 기능이 활성인지 — 전역 또는 조직 스코프의 유효한 중지가
 * 하나라도 있으면 false (보수적).
 */
export async function isFeatureEnabled(
  // 트랜잭션 안(발행 게이트)에서도 부른다 — 판정을 복제하지 않기 위한 확장
  sql: postgres.Sql | postgres.TransactionSql,
  key: string,
  organizationId: string | null,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    select id from kill_switches
    where key = ${key}
      and enabled = false
      and (expires_at is null or expires_at > now())
      and (organization_id is null
           or organization_id = ${organizationId ?? null})
    limit 1
  `;
  return rows.length === 0;
}

/** 클레임 대상 토픽에서 중지된 스위치에 매인 토픽 제외 */
export function filterTopicsBySwitches(
  topics: readonly string[],
  disabledKeys: ReadonlySet<string>,
): string[] {
  const blocked = new Set<string>();
  for (const key of disabledKeys) {
    for (const topic of KILL_SWITCH_TOPICS[key] ?? []) blocked.add(topic);
  }
  return topics.filter((t) => !blocked.has(t));
}

/** 핸들러가 작업 연기를 요청하는 신호 — main 루프가 deferJob으로 처리 */
export interface DeferSignal {
  __defer: true;
  reason: string;
}

export function deferSignal(reason: string): DeferSignal {
  return { __defer: true, reason };
}

export function isDeferSignal(value: unknown): value is DeferSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as DeferSignal).__defer === true
  );
}
