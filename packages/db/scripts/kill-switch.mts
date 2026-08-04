import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { v7 as uuidv7 } from "uuid";
import {
  KILL_SWITCH_DIRECT_ENFORCEMENT,
  KILL_SWITCH_KEYS,
  KILL_SWITCH_TOPICS,
} from "../src/kill-switch";
import { createSql } from "../src/client";

/**
 * Kill switch 운영 CLI.
 *
 *   pnpm kill-switch list
 *   pnpm kill-switch stop auto_grading --reason "RB-12 정확도 하락" --actor ops@example.com
 *   pnpm kill-switch resume auto_grading --actor ops@example.com
 *   pnpm kill-switch stop document_export --org <uuid> --expires 2026-08-01T09:00:00Z
 *
 * 근거: docs/runbooks/README.md 5장, packages/db/src/kill-switch.ts(집행 모듈)
 *
 * ── 컬럼 의미 (집행 모듈이 authoritative) ─────────────────────
 * kill_switches.enabled 는 **기능이 켜져 있는가**를 뜻한다.
 *   enabled = false → 기능 중지 (kill switch 작동 중)
 *   enabled = true  → 기능 정상
 *   행이 없음        → 기능 정상 (기본값)
 * loadGloballyDisabledSwitches·isFeatureEnabled가 `enabled = false`를 중지로
 * 읽으므로 이 CLI도 같은 방향으로 쓴다. 반대로 쓰면 스위치를 켰다고 믿는
 * 동안 자동화가 그대로 돈다.
 *
 * ── 동사 주의 ────────────────────────────────────────────────
 * 런북(README 5.1)은 `enable`을 "kill switch 켜기 = 기능 중지"로 쓰고,
 * 설정 화면(settings/actions.ts)은 `enable`을 "자동화 재개"로 쓴다. 정반대다.
 * 그래서 표준 동사를 **stop / resume**으로 둔다. enable·disable은 런북 문구를
 * 그대로 붙여넣는 경우를 위해 남기되, 무엇이 일어나는지 먼저 경고한다.
 */

const AI_PROVIDER_PREFIX = "ai_provider:";

/**
 * 런북 README 5장의 키 이름 → 코드(KILL_SWITCH_KEYS)의 키 이름.
 * 8종 중 5종이 문서와 코드에서 이름이 다르다. 문서를 고치기 전까지
 * 런북에서 복사한 명령도 동작하도록 별칭을 받는다.
 */
const RUNBOOK_ALIASES: Readonly<Record<string, string>> = {
  auto_schedule_recalc: "auto_reschedule",
  auto_question_publish: "auto_publish_questions",
  curriculum_release_publish: "curriculum_release",
  formula_auto_repair: "formula_autofix",
  external_notification: "external_notifications",
};

/** 스위치별 "중지해도 반드시 되는 것" (런북 README 5장) */
const STILL_WORKS: Readonly<Record<string, string>> = {
  auto_reschedule: "수동 일정 편집·기존 일정 조회·수동 preview/apply",
  auto_publish_questions: "수동 게시·문제은행 조회·이미 게시된 문항 출제",
  auto_grading: "답안 제출·수동 채점·예외 처리·기존 확정 점수 조회",
  auto_assessment_generation:
    "교사가 화면에서 직접 누르는 테스트 생성·이미 생성된 테스트의 응시·채점·조회. 멈추는 것은 워커의 자동 생성뿐 (이미 만들어진 작업은 큐에 남아 재개 후 실행된다)",
  curriculum_release: "활성 릴리스 읽기·개념 그래프 탐색·매핑 검수",
  formula_autofix: "수식 파싱·KaTeX 검증·수동 수정·기존 렌더",
  document_export: "온라인 응시·웹 미리보기·기존 산출물 다운로드",
  external_notifications: "앱 내 업무함 전체·알림 생성·조회·처리",
  ai_model_canary:
    "실사용 AI 추출 전부 (섀도는 사용자 경로가 아니다). 멈추는 것은 카나리 모델 호출과 표본 수집뿐",
  [AI_PROVIDER_PREFIX]: "게시 콘텐츠·검수 완료 문제은행·응시·수동 채점·다른 공급자",
};

/**
 * 전역 스위치 전환의 감사 기록에 쓰는 플랫폼 스코프 ID.
 * audit_events.organization_id는 NOT NULL이고 전역 전환은 특정 조직의 사건이
 * 아니다. 어느 조직 화면에도 섞이지 않도록 nil UUID를 쓴다.
 */
