<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import MenuBar from '$lib/components/MenuBar.svelte';

  let { children } = $props();

  const onList = $derived(
    page.url.pathname === '/recordings' || page.url.pathname.startsWith('/recordings/')
  );

  function search(q: string) {
    const params = new URLSearchParams(page.url.searchParams);
    if (q) params.set('q', q);
    else params.delete('q');

    const qs = params.toString();
    const target = qs ? `/recordings?${qs}` : '/recordings';

    // 목록에 이미 있으면 히스토리를 쌓지 않는다 — 검색어 한 글자마다
    // 뒤로 가기 항목이 생기면 브라우저 뒤로 가기가 쓸모없어진다.
    void goto(target, { replaceState: onList, keepFocus: true, noScroll: true });
  }
</script>

<MenuBar pathname={page.url.pathname} q={page.url.searchParams.get('q') ?? ''} onsearch={search} />

{@render children()}
