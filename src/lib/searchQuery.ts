/**
 * 메뉴바 검색이 새 q를 기존 쿼리스트링에 머지하는 부분만 뗀 순수 함수.
 *
 * search()(+layout.svelte) 본체는 location.search를 읽어야 해서(아래 참고)
 * 유닛 테스트로 직접 부르기 어렵다 — "그 문자열에 q를 얹거나 뺀다"는 계산
 * 자체는 입출력이 문자열뿐인 순수 로직이라 이 함수만 떼어 빠르게 검증한다.
 *
 * 주의: 이 함수는 "어떤 쿼리스트링을 읽어야 하는가"라는 실제 버그(태그·기간
 * 필터가 얕은 라우팅(replaceState)으로만 주소창에 반영되고 SvelteKit의
 * page.url은 갱신되지 않아, page.url.searchParams를 읽으면 그 필터들이
 * 사라지는 문제)는 검증하지 못한다 — 그건 실제 브라우저·실제 라우터가
 * 있어야 재현되므로 tests/e2e/import-flow.spec.ts의 E2E 테스트가 담당한다.
 */
export function mergeSearchQuery(currentSearch: string, q: string): string {
  const params = new URLSearchParams(currentSearch);
  if (q) params.set('q', q);
  else params.delete('q');
  return params.toString();
}
