"use client";

import { useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────────
 * 말로 입력 — 타이핑이 어려운 학생을 위한 보조 입력.
 *
 * 브라우저 내장 음성 인식(SpeechRecognition)을 쓴다. **말이 끝나면 스스로
 * 닫힌다** — `continuous = false`면 브라우저가 무음을 판단해 인식을 끝내고
 * 결과를 준다. 무음 감지(VAD)를 우리가 짤 필요가 없고, 녹음이 무한정
 * 이어지지도 않는다. 안전장치로 20초 상한을 따로 건다(브라우저가 안 닫는
 * 경우를 봤다는 보고가 있다).
 *
 * 지원하지 않는 브라우저(사파리·파이어폭스 일부)에서는 **버튼 자체를 내지
 * 않는다** — 눌러도 안 되는 버튼은 고장으로 읽힌다.
 *
 * **음성은 브라우저가 자기 인식 서버로 보낸다**(크롬은 구글). 우리 서버로
 * 오디오가 오지 않고 저장하지도 않는다 — 받는 것은 인식된 글자뿐이다.
 * ───────────────────────────────────────────────────────────── */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function createRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * 대상 입력칸에 인식 결과를 **덧붙인다**.
 *
 * 대상은 호출자가 정한다(`getTarget`). 자유 서술은 칸이 하나뿐이라 고정이지만,
 * 빈칸 단계는 칸이 여럿이라 「방금 누른 칸」이 대상이어야 한다 — 칸마다 마이크
 * 버튼을 두면 문장 사이에 버튼이 박혀 본문이 개념 섹션과 달라진다.
 */
export function VoiceInputHint({
  getTarget,
  idle = "타이핑이 어려우면 말해도 됩니다.",
}: {
  getTarget: () => Field | null;
  /** 쉬는 동안의 안내 — 화면마다 대상을 고르는 방법이 다르다 */
  idle?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setSupported(createRecognition() !== null);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      recRef.current?.stop();
    };
  }, []);

  if (!supported) return null;

  const stop = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  };

  const start = () => {
    const rec = createRecognition();
    if (!rec) return;
    recRef.current = rec;
    rec.lang = "ko-KR";
    // 말이 끝나면 브라우저가 스스로 닫는다 — 이것이 자동 종료의 본체다
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i += 1) {
        text += e.results[i]?.[0]?.transcript ?? "";
      }
      const el = getTarget();
      if (el && text.trim().length > 0) {
        el.value = el.value.length > 0 ? `${el.value} ${text.trim()}` : text.trim();
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };
    rec.onend = () => stop();
    rec.onerror = () => stop();
    rec.start();
    setListening(true);
    // 안전장치 — 브라우저가 안 닫는 경우에도 20초면 끊는다
    timerRef.current = window.setTimeout(stop, 20_000);
  };

  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-sm ${
          listening
            ? "border-pen bg-pen font-medium text-white"
            : "border-rule bg-surface"
        }`}
      >
        {listening ? "듣는 중… (누르면 멈춤)" : "🎤 말로 입력"}
      </button>
      <span className="text-xs break-keep text-ink-soft">
        {listening
          ? "말을 마치면 저절로 멈춥니다."
          : idle}
      </span>
    </div>
  );
}