const PLATFORM_SCOPE_ORG = "00000000-0000-0000-0000-000000000000";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Options {
  org: string | null;
  reason: string | null;
  actor: string | null;
  expires: string | null;
  force: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    org: null,
    reason: null,
    actor: null,
    expires: null,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    const value = argv[i + 1];
    if (arg === "--org" || arg === "--reason" || arg === "--actor" || arg === "--expires") {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} 에 값이 없습니다.`);
      }
      if (arg === "--org") options.org = value;
      if (arg === "--reason") options.reason = value;
      if (arg === "--actor") options.actor = value;
      if (arg === "--expires") options.expires = value;
      i += 1;
      continue;
    }
    throw new Error(`알 수 없는 옵션입니다: ${arg}`);
  }
  return options;
}

/** 런북 이름을 코드 이름으로 옮긴다. */
function canonicalKey(input: string): { key: string; renamedFrom: string | null } {
  const mapped = RUNBOOK_ALIASES[input];
  return mapped ? { key: mapped, renamedFrom: input } : { key: input, renamedFrom: null };
}

function isKnownKey(key: string): boolean {
  return (
    (KILL_SWITCH_KEYS as readonly string[]).includes(key) ||
    (key.startsWith(AI_PROVIDER_PREFIX) && key.length > AI_PROVIDER_PREFIX.length)
  );
}

/** 이 키를 끄면 실제로 멈추는 워커 토픽. 비어 있어도 직접 집행이 있을 수 있다. */
function enforcedTopics(key: string): readonly string[] {
  return KILL_SWITCH_TOPICS[key] ?? [];
}

/** 워커 토픽이 아닌 집행 지점 (있으면 설명, 없으면 null) */
function directEnforcement(key: string): string | null {
  return KILL_SWITCH_DIRECT_ENFORCEMENT[key] ?? null;
}

/**
 * 이 키를 끄면 정말로 무언가 멈추는가.
 * 토픽 매핑만 보고 판단하면 직접 집행되는 키(ai_model_canary)를
 * "멈추지 않는다"고 거짓 경고한다.
 */
function isEnforced(key: string): boolean {
  return enforcedTopics(key).length > 0 || directEnforcement(key) !== null;
}

function stillWorks(key: string): string {
  if (STILL_WORKS[key]) return STILL_WORKS[key];
  if (key.startsWith(AI_PROVIDER_PREFIX)) {
    return STILL_WORKS[AI_PROVIDER_PREFIX] ?? "";
  }
  return "(런북 README 5장 확인)";
}

function usage(): void {
  console.log("사용:");
  console.log("  pnpm kill-switch list");
  console.log("  pnpm kill-switch stop   <key> [--org <uuid>] [--reason <사유>] [--actor <이메일>] [--expires <ISO8601>]");
  console.log("  pnpm kill-switch resume <key> [--org <uuid>] [--reason <사유>] [--actor <이메일>]");
  console.log("");
  console.log("  stop   = 해당 자동화를 중지한다 (kill_switches.enabled = false)");
  console.log("  resume = 다시 돌린다 (enabled = true)");
  console.log("  --expires 는 stop에만 쓴다 — 그 시각이 지나면 자동으로 재개된다.");
  console.log("");
  console.log("key:");
  for (const key of KILL_SWITCH_KEYS) {
    const topics = enforcedTopics(key);
    const direct = directEnforcement(key);
    const wired =
      topics.length > 0
        ? `→ ${topics.join(", ")}`
        : direct
          ? `→ ${direct}`
          : "→ (집행 미연결)";
    console.log(`  ${key.padEnd(24)} ${wired}`);
  }
  console.log(`  ${`${AI_PROVIDER_PREFIX}<공급자>`.padEnd(24)} → (집행 미연결)`);
  console.log("");
  console.log("런북 이름(auto_schedule_recalc 등)으로 불러도 위 이름으로 옮겨 실행합니다.");
}

interface SwitchRow {
  id: string;
  organization_id: string | null;
  key: string;
  enabled: boolean;
  reason: string | null;
  changed_by: string | null;
  expires_at: Date | null;
  updated_at: Date;
  org_name: string | null;
}

/** 지금 이 행이 기능을 실제로 막고 있는가 (만료된 중지는 이미 풀린 것) */
function isStopping(row: SwitchRow): boolean {
  if (row.enabled) return false;
  return row.expires_at === null || row.expires_at.getTime() > Date.now();
}

async function runList(sql: ReturnType<typeof createSql>): Promise<void> {
  const rows = await sql<SwitchRow[]>`
    select k.id, k.organization_id, k.key, k.enabled, k.reason, k.changed_by,
           k.expires_at, k.updated_at, o.name as org_name
    from kill_switches k
    left join organizations o on o.id = k.organization_id
    order by k.key asc, k.organization_id asc nulls first
  `;

  console.log("Kill switch 현황");
  console.log("  enabled=false → 기능 중지 중 / enabled=true·행 없음 → 기능 정상");
  console.log("");

  if (rows.length === 0) {
    console.log("  설정된 스위치 행이 없습니다 — 전 기능 정상 동작.");
  } else {
    const header = `  ${"key".padEnd(24)} ${"범위".padEnd(18)} ${"기능".padEnd(11)} ${"집행".padEnd(6)} ${"만료".padEnd(22)} 사유`;
    console.log(header);
    console.log(`  ${"-".repeat(header.length)}`);
    for (const row of rows) {
      const scope = row.organization_id
        ? `${row.org_name ?? "(이름 없음)"}`.slice(0, 16)
        : "전역";
      const state = isStopping(row) ? "중지" : row.enabled ? "정상" : "정상(만료)";
      const wired = isEnforced(row.key) ? "연결" : "미연결";
      const expires = row.expires_at ? row.expires_at.toISOString() : "-";
      console.log(
        `  ${row.key.padEnd(24)} ${scope.padEnd(18)} ${state.padEnd(11)} ${wired.padEnd(6)} ${expires.padEnd(22)} ${row.reason ?? "-"}`,
      );
    }
  }

  const stopped = rows.filter(isStopping);
  console.log("");
  if (stopped.length > 0) {
    console.log(`중지 중인 기능 ${stopped.length}건 — 그래도 되는 것:`);
    for (const row of stopped) {
      console.log(`  ${row.key}: ${stillWorks(row.key)}`);
      if (!isEnforced(row.key)) {
        console.log(
          "    주의: 이 키는 워커 집행에 연결되어 있지 않습니다 — 끈 것처럼 보이지만 멈추지 않습니다.",
        );
      }
    }
    console.log("");
    console.log("켜둔 채 잊지 않도록 오늘 운영실 배너를 확인하세요 (README 5.2 규약 3).");
  }

  const unwired = KILL_SWITCH_KEYS.filter((key) => !isEnforced(key));
  if (unwired.length > 0) {
    console.log("집행이 아직 연결되지 않은 키 (중지해도 워커가 멈추지 않음):");
    console.log(`  ${unwired.join(", ")}`);
  }
}

async function resolveActor(
  sql: ReturnType<typeof createSql>,
  actor: string | null,
): Promise<{ actorId: string | null; label: string }> {
  if (!actor) return { actorId: null, label: "(미지정)" };
  if (UUID_RE.test(actor)) return { actorId: actor, label: actor };
  const [user] = await sql<{ id: string }[]>`
    select id from users where lower(email) = lower(${actor}) limit 1
  `;
  // 사용자를 못 찾아도 실패시키지 않는다 — 장애 중에 계정 조회가 막힐 수 있다.
  // 대신 actor_id를 비우고 원문을 after에 남겨 누가 했는지는 잃지 않는다.
  return { actorId: user?.id ?? null, label: actor };
}

async function runToggle(
  sql: ReturnType<typeof createSql>,
  intent: "stop" | "resume",
  rawKey: string,
  options: Options,
): Promise<void> {
  const { key, renamedFrom } = canonicalKey(rawKey);
  if (renamedFrom) {
    console.log(`런북 이름 '${renamedFrom}' → 코드 키 '${key}' 로 옮겨 실행합니다.`);
  }
  if (!isKnownKey(key) && !options.force) {
    throw new Error(
      `알 수 없는 kill switch 키입니다: ${rawKey}\n` +
        `허용: ${KILL_SWITCH_KEYS.join(", ")}, ${AI_PROVIDER_PREFIX}<공급자>\n` +
        "의도한 것이면 --force 를 붙이세요.",
    );
  }
  if (options.org !== null && !UUID_RE.test(options.org)) {
    throw new Error(`--org 값이 UUID가 아닙니다: ${options.org}`);
  }
  let expiresAt: Date | null = null;
  if (options.expires !== null) {
    if (intent === "resume") {
      throw new Error("--expires 는 stop 에만 쓸 수 있습니다 (자동 재개 시각).");
    }
    expiresAt = new Date(options.expires);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error(`--expires 값을 시각으로 읽을 수 없습니다: ${options.expires}`);
    }
  }

  if (options.org !== null) {
    const [org] = await sql<{ id: string; name: string }[]>`
      select id, name from organizations where id = ${options.org}
    `;
    if (!org) throw new Error(`조직을 찾을 수 없습니다: ${options.org}`);
    console.log(`범위: 조직 ${org.name} (${org.id})`);
  } else {
    console.log("범위: 전역");
  }

  // 집행 모듈 규약: enabled=false 가 "중지".
  const enabled = intent === "resume";
  const { actorId, label } = await resolveActor(sql, options.actor);

  const result = await sql.begin(async (tx) => {
    // organization_id가 NULL인 전역 행에는 ON CONFLICT가 걸리지 않는다
    // (kill_switches_scope_key_uq는 NULL을 서로 다른 값으로 본다).
    // 그래서 잠금을 잡고 읽은 뒤 update/insert를 직접 나눈다.
    const [existing] = await tx<
      { id: string; enabled: boolean; reason: string | null }[]
    >`
      select id, enabled, reason from kill_switches
      where key = ${key} and organization_id is not distinct from ${options.org}
      for update
    `;

    const before = existing
      ? { enabled: existing.enabled, reason: existing.reason }
      : { enabled: true, reason: null };

    if (existing) {
      await tx`
        update kill_switches
        set enabled = ${enabled},
            reason = ${options.reason ?? existing.reason},
            changed_by = ${actorId},
            expires_at = ${enabled ? null : expiresAt},
            updated_at = now()
        where id = ${existing.id}
      `;
    } else {
      await tx`
        insert into kill_switches (
          id, organization_id, key, enabled, reason, changed_by, expires_at
        ) values (
          ${uuidv7()}, ${options.org}, ${key}, ${enabled},
          ${options.reason}, ${actorId}, ${enabled ? null : expiresAt}
        )
      `;
    }

    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action,
        target_type, target_id, reason, before, after
      ) values (
        ${uuidv7()}, ${options.org ?? PLATFORM_SCOPE_ORG}, 'automation', ${actorId},
        'ops.kill_switch', 'kill_switch', ${existing?.id ?? null},
        ${options.reason},
        ${tx.json(before as never)},
        ${tx.json({
          key,
          requestedAs: rawKey,
          intent,
          enabled,
          scope: options.org ?? "global",
          actor: label,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          via: "packages/db/scripts/kill-switch.mts",
        } as never)}
      )
    `;

    return { created: !existing, before };
  });

  console.log("");
  console.log(
    intent === "stop"
      ? `${key} 자동화를 중지했습니다.`
      : `${key} 자동화를 재개했습니다.`,
  );
  console.log(
    `  기능 상태 : ${intent === "stop" ? "중지됨" : "정상"} (kill_switches.enabled = ${enabled})`,
  );
  console.log(
    `  이전 상태 : ${result.before.enabled ? "정상" : "중지됨"}${result.created ? " (행 신규 생성)" : ""}`,
  );
  console.log(
    `  수행자    : ${label}${actorId === null && options.actor ? " (users에서 못 찾아 actor_id는 비움)" : ""}`,
  );
  console.log(`  사유      : ${options.reason ?? "(없음)"}`);

  if (intent === "stop") {
    const topics = enforcedTopics(key);
    const direct = directEnforcement(key);
    if (topics.length > 0) {
      console.log(`  멈추는 토픽: ${topics.join(", ")}`);
    } else if (direct) {
      console.log(`  집행 지점  : ${direct}`);
    } else {
      console.log("  주의: 이 키는 워커 집행(KILL_SWITCH_TOPICS)에 연결되어 있지 않습니다.");
      console.log("        행은 남지만 자동화는 그대로 돕니다. 다른 수단을 함께 쓰세요.");
    }
    console.log(`  그래도 되는 것: ${stillWorks(key)}`);
    if (expiresAt) console.log(`  자동 재개 : ${expiresAt.toISOString()}`);
    console.log("  큐에 있던 작업은 삭제하지 않습니다. 재개 시 지터를 주세요 (README 5.2 규약 5·6).");
  }
  console.log("  audit_events에 action='ops.kill_switch'로 기록했습니다.");
}

