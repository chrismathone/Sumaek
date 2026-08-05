import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KILL_SWITCH_KEYS,
  KILL_SWITCH_KEYS_WITHOUT_IMPLEMENTATION,
} from "../src/kill-switch";

/* ─────────────────────────────────────────────────────────────
 * 런북이 부르는 kill switch 이름이 실제로 있는가 (T6.4).
 *
 * 장애 한가운데서 런북을 펴는 사람은 거기 적힌 키를 그대로 친다. 그 키가
 * 코드에 없으면 명령이 조용히 아무것도 하지 않고, 그 사람은 스위치를 껐다고
 * 믿은 채 다음 단계로 넘어간다. 문서가 틀린 것 중 가장 나쁜 종류다.
 *
 * 실측으로 셋이 어긋나 있었다 (문서 48곳):
 *   auto_question_publish  → auto_publish_questions
 *   auto_schedule_recalc   → auto_reschedule
 *   formula_auto_repair    → formula_autofix
 *
 * 넷째(`ai_provider:<name>`)는 이름이 틀린 것이 아니라 **구현이 없는** 것이라
 * 다르게 다룬다 — 지우지 않고 KILL_SWITCH_KEYS_WITHOUT_IMPLEMENTATION에
 * 적어 두고, 이 테스트가 그 목록에 있는지로 통과시킨다.
 *
 * DB 없이 돈다. 문서와 소스만 읽는다.
 * ───────────────────────────────────────────────────────────── */

const DOCS_ROOT = join(__dirname, "..", "..", "..", "docs");

/**
 * kill switch를 말하는 문장에서만 키를 뽑는다.
 *
 * **밑줄이 있는 토큰만** 본다. 실제 키는 전부 `auto_grading` 꼴이고, 이 조건이
 * 없으면 「kill switch」 근처의 backtick 전부(`queue`·`false`·`latest`·`mock`)를
 * 스위치로 오해한다. 그러면 실패 목록이 소음으로 가득 차서 진짜 어긋난
 * 이름이 묻힌다 — 검사가 있으나 마나가 되는 가장 흔한 방식이다.
 */
const KEY = String.raw`[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?::<name>)?`;
const SWITCH_MENTION = new RegExp(
  `\`(${KEY})\`(?=[^\\n]{0,40}kill switch)|kill switch[^\\n]{0,40}?\`(${KEY})\``,
  "g",
);

function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
    /* 계획 문서는 제외한다 — 거기서는 「고칠 것」으로 옛 이름을 인용한다. */
    else if (entry.endsWith(".md") && !path.includes("planning")) found.push(path);
  }
  return found;
}

describe("런북이 부르는 kill switch는 실제로 있다", () => {
  const known = new Set<string>([
    ...KILL_SWITCH_KEYS,
    ...Object.keys(KILL_SWITCH_KEYS_WITHOUT_IMPLEMENTATION),
  ]);

  /**
   * 스위치 키처럼 생겼지만 아닌 것들 — 표·컬럼·경보 이름.
   *
   * 하나씩 확인해서 적었다. 「스위치가 아니다」를 목록으로 두는 편이 정규식을
   * 더 좁히는 것보다 낫다: 왜 제외했는지가 남는다.
   */
  const NOT_A_SWITCH = new Set([
    "kill_switches", // 스위치를 담는 표
    "document_exports", // 산출물 표 (스위치 키는 단수형 document_export)
    "assessment_instances", // 평가 표
    "auto_graded", // 응시 상태
    "mass_schedule_change", // 경보 이름 (ADR-0007 F-4)
    "queue_wait_exceeded", // 경보 이름 (ADR-0010)
    "feature_flags", // 설정 표
  ]);

  it("문서에 나온 스위치 이름이 전부 코드에 있다", () => {
    const unknown = new Map<string, string[]>();
    for (const file of markdownFiles(DOCS_ROOT)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(SWITCH_MENTION)) {
        const key = match[1] ?? match[2];
        if (!key || known.has(key) || NOT_A_SWITCH.has(key)) continue;
        const where = unknown.get(key) ?? [];
        const short = file.slice(file.indexOf("docs"));
        if (!where.includes(short)) where.push(short);
        unknown.set(key, where);
      }
    }
    /* 실패 메시지가 곧 고칠 목록이 되게 한다 — 어느 키가 어느 문서에 있는지 */
    expect(
      [...unknown].map(([key, files]) => `${key} — ${files.join(", ")}`),
    ).toEqual([]);
  });

  it("구현 없는 키 목록은 실제 키와 겹치지 않는다", () => {
    /* 겹치면 「구현이 없다」는 설명이 거짓말이 된다 */
    const overlap = Object.keys(KILL_SWITCH_KEYS_WITHOUT_IMPLEMENTATION).filter(
      (key) => (KILL_SWITCH_KEYS as readonly string[]).includes(key),
    );
    expect(overlap).toEqual([]);
  });
});
