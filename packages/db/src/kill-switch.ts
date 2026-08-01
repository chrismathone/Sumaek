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
  };

/** 사람이 끌 수 있는 스위치 키 전체 — 설정 화면·CLI의 선택지 */
export const KILL_SWITCH_KEYS = [
  "auto_reschedule",
  "auto_publish_questions",
  "auto_grading",
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
  sql: postgres.Sql,
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
