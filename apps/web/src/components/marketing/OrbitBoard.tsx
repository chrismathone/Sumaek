"use client";

import { useId, useState } from "react";
import { ScrollableRegion } from "@/components/ScrollableRegion";

/**
 * 수업 궤도판 — 제품의 시그니처 요소 (골프롬프트 5장).
 * 랜딩 히어로·루트 빌더·학생 상세에서 같은 문법으로 작동한다.
 *
 * 데모 원칙 (6장 히어로):
 * - 전자출결이 아니라, 이미 전달된 수업 불가 사실이 학습 경로에 미치는 영향.
 * - 완료된 과거 경로는 유지된다. 영향을 받는 미래 경로만 다시 그려진다.
 * - 변경 이유·변경 전·변경 후가 표시된다.
 * - 자동 반영 가능과 선생님 승인 필요가 구분된다.
 * - 실제 학생 정보 없는 합성 데이터.
 */

const DAYS = [
  { key: "0728", label: "7/28 월", x: 70, past: true, today: false },
  { key: "0730", label: "7/30 수", x: 175, past: true, today: false },
  { key: "0803", label: "8/3 월", x: 280, past: false, today: true },
  { key: "0805", label: "8/5 수", x: 385, past: false, today: false },
  { key: "0807", label: "8/7 금", x: 490, past: false, today: false },
  { key: "0810", label: "8/10 월", x: 595, past: false, today: false },
  { key: "0812", label: "8/12 수", x: 700, past: false, today: false },
] as const;

const LANE_COMMON = 78;
const LANE_DOYUN = 158;
const LANE_HARIN = 232;

type XKey = (typeof DAYS)[number]["key"];
const X: Record<XKey, number> = Object.fromEntries(
  DAYS.map((d) => [d.key, d.x]),
) as Record<XKey, number>;

