import "server-only";

/* ─────────────────────────────────────────────────────────────
 * 3단계(통째로 다시 쓰기) 채점의 **의미 판정**.
 *
 * 낱말 포함 여부만 세면 「소인수들의 곱으로 나타내는 것」이라 제대로 쓴 학생이
 * 「소인수분해」라는 말을 안 썼다는 이유로 틀린다. 3단계는 자기 말로 쓰는
 * 자리이므로, 글자가 아니라 **뜻이 맞으면 맞은 것**이다(소유자 결정).
 *
 * 순서는 이렇다:
 *   1. 글자로 먼저 센다(keywordCoverage) — 대부분 여기서 끝나고 공짜다.
 *   2. 글자로 못 찾은 것만 모델에게 묻는다 — 「이 글이 이 개념을 말하고 있나」.
 *
 * **실패하면 글자 판정 그대로 간다.** 모델이 죽었다고 학생이 못 넘어가면
 * 안 된다. 시간 제한도 짧게 건다 — 채점은 학생이 기다리는 자리다.
 *
 * 아직 모델 레지스트리(ai_model_versions)와 사용량 집계(ai_usage_events)에
 * 붙지 않았다. 반입 파이프라인과 달리 이 호출은 그 관문을 지나지 않으므로,
 * 비용 한도·카나리·kill switch가 적용되지 않는다 — **알려진 공백이다.**
 * 학생 트래픽이 붙기 전에 그 배선을 먼저 해야 한다.
 * ───────────────────────────────────────────────────────────── */

const API = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";
const TIMEOUT_MS = 6000;

const PROMPT = `너는 중학교 수학 서술 답안을 읽는 채점자다.

학생이 개념을 **자기 말로** 쓴 글과, 담겨야 할 핵심어 목록을 준다.
각 핵심어에 대해 「이 글이 그 개념을 말하고 있는가」를 판정한다.

- 글자가 그대로 없어도 **뜻이 같으면 맞은 것으로 본다.**
  예: 「소인수분해」라는 말이 없어도 "소인수들의 곱으로 나타낸다"라고 썼으면 맞다.
  예: 「서로소」가 없어도 "최대공약수가 1인 두 수"라고 썼으면 맞다.
- 뜻이 어긋나거나 그 개념을 전혀 언급하지 않았으면 틀린 것이다.
- 애매하면 **틀린 쪽으로** 판정한다. 모르는 학생을 맞았다고 하면 다음 단계에서
  더 크게 막힌다.

출력은 JSON만. 설명 금지.
{"covered": ["핵심어1", "핵심어2"]}
covered에는 **글이 실제로 담고 있는** 핵심어만 넣는다.`;

/**
 * 글자로 못 찾은 핵심어 가운데 **뜻으로는 담긴 것**을 돌려준다.
 * 실패·시간 초과·키 없음이면 빈 배열 — 호출자는 글자 판정만 쓴다.
 */
export async function resolveMissingBySemantics(
  essay: string,
  missing: readonly string[],
): Promise<string[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || missing.length === 0 || essay.trim().length < 5) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: PROMPT },
          {
            role: "user",
            content: `핵심어: ${missing.join(", ")}\n\n학생 글:\n${essay.slice(0, 2000)}`,
          },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as {
      covered?: unknown;
    };
    if (!Array.isArray(parsed.covered)) return [];
    /* 모델이 목록에 없는 말을 지어내도 받지 않는다 — 「담겼다」의 대상은
     * 우리가 물은 핵심어뿐이다. */
    return parsed.covered.filter(
      (c): c is string => typeof c === "string" && missing.includes(c),
    );
  } catch {
    // 시간 초과·네트워크 실패 — 글자 판정 그대로 간다
    return [];
  } finally {
    clearTimeout(timer);
  }
}
