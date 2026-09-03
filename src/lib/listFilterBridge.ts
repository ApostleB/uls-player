/**
 * 메뉴바(+layout.svelte, 모든 화면에 항상 떠 있다)의 검색과 목록 화면
 * (+page.svelte, /recordings에서만 마운트된다)의 태그·기간 필터는 결국
 * 같은 URL 쿼리스트링을 함께 바꾼다. 예전엔 둘이 각자 goto를 따로
 * 불렀다 — goto는 비동기라 실제로 history에 반영되기 전까지는
 * location.search·page.url이 낡은 값을 돌려주는데, 두 goto가 그 사이에
 * 겹치면 나중에 "요청된" 쪽이 앞선 쪽의 변경을 아직 못 본 낡은 스냅샷을
 * 기준으로 계산해 그 변경을 조용히 지워버릴 수 있었다(최종 브랜치 리뷰
 * 발견 1 — 태그를 고르자마자 메뉴바로 검색하면 태그가 사라지는 경합).
 *
 * 이 모듈은 그 두 writer를 하나로 합쳐 경합 자체를 없앤다: 목록 화면이
 * 떠 있는 동안은 메뉴바의 검색이 이 화면의 filter.q를 직접(동기적으로)
 * 바꾸기만 하고, 실제 goto는 (이미 있던) 목록의 필터 → URL 이펙트
 * 하나만 부른다. 태그·기간·검색어가 전부 같은 filter 객체 하나를 거쳐서만
 * URL에 반영되므로, "지금 쿼리가 뭐냐"를 스냅샷으로 다시 읽어 병합할
 * 필요 자체가 없다 — 읽을 스냅샷이 없으니 그게 낡을 일도 없다.
 *
 * 목록 화면이 떠 있지 않을 때(메인 화면 등)는 등록된 setter가 없으므로
 * setListSearchQuery가 false를 돌려주고, 호출한 쪽(+layout.svelte)이
 * 예전처럼 직접 내비게이션한다 — 그때는 동시에 같은 URL을 바꿀 다른
 * writer가 없어 애초에 경합이 성립하지 않는다.
 */

let setQuery: ((q: string) => void) | null = null;

/**
 * 목록 화면이 마운트될 때(+page.svelte의 onMount) 불러 등록한다. 반환하는
 * 함수를 언마운트 시(onMount의 cleanup)에 불러 해제한다.
 */
export function registerListFilter(setter: (q: string) => void): () => void {
  setQuery = setter;
  return () => {
    if (setQuery === setter) setQuery = null;
  };
}

/**
 * 목록 화면이 떠 있으면 그 필터의 q를 직접 바꾸고 true를 돌려준다.
 * 떠 있지 않으면 아무 것도 하지 않고 false를 돌려준다 — 호출한 쪽이
 * false를 받으면 직접 내비게이션해야 한다는 뜻이다.
 */
export function setListSearchQuery(q: string): boolean {
  if (!setQuery) return false;
  setQuery(q);
  return true;
}
