/**
 * 메뉴바 검색이 새 q를 기존 쿼리스트링에 머지하는 부분만 뗀 순수 함수.
 *
 * search()(+layout.svelte) 본체는 location.search를 읽어야 해서(그 함수
 * 자체의 주석 참고) 유닛 테스트로 직접 부르기 어렵다 — "그 문자열에 q를
 * 얹거나 뺀다"는 계산 자체는 입출력이 문자열뿐인 순수 로직이라 이 함수만
 * 떼어 빠르게 검증한다.
 *
 * 주의: 이 함수는 "어떤 문자열을 넘겨받는가"(location.search를 읽을지,
 * page.url.search를 읽을지)는 전혀 모른다 — 그 선택과 그 선택이 왜
 * 중요한지(+page.svelte의 필터 → URL 이펙트가 goto를 쓰지만 goto도
 * 비동기라 page.url이 아주 짧게 뒤처질 수 있다는 것)는 이 함수 바깥,
 * search() 쪽 문제다. 그래서 이 유닛 테스트는 그 실제 버그(무엇을
 * 읽어야 하는가)는 검증하지 못한다 — 그건 실제 브라우저·실제 라우터가
 * 있어야 재현되므로 tests/e2e/import-flow.spec.ts의 E2E 테스트가 담당한다.
 */
export function mergeSearchQuery(currentSearch: string, q: string): string {
  const params = new URLSearchParams(currentSearch);
  if (q) params.set('q', q);
  else params.delete('q');
  return params.toString();
}
