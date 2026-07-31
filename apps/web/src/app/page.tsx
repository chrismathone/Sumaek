export default function LandingPage() {
  // Phase 1에서 전체 랜딩(수업 궤도판 데모 포함)으로 교체된다.
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-start justify-center gap-6 px-6">
      <p className="font-mono text-sm text-ink-soft">
        수학 선생님을 위한 수업 운영 시스템
      </p>
      <h1 className="text-4xl leading-snug font-semibold">
        수업이 시작되기 전에,
        <br />
        오늘의 진도와 테스트는
        <br />
        이미 준비되어 있습니다.
      </h1>
      <p className="max-w-xl text-ink-soft">
        반 공통 진도부터 학생별 분기, 자동 출제·채점, 학습 불참 이후 일정
        재계산까지. 선생님은 오늘 판단할 것만 확인합니다.
      </p>
    </main>
  );
}
