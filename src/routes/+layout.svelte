<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import MenuBar from '$lib/components/MenuBar.svelte';
  import { mergeSearchQuery } from '$lib/searchQuery';

  let { children } = $props();

  const onList = $derived(
    page.url.pathname === '/recordings' || page.url.pathname.startsWith('/recordings/')
  );

  function search(q: string) {
    // page.url이 아니라 location.search를 읽는다 — 목록의 태그·기간 필터는
    // +page.svelte의 필터→URL 이펙트가 replaceState(얕은 라우팅)로만
    // 주소창에 반영하는데, @sveltejs/kit@2.70.3의 replaceState/pushState는
    // page.state만 갱신하고 page.url은 절대 건드리지 않는다(client.js의
    // replaceState 구현 확인 — history.replaceState만 부르고 `page.url =`
    // 대입이 없다; 그 대입은 진짜 내비게이션(goto) 경로에만 있다). 그래서
    // 여기서 page.url.searchParams를 읽으면, 검색 직전에 로컬로 고른
    // 태그·기간이 반영된 적 없는 옛 값을 읽어 그대로 잃어버린다. 반면
    // history.replaceState는 브라우저 주소창(location)은 실제로 갱신하므로
    // location.search를 읽으면 항상 최신이다.
    //
    // location 접근은 이 함수 안에서만 한다 — 이 레이아웃 자체는 서버에서도
    // 렌더되지만(SSR에는 location이 없다), search()는 메뉴바 입력이라는
    // 브라우저 이벤트 핸들러에서만 불리므로 여기 도달할 때는 항상 브라우저다.
    const qs = mergeSearchQuery(location.search, q);
    const target = qs ? `/recordings?${qs}` : '/recordings';

    // 목록에 이미 있으면 히스토리를 쌓지 않는다 — 검색어 한 글자마다
    // 뒤로 가기 항목이 생기면 브라우저 뒤로 가기가 쓸모없어진다.
    void goto(target, { replaceState: onList, keepFocus: true, noScroll: true });
  }
</script>

<MenuBar pathname={page.url.pathname} q={page.url.searchParams.get('q') ?? ''} onsearch={search} />

{@render children()}
