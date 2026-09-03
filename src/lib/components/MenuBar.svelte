<script lang="ts">
  let { pathname = '/' } = $props();

  /**
   * 접두사로 판정한다. /recordings 아래에 하위 경로가 생기더라도
   * "리스트"가 활성으로 남아야 하기 때문이다. 메인은 정확히 '/'일
   * 때만이다 — 접두사로 보면 모든 경로가 메인이 된다.
   */
  const onMain = $derived(pathname === '/');
  const onList = $derived(pathname === '/recordings' || pathname.startsWith('/recordings/'));
</script>

<header class="bg-surface-100-900 border-surface-200-800 border-b">
  <nav class="mx-auto flex max-w-6xl items-center gap-4 p-3">
    <a href="/" class="font-bold">ULS Player</a>

    <div class="ml-auto flex items-center gap-2">
      <a
        href="/"
        class="btn btn-sm {onMain ? 'preset-filled' : 'preset-tonal'}"
        aria-current={onMain ? 'page' : undefined}
      >
        메인
      </a>
      <a
        href="/recordings"
        class="btn btn-sm {onList ? 'preset-filled' : 'preset-tonal'}"
        aria-current={onList ? 'page' : undefined}
      >
        리스트
      </a>
    </div>
  </nav>
</header>