export function OrbitBoard({ interactive = true }: { interactive?: boolean }) {
  const [absenceApplied, setAbsenceApplied] = useState(false);
  const [scoreApplied, setScoreApplied] = useState(false);
  const titleId = useId();

  return (
    <div className="rounded-lg border border-rule bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-soft px-4 py-3">
        <div>
          <p className="font-mono text-xs text-ink-soft">8월 3일 월요일 · 중2 심화 A</p>
          <p className="text-sm font-semibold">
            연립방정식 활용 ① → 예제 12–18 → 일일테스트 8문항
          </p>
        </div>
        {interactive && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAbsenceApplied((v) => !v)}
              aria-pressed={absenceApplied}
              className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-sm font-medium transition-colors ${
                absenceApplied
                  ? "border-pen bg-pen text-white"
                  : "border-rule bg-surface text-ink hover:border-pen"
              }`}
            >
              정하린 학습 불참 반영
            </button>
            <button
              type="button"
              onClick={() => setScoreApplied((v) => !v)}
              aria-pressed={scoreApplied}
              className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-sm font-medium transition-colors ${
                scoreApplied
                  ? "border-pen bg-pen text-white"
                  : "border-rule bg-surface text-ink hover:border-pen"
              }`}
            >
              이도윤 점수 반영
            </button>
          </div>
        )}
      </div>

      <ScrollableRegion label="수업 궤도판 도해" className="grid-paper p-2">
        <svg
          viewBox="0 0 780 280"
          role="img"
          aria-labelledby={titleId}
          className="min-w-[640px]"
        >
          <title id={titleId}>
            {`수업 궤도판: 반 공통 경로와 학생별 분기.${
              absenceApplied
                ? " 정하린 학생은 8월 3일 불참으로 8월 5일 보강 후 8월 10일 반 경로에 재합류합니다."
                : " 정하린 학생은 반 공통 경로를 따릅니다."
            }${
              scoreApplied
                ? " 이도윤 학생은 5·7번 오답 반영으로 8월 7일 확인테스트가 예약되었습니다."
                : ""
            }`}
          </title>

          {/* 날짜 축 */}
          {DAYS.map((d) => (
            <g key={d.key}>
              <line
                x1={d.x}
                y1={40}
                x2={d.x}
                y2={252}
                stroke="var(--color-rule-soft)"
                strokeWidth={1}
              />
              <text
                x={d.x}
                y={30}
                textAnchor="middle"
                className="font-mono"
                fontSize={11}
                fill={d.today ? "var(--color-pen)" : "var(--color-ink-soft)"}
                fontWeight={d.today ? 700 : 400}
              >
                {d.label}
              </text>
              {d.today && (
                <rect
                  x={d.x - 26}
                  y={38}
                  width={52}
                  height={216}
                  fill="var(--color-pen)"
                  opacity={0.06}
                />
              )}
            </g>
          ))}

          {/* 레인 라벨 */}
          <text x={8} y={LANE_COMMON + 4} fontSize={12} fontWeight={700} fill="var(--color-ink)">
            반 공통
          </text>
          <text x={8} y={LANE_DOYUN + 4} fontSize={12} fill="var(--color-ink-soft)">
            이도윤
          </text>
          <text x={8} y={LANE_HARIN + 4} fontSize={12} fill="var(--color-ink-soft)">
            정하린
          </text>

          {/* 반 공통 경로 — 과거(잉크 실선) + 미래(볼펜 블루) */}
          <line x1={X["0728"]} y1={LANE_COMMON} x2={X["0803"]} y2={LANE_COMMON} stroke="var(--color-ink)" strokeWidth={2.5} />
          <line x1={X["0803"]} y1={LANE_COMMON} x2={X["0812"]} y2={LANE_COMMON} stroke="var(--color-pen)" strokeWidth={2.5} />
          {DAYS.map((d) => (
            <circle
              key={`c-${d.key}`}
              cx={d.x}
              cy={LANE_COMMON}
              r={6}
              fill={d.past ? "var(--color-ink)" : "var(--color-surface)"}
              stroke={d.past ? "var(--color-ink)" : "var(--color-pen)"}
              strokeWidth={2}
            />
          ))}

          {/* 이도윤 — 점수 반영 시 8/7 확인테스트 분기 */}
          <line x1={X["0728"]} y1={LANE_DOYUN} x2={X["0803"]} y2={LANE_DOYUN} stroke="var(--color-ink)" strokeWidth={1.8} />
          {!scoreApplied ? (
            <line x1={X["0803"]} y1={LANE_DOYUN} x2={X["0812"]} y2={LANE_DOYUN} stroke="var(--color-rule)" strokeWidth={1.8} strokeDasharray="2 4" />
          ) : (
            <>
              <line x1={X["0803"]} y1={LANE_DOYUN} x2={X["0805"]} y2={LANE_DOYUN} stroke="var(--color-pen)" strokeWidth={1.8} />
              <line x1={X["0805"]} y1={LANE_DOYUN} x2={X["0807"]} y2={LANE_DOYUN} stroke="var(--color-highlight)" strokeWidth={5} opacity={0.55} />
              <line x1={X["0805"]} y1={LANE_DOYUN} x2={X["0807"]} y2={LANE_DOYUN} stroke="var(--color-pen)" strokeWidth={1.8} />
              <line x1={X["0807"]} y1={LANE_DOYUN} x2={X["0812"]} y2={LANE_DOYUN} stroke="var(--color-pen)" strokeWidth={1.8} />
              <rect x={X["0807"] - 34} y={LANE_DOYUN - 32} width={68} height={20} rx={4} fill="var(--color-highlight)" />
              <text x={X["0807"]} y={LANE_DOYUN - 18} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-ink)">
                확인테스트
              </text>
            </>
          )}
          {(["0728", "0730", "0803", "0805", "0807", "0810", "0812"] as const).map(
            (k) => (
              <circle
                key={`d-${k}`}
                cx={X[k]}
                cy={LANE_DOYUN}
                r={4.5}
                fill={
                  k === "0728" || k === "0730"
                    ? "var(--color-ink)"
                    : scoreApplied && k === "0807"
                      ? "var(--color-highlight)"
                      : "var(--color-surface)"
                }
                stroke={
                  scoreApplied && k === "0807"
                    ? "var(--color-ink)"
                    : k === "0728" || k === "0730"
                      ? "var(--color-ink)"
                      : "var(--color-rule)"
                }
                strokeWidth={1.5}
              />
            ),
          )}
          {/* 오답 마커 (과거 기록 — 항상 표시, 채점 레드 절제 사용) */}
          <text x={X["0730"]} y={LANE_DOYUN + 20} textAnchor="middle" fontSize={10} fill="var(--color-grade)">
            5·7번 오답
          </text>

          {/* 정하린 — 불참 반영 시 8/3 취소·8/5 보강·8/10 재합류 */}
          <line x1={X["0728"]} y1={LANE_HARIN} x2={X["0803"]} y2={LANE_HARIN} stroke="var(--color-ink)" strokeWidth={1.8} />
          {!absenceApplied ? (
            <line x1={X["0803"]} y1={LANE_HARIN} x2={X["0812"]} y2={LANE_HARIN} stroke="var(--color-rule)" strokeWidth={1.8} strokeDasharray="2 4" />
          ) : (
            <>
              {/* 8/3 수업 취소 표시 */}
              <line x1={X["0803"] - 7} y1={LANE_HARIN - 7} x2={X["0803"] + 7} y2={LANE_HARIN + 7} stroke="var(--color-grade)" strokeWidth={2} />
              <line x1={X["0803"] - 7} y1={LANE_HARIN + 7} x2={X["0803"] + 7} y2={LANE_HARIN - 7} stroke="var(--color-grade)" strokeWidth={2} />
              {/* 보강 분기 (아래로) 후 재합류 (공통 레인으로) */}
              <path
                d={`M ${X["0803"]} ${LANE_HARIN} L ${X["0805"]} ${LANE_HARIN + 22} L ${X["0807"]} ${LANE_HARIN} L ${X["0810"]} ${LANE_HARIN}`}
                fill="none"
                stroke="var(--color-pen)"
                strokeWidth={1.8}
                strokeDasharray="6 3"
              />
              <path
                d={`M ${X["0810"]} ${LANE_HARIN} C ${X["0810"] + 40} ${LANE_HARIN} ${X["0810"] + 40} ${LANE_COMMON} ${X["0812"]} ${LANE_COMMON}`}
                fill="none"
                stroke="var(--color-pen)"
                strokeWidth={1.8}
              />
              <rect x={X["0805"] - 22} y={LANE_HARIN + 26} width={44} height={20} rx={4} fill="var(--color-highlight)" />
              <text x={X["0805"]} y={LANE_HARIN + 40} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-ink)">
                보강
              </text>
              <text x={X["0810"] + 26} y={LANE_HARIN - 10} fontSize={10} fill="var(--color-pen)">
                재합류
              </text>
            </>
          )}
          {(["0728", "0730"] as const).map((k) => (
            <circle key={`h-${k}`} cx={X[k]} cy={LANE_HARIN} r={4.5} fill="var(--color-ink)" stroke="var(--color-ink)" strokeWidth={1.5} />
          ))}
          {absenceApplied && (
            <circle cx={X["0805"]} cy={LANE_HARIN + 22} r={4.5} fill="var(--color-highlight)" stroke="var(--color-ink)" strokeWidth={1.5} />
          )}
        </svg>
      </ScrollableRegion>

      {/* 변경 이유·전후 패널 — 모션 감소 환경에서도 동등한 정보 제공 */}
      <div className="space-y-2 border-t border-rule-soft px-4 py-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-soft">박서윤</span>
          <span>정답률 92% · 다음 개념 진행</span>
          <Badge kind="auto">자동 반영</Badge>
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-soft">이도윤</span>
          {scoreApplied ? (
            <>
              <span>
                <strong>변경 전</strong> 공통 진도 유지 → <strong>변경 후</strong>{" "}
                8월 7일(금) 확인테스트 + 5·7번 개념 오답 복습 배정
              </span>
              <Badge kind="auto">자동 반영 가능</Badge>
            </>
          ) : (
            <span>5·7번 오답 · 점수를 반영하면 금요일 확인테스트가 예약됩니다</span>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-soft">정하린</span>
          {absenceApplied ? (
            <>
              <span>
                8월 3일 학습 불참 이벤트가 전달되었습니다.{" "}
                <strong>완료된 7월 기록은 유지</strong>하고, 8월 5일 보강과 8월
                10일 반 진도 합류를 제안합니다.
              </span>
              <Badge kind="approve">선생님 승인 필요</Badge>
            </>
          ) : (
            <span>오늘 학습 불참 · 불참을 반영하면 미래 일정만 다시 계산됩니다</span>
          )}
        </p>
      </div>
    </div>
  );
}

function Badge({
  kind,
  children,
}: {
  kind: "auto" | "approve";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-control)] border px-1.5 py-0.5 font-mono text-[11px] ${
        kind === "auto"
          ? "border-pen text-pen"
          : "border-highlight bg-highlight-soft text-ink"
      }`}
    >
      {children}
    </span>
  );
}
