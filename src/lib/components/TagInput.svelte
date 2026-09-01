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
