<script lang="ts">
  let { pathname = '/', q = '', onsearch = (_: string) => {} } = $props();

  /**
   * 접두사로 판정한다. /recordings 아래에 하위 경로가 생기더라도
   * "리스트"가 활성으로 남아야 하기 때문이다. 메인은 정확히 '/'일
   * 때만이다 — 접두사로 보면 모든 경로가 메인이 된다.
   */
  const onMain = $derived(pathname === '/');
  const onList = $derived(pathname === '/recordings' || pathname.startsWith('/recordings/'));

  /**
   * 글자마다 URL을 바꾸면 렌더가 과하게 돈다. 사람이 한 단어를 치는
   * 사이보다는 길고, 다 치고 멈췄을 때 기다렸다는 느낌은 안 들 만큼
   * 짧게 잡았다. Enter는 이 대기를 건너뛴다.
   */
  const SEARCH_DEBOUNCE_MS = 250;

  // svelte-ignore state_referenced_locally -- 초기값만 한 번 캡처한다.
  // 바깥에서 q가 바뀌는 경우는 바로 아래 $effect가 매번 다시 반영한다.
  let draft = $state(q);
  let timer: ReturnType<typeof setTimeout> | null = null;

  // 바깥에서 q가 바뀌면(링크로 직접 진입, 뒤로 가기) 입력에도 반영한다.
  $effect(() => {
    draft = q;
  });

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onsearch(draft);
    }, SEARCH_DEBOUNCE_MS);
  }

  function commitNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    onsearch(draft);
  }

  $effect(() => {
    return () => {
      if (timer) clearTimeout(timer);
    };
  });
</script>

<header class="bg-surface-100-900 border-surface-200-800 border-b">
  <nav class="mx-auto flex max-w-6xl items-center gap-4 p-3">
    <a href="/" class="font-bold">ULS Player</a>

    <div class="ml-auto flex items-center gap-2">
      <input
        class="input w-48"
        placeholder="제목 검색"
        bind:value={draft}
        oninput={schedule}
        onkeydown={(e) => {
          // 한글 조합 중 Enter는 무시한다 — TagInput과 같은 이유로,
          // 조합 확정과 키 입력이 겹쳐 두 번 들어온다.
          if (e.isComposing) return;
          if (e.key === 'Enter') commitNow();
        }}
      />
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
