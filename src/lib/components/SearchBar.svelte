<script lang="ts">
  import type { Filter, SearchScope } from '$lib/types';

  let { filter = $bindable<Filter>(), total = 0, shown = 0 } = $props();

  /**
   * 글자마다 URL을 바꾸면 렌더가 과하게 돈다. 사람이 한 단어를 치는
   * 사이보다는 길고, 다 치고 멈췄을 때 기다렸다는 느낌은 안 들 만큼
   * 짧게 잡았다. Enter는 이 대기를 건너뛴다.
   */
  const SEARCH_DEBOUNCE_MS = 250;

  const SCOPES: { value: SearchScope; label: string }[] = [
    { value: 'all', label: '전체' },
    { value: 'title', label: '제목' },
    { value: 'description', label: '설명' },
    { value: 'tags', label: '태그' }
  ];

  // svelte-ignore state_referenced_locally -- 초기값만 한 번 캡처한다.
  // 바깥에서 filter.q가 바뀌는 경우는 바로 아래 $effect가 매번 다시 반영한다.
  let draft = $state(filter.q);
  let timer: ReturnType<typeof setTimeout> | null = null;

  // 바깥에서 q가 바뀌면(링크로 직접 진입, 뒤로 가기, 초기화 버튼)
  // 입력에도 반영한다.
  $effect(() => {
    draft = filter.q;
  });

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      filter.q = draft;
    }, SEARCH_DEBOUNCE_MS);
  }

  function commitNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    filter.q = draft;
  }

  /**
   * 범위는 타이핑이 아니라 선택이므로 즉시 반영한다. 대기 중이던
   * 검색어도 함께 커밋한다 — 그러지 않으면 "새 범위 + 옛 검색어"라는
   * 아무도 요청하지 않은 조합이 잠깐 화면에 나온다.
   */
  function changeScope(next: SearchScope) {
    commitNow();
    filter.scope = next;
  }

  $effect(() => {
    return () => {
      if (timer) clearTimeout(timer);
    };
  });
</script>

<div class="card preset-tonal flex flex-wrap items-center gap-3 p-4">
  <input
    class="input grow sm:max-w-md"
    placeholder="검색어"
    aria-label="검색어"
    bind:value={draft}
    oninput={schedule}
    onkeydown={(e) => {
      // 한글 조합 중 Enter는 무시한다 — TagInput과 같은 이유로,
      // 조합 확정과 키 입력이 겹쳐 두 번 들어온다.
      if (e.isComposing) return;
      if (e.key === 'Enter') commitNow();
    }}
  />

  <select
    class="select w-28"
    aria-label="검색 범위"
    value={filter.scope}
    onchange={(e) => changeScope(e.currentTarget.value as SearchScope)}
  >
    {#each SCOPES as s (s.value)}
      <option value={s.value}>{s.label}</option>
    {/each}
  </select>

  <span class="text-surface-500 ml-auto text-sm tabular-nums">{shown} / {total}</span>
</div>
