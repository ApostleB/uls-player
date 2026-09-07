<script lang="ts">
  import type { Filter } from '$lib/types';
  import type { ExtensionCount } from '$lib/extensions';
  import { EMPTY_FILTER } from '$lib/filter';

  let {
    filter = $bindable<Filter>(),
    tags = [] as { tag: string; count: number }[],
    exts = [] as ExtensionCount[]
  } = $props();

  function toggleTag(tag: string) {
    filter.tags = filter.tags.includes(tag)
      ? filter.tags.filter((t: string) => t !== tag)
      : [...filter.tags, tag];
  }

  function toggleExt(ext: string) {
    filter.ext = filter.ext.includes(ext)
      ? filter.ext.filter((e: string) => e !== ext)
      : [...filter.ext, ext];
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
      onclick={() => (filter = { ...EMPTY_FILTER })}>
      초기화
    </button>
  </div>

  <!-- 고를 것이 하나뿐인 필터는 자리만 차지한다. 태그 줄이 같은 판단을 한다. -->
  {#if exts.length > 1}
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-surface-500 text-sm">확장자</span>
      {#each exts as e (e.ext)}
        <button type="button"
          class="chip {filter.ext.includes(e.ext) ? 'preset-filled-primary-500' : 'preset-tonal'}"
          onclick={() => toggleExt(e.ext)}>
          {e.ext}<span class="ml-1 opacity-60 tabular-nums">{e.count}</span>
        </button>
      {/each}
    </div>
  {/if}

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
