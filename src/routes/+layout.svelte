<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import MenuBar from '$lib/components/MenuBar.svelte';
  import { mergeSearchQuery } from '$lib/searchQuery';
  import { setListSearchQuery } from '$lib/listFilterBridge';

  let { children } = $props();

  function search(q: string) {
    // 목록 화면(+page.svelte)이 떠 있으면 그 화면의 filter.q만 바꾸고
    // 끝낸다 — 태그·기간과 합쳐 실제 URL에 반영하는 goto는 그 화면의
    // 필터 → URL 이펙트 하나가 전담한다(자세한 이유는
    // $lib/listFilterBridge.ts 참고). 여기서 goto를 따로 부르면 그
    // 이펙트의 goto와 서로 다른 순간의 스냅샷(location.search나 page.url)을
    // 기준으로 겹쳐 써서, 태그를 고르자마자 검색하는 것처럼 두 변경이
    // 겹칠 때 한쪽이 사라지는 경합이 생긴다(최종 브랜치 리뷰 발견 1) —
    // 그래서 목록이 떠 있는 동안은 이 함수가 goto를 아예 부르지 않는다.
    if (setListSearchQuery(q)) return;

    // 목록 화면이 없으면(메인 화면 등) 동시에 같은 URL을 바꿀 다른 writer가
    // 없으니 경합도 없다 — 직접 내비게이션한다. mergeSearchQuery는 순수
    // 함수라 그대로 재사용하되, 기준으로 삼는 location.search는 이 함수
    // 안에서만 읽는다 — 이 레이아웃 자체는 서버에서도 렌더되지만(SSR에는
    // location이 없다), search()는 메뉴바 입력이라는 브라우저 이벤트
    // 핸들러에서만 불리므로 여기 도달할 때는 항상 브라우저다.
    const qs = mergeSearchQuery(location.search, q);
    const target = qs ? `/recordings?${qs}` : '/recordings';

    // 목록 화면이 없다는 건 아직 목록에 진입하지 않았다는 뜻이므로 항상
    // 새 히스토리 항목을 쌓는다(뒤로 가기로 지금 화면으로 돌아올 수 있어야
    // 한다).
    void goto(target, { keepFocus: true, noScroll: true });
  }
</script>

<MenuBar pathname={page.url.pathname} q={page.url.searchParams.get('q') ?? ''} onsearch={search} />

{@render children()}
