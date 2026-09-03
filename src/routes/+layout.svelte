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
    // page.url이 아니라 location.search를 읽는다. 목록의 태그·기간 필터
    // (+page.svelte의 필터 → URL 이펙트)는 이제 replaceState가 아니라
    // goto(진짜 내비게이션)를 쓰므로 page.url도 결국 최신이 되긴 하지만,
    // goto는 비동기라 그 순간까지는 짧은 지연이 있다(Round 2에서 이
    // 지연 때문에 untrack이 여전히 필요하다는 걸 실측으로 확인했다 —
    // +page.svelte의 필터 → URL 이펙트 주석 참고). location.search는
    // history.pushState/replaceState가 갱신하는 브라우저 주소창 그
    // 자체라 그 지연 없이 항상 즉시 최신이므로, SvelteKit의 미러링을
    // 기다릴 필요 없는 더 견고한 쪽을 그대로 쓴다.
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
