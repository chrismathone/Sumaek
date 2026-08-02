import { describe, expect, it } from "vitest";
import { parseLectureMeta } from "@/lib/lecture-meta";

/* 자동 판서 강의 파이프라인 산출물 해석.
 *
 * 실제 산출물로 검증한다 — 손으로 지어낸 모양이 아니라
 * `pipeline/work/20260722-0953-d093ce3f/out/meta.json`을 그대로 옮긴 것이다.
 * 파이프라인이 스키마를 바꾸면 이 검사가 먼저 걸려야 한다. */

const REAL_META = JSON.stringify({
  jobId: "20260722-0953-d093ce3f",
  pageId: "fixture-quadratic-formula",
  lessonTitle: "이차방정식의 근의 공식과 판별식",
  disclosure: "선생님이 검수한 AI 보충 강의입니다.",
  fps: 30,
  totalFrames: 3877,
  segments: [{ id: "S01", startFrame: 0, durationFrames: 541, action: "underline" }],
  pausePromptsAtFrames: [2810],
});

describe("강의 meta.json 해석", () => {
  it("실제 산출물에서 제목과 길이를 뽑는다", () => {
    const r = parseLectureMeta(REAL_META);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.title).toBe("이차방정식의 근의 공식과 판별식");
    // meta.json에 초 단위 필드가 없다 — 3877/30 = 129.2 → 129
    expect(r.meta.seconds).toBe(129);
    expect(r.meta.jobId).toBe("20260722-0953-d093ce3f");
  });

  it("AI 고지를 뽑는다 — 학생에게 보여 줄 문구가 여기서만 온다", () => {
    const r = parseLectureMeta(REAL_META);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.disclosure).toBe("선생님이 검수한 AI 보충 강의입니다.");
  });

  it("고지가 없거나 비어 있으면 지어내지 않는다", () => {
    for (const raw of [
      JSON.stringify({ lessonTitle: "제목", fps: 30, totalFrames: 900 }),
      JSON.stringify({ lessonTitle: "제목", fps: 30, totalFrames: 900, disclosure: "   " }),
    ]) {
      const r = parseLectureMeta(raw);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.meta.disclosure).toBeNull();
    }
  });

  it("앞뒤 공백이 있어도 읽는다 (붙여넣기 현실)", () => {
    expect(parseLectureMeta(`\n  ${REAL_META}  \n`).ok).toBe(true);
  });

  /* ── 실패는 이유를 말해야 한다 ── */

  it("빈 입력을 조용히 넘기지 않는다", () => {
    const r = parseLectureMeta("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("내용이 없습니다");
  });

  it("JSON이 아니면 무엇을 붙여야 하는지 알려 준다", () => {
    const r = parseLectureMeta("이차방정식의 근의 공식과 판별식");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("meta.json");
  });

  it("배열·원시값은 meta.json이 아니다", () => {
    for (const bad of ["[]", '"문자열"', "42", "null"]) {
      expect(parseLectureMeta(bad).ok, bad).toBe(false);
    }
  });

  it("lessonTitle이 없으면 채우지 않는다", () => {
    const r = parseLectureMeta(JSON.stringify({ fps: 30, totalFrames: 900 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("lessonTitle");
  });

  it("fps·totalFrames가 없으면 길이를 지어내지 않는다", () => {
    const r = parseLectureMeta(JSON.stringify({ lessonTitle: "제목만 있음" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("길이를 계산할 수 없습니다");
  });

  it("fps가 0이면 나누지 않는다 (0으로 나눈 Infinity를 길이로 쓰지 않는다)", () => {
    const r = parseLectureMeta(
      JSON.stringify({ lessonTitle: "제목", fps: 0, totalFrames: 900 }),
    );
    expect(r.ok).toBe(false);
  });
});