/** 런북 5.1이 쓰는 동사. 설정 화면과 뜻이 반대라 무엇이 일어나는지 밝히고 진행한다. */
const LEGACY_VERBS: Readonly<Record<string, "stop" | "resume">> = {
  enable: "stop",
  disable: "resume",
};

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help") {
    usage();
    process.exit(command ? 0 : 2);
  }

  const sql = createSql();
  try {
    if (command === "list") {
      await runList(sql);
      return;
    }

    const legacy = LEGACY_VERBS[command];
    const intent: "stop" | "resume" | undefined =
      command === "stop" || command === "resume" ? command : legacy;

    if (intent) {
      if (legacy) {
        console.warn(
          `'${command}' 는 런북 5.1의 표현입니다 — 자동화를 ${legacy === "stop" ? "중지" : "재개"}합니다.`,
        );
        console.warn(`설정 화면은 같은 낱말을 반대 뜻으로 씁니다. 헷갈리지 않게 '${legacy}' 를 쓰세요.`);
        console.warn("");
      }
      const [key, ...flags] = rest;
      if (!key || key.startsWith("--")) {
        throw new Error(`${command} 에는 kill switch 키가 필요합니다.`);
      }
      await runToggle(sql, intent, key, parseOptions(flags));
      return;
    }

    throw new Error(`알 수 없는 명령입니다: ${command}`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`[kill-switch] ${error instanceof Error ? error.message : String(error)}`);
  console.error("");
  usage();
  process.exit(1);
});
