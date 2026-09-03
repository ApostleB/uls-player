<script lang="ts">
  let {
    tags = $bindable<string[]>([]),
    suggestions = [] as string[],
    placeholder = '태그 입력 후 Enter'
  } = $props();

  let draft = $state('');

  const matches = $derived(
    draft.trim()
      ? suggestions.filter((s) => s.includes(draft.trim()) && !tags.includes(s)).slice(0, 6)
      : []
  );

  function add(tag: string) {
    const t = tag.trim();
    if (t && !tags.includes(t)) tags = [...tags, t];
    draft = '';
  }

  function onKeydown(e: KeyboardEvent) {
    // 한글처럼 조합이 있는 입력에서는 조합 중에도 keydown이 온다. 그때
    // 처리하면 "정준일"을 치고 Enter를 눌렀을 때 태그가 둘로 갈라진다 —
    // 조합 중 Enter가 "정준일"을 넣고 draft를 비우면, IME가 대기 중이던
    // 마지막 음절을 그 빈 칸에 확정하고, 브라우저가 조합 종료 후 보내는
    // 두 번째 Enter가 그 "일"을 별개 태그로 추가한다.
    //
    // 조합이 끝나면 브라우저가 Enter를 한 번 더 주므로, 여기서 무시해도
    // 태그를 넣을 기회를 잃지 않는다. Backspace도 조합 중에는 태그가
    // 아니라 자모를 지우는 키이므로 같이 막는다.
    if (e.isComposing) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      add(matches[0] ?? draft);
    } else if (e.key === 'Backspace' && draft === '' && tags.length) {
      tags = tags.slice(0, -1);
    }
  }
</script>

<div class="flex flex-wrap items-center gap-1">
  {#each tags as tag (tag)}
    <span class="badge preset-filled-primary-500 gap-1">
      {tag}
      <button type="button" aria-label="{tag} 제거" onclick={() => (tags = tags.filter((t) => t !== tag))}>
        ×
      </button>
    </span>
  {/each}
  <input
    class="input w-32 grow"
    bind:value={draft}
    onkeydown={onKeydown}
    {placeholder}
  />
</div>

{#if matches.length}
  <div class="mt-1 flex flex-wrap gap-1">
    {#each matches as m (m)}
      <button type="button" class="chip preset-tonal" onclick={() => add(m)}>{m}</button>
    {/each}
  </div>
{/if}

<style>
  /* 안내 문구가 입력창 너비보다 길어 잘려 보인다. 입력한 글자 크기는
     그대로 두고 안내 문구만 2px 줄인다. 1em은 이 input이 실제로 쓰는
     크기라, 테마나 상위 스타일이 바뀌어도 "2px 작게"가 유지된다. */
  input::placeholder {
    font-size: calc(1em - 2px);
  }
</style>
