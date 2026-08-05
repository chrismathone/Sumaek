/* ─────────────────────────────────────────────────────────────
 * 콘텐츠가 사는 곳 (ADR-0020).
 *
 * 콘텐츠(문항·자료·교재)는 조직별이 아니라 DB 전체 자산이고 마스터만
 * 넣는다. 학습자 데이터(진도·응시·숙련도)는 여전히 조직 소유다.
 *
 * **두 축을 절대 섞지 않는다.** 한 파일 안에서 같은 `organizationId`가
 * 콘텐츠 질의와 학습자 질의에 함께 쓰이는 자리가 많다 —
 * `learning-material.ts` 하나에도 `learning_materials`(콘텐츠)와
 * `learner_material_progress`(학습자 기록)가 같은 인자를 쓴다. 학습자
 * 기록까지 플랫폼을 보게 만들면 **한 학원의 진도가 다른 학원에 보인다.**
 * 그래서 도우미 이름에 `content`를 박아 두었다 — 학습자 질의에서 이
 * 이름이 보이면 그 자체가 잘못이다.
 *
 * 지금은 **깃발이 꺼져 있다**(ADR-0020 2단계). 꺼져 있으면 자기 조직만
 * 담은 배열이라 생성되는 SQL이 이전과 같다 — 값이 바뀌지 않는 리팩터링을
 * 먼저 끝내 두어야, 진짜 전환(3단계)이 「update 18문장 + 깃발 하나」로
 * 줄어든다. 그 크기라야 되돌릴 수 있다.
 * ───────────────────────────────────────────────────────────── */

/** 0019b가 만든 플랫폼 조직. SQL 쪽 이름은 `public.platform_org_id()`. */
export const PLATFORM_ORGANIZATION_ID = "00000000-0000-7000-8000-0000000000ff";

/**
 * 콘텐츠 이전이 끝났는가 (ADR-0020 3단계).
 *
 * 3단계에서 콘텐츠 18표를 플랫폼 조직으로 옮기는 것과 **같은 배포로**
 * 켠다. 먼저 켜면 콘텐츠가 아직 데모 조직에 있어 달라지는 것이 없고,
 * 먼저 옮기면 질의가 아직 자기 조직만 보고 있어 화면이 그 순간 빈다.
 */
export const PLATFORM_CONTENT_ENABLED =
  process.env.PLATFORM_CONTENT === "1";

/**
 * 콘텐츠를 읽을 때 볼 조직 목록.
 *
 * 목록인 이유: 깃발이 켜진 뒤에도 자기 조직을 남겨 둬야 한다. 통합
 * 테스트가 만드는 조직들은 자기 콘텐츠를 만들어 자기가 읽는데, 플랫폼
 * 하나만 보게 하면 그 테스트가 그 자리에서 깨진다. 실제 운영에서는
 * 조직에 콘텐츠가 없으므로 `any(...)`가 플랫폼만 고르는 것과 같다.
 *
 *     where q.organization_id = any(${contentOrganizationIds(orgId)}::uuid[])
 */
export function contentOrganizationIds(organizationId: string): string[] {
  return PLATFORM_CONTENT_ENABLED
    ? [organizationId, PLATFORM_ORGANIZATION_ID]
    : [organizationId];
}

/**
 * 콘텐츠를 **쓸** 때의 조직.
 *
 * 읽기와 달리 쓰기는 한 곳이어야 한다 — 어디에 쓸지가 두 곳이면 같은
 * 문항이 두 벌 생긴다. 마스터 권한 게이트는 5단계에서 붙는다.
 */
export function contentWriteOrganizationId(organizationId: string): string {
  return PLATFORM_CONTENT_ENABLED ? PLATFORM_ORGANIZATION_ID : organizationId;
}
