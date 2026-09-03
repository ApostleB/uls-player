<script lang="ts">
  import type { Filter } from '$lib/types';

  let {
    filter = $bindable<Filter>(),
    tags = [] as { tag: string; count: number }[],
    total = 0,
    shown = 0
  } = $props();

  function toggleTag(tag: string) {
    filter.tags = filter.tags.includes(tag)
      ? filter.tags.filter((t) => t !== tag)
      : [...filter.tags, tag];
  }
</script>

<div class="card preset-tonal space-y-3 p-4">
  <div class="flex flex-wrap items-center gap-3">
    <label class="flex items-center gap-2 text-sm">
      <span>기간</span>
      <input type="date" class="input" bind:value={filter.from} />
      <span>~</span>
      <input type="date" class="input" bind:value={filter.to} />
    </label>
    <button type="button" class="btn btn-sm preset-tonal"
      onclick={() => (filter = { q: '', tags: [], tagMode: 'and', from: '', to: '' })}>
      초기화
    </button>
    <span class="text-surface-500 ml-auto text-sm tabular-nums">{shown} / {total}</span>
  </div>

  {#if tags.length}
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex overflow-hidden rounded">
        <button type="button"
          class="btn btn-sm {filter.tagMode === 'and' ? 'preset-filled' : 'preset-tonal'}"
          onclick={() => (filter.tagMode = 'and')}>모두 포함</button>
        <button type="button"
          class="btn btn-sm {filter.tagMode === 'or' ? 'preset-filled' : 'preset-tonal'}"
          onclick={() => (filter.tagMode = 'or')}>하나라도</button>
      </div>
      {#each tags as t (t.tag)}
        <button type="button"
          class="chip {filter.tags.includes(t.tag) ? 'preset-filled-primary-500' : 'preset-tonal'}"
          onclick={() => toggleTag(t.tag)}>
          {t.tag}<span class="ml-1 opacity-60 tabular-nums">{t.count}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
