import "server-only";

/* ─────────────────────────────────────────────────────────────
 * 빈칸 채점의 **의미 판정** — 글자가 아니라 뜻으로 본다(소유자 결정).
 *
 * 글자만 비교하면 「소인수들의 곱으로 나타내기」라 제대로 쓴 학생이 「소인수
 * 분해」라고 안 썼다는 이유로 틀린다. 정확히 쓰지 않아도 문맥·의미가 맞으면
 * 맞은 것으로 본다.
 *
 * 순서는 이렇다:
 *   1. 글자로 먼저 본다(matchesTermAnswer) — 대부분 여기서 끝나고 공짜다.
 *   2. 어긋난 칸만 모델에게 묻는다 — 「이 답이 그 말과 같은 뜻인가」.
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

const PROMPT = `너는 중학교 수학 빈칸 답안을 읽는 채점자다.

각 항목은 {자리번호, 정답, 학생답}이다. 학생답이 **정답과 같은 뜻인지** 본다.

- 글자가 달라도 **뜻이 같으면 맞은 것으로 본다.**
  예: 정답 「소인수분해」 · 학생답 "소인수들의 곱으로 나타내기" → 맞음
  예: 정답 「서로소」 · 학생답 "최대공약수가 1인 관계" → 맞음
  예: 정답 「밑」 · 학생답 "곱해지는 수" → 맞음
- 오타·띄어쓰기·말끝 차이는 맞은 것이다.
- 뜻이 다르거나 다른 개념을 적었으면 틀린 것이다.
  예: 정답 「소수」 · 학생답 "합성수" → 틀림
- 애매하면 **틀린 쪽으로** 판정한다.

출력은 JSON만. 설명 금지.
{"correct": [자리번호, 자리번호]}
correct에는 **맞은 것으로 볼 자리 번호**만 넣는다.`;

/**
 * 글자가 어긋난 칸 가운데 **뜻으로는 맞은 것**의 자리 번호를 돌려준다.
 * 실패·시간 초과·키 없음이면 빈 배열 — 호출자는 글자 판정만 쓴다.
 */
export async function resolveNearAnswers(
  pairs: Array<{ position: number; answer: string; submitted: string }>,
): Promise<number[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || pairs.length === 0) return [];

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
            content: pairs
              .map(
                (p) =>
                  `자리 ${p.position} · 정답: ${p.answer} · 학생답: ${p.submitted.slice(0, 200)}`,
              )
              .join("\n"),
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
      correct?: unknown;
    };
    if (!Array.isArray(parsed.correct)) return [];
    /* 우리가 묻지 않은 자리를 모델이 지어내도 받지 않는다 */
    const asked = new Set(pairs.map((p) => p.position));
    return parsed.correct
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && asked.has(n));
  } catch {
    // 시간 초과·네트워크 실패 — 글자 판정 그대로 간다
    return [];
  } finally {
    clearTimeout(timer);
  }
}
