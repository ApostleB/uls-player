<script lang="ts">
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import type { Filter, Recording } from '$lib/types';
  import { applyFilter, filterFromParams, filterToParams } from '$lib/filter';
  import FilterBar from '$lib/components/FilterBar.svelte';

  let { data } = $props();

  // svelte-ignore state_referenced_locally -- 최초 SSR/마운트 렌더가 곧바로
  // 올바르도록 초기값만 한 번 캡처한다. data가 이후에 실제로 바뀌는 경우
  // (아래 $effect)는 그때 다시 반영되므로 의도된 스냅샷이다.
  let recordings = $state<Recording[]>(data.recordings);
  // svelte-ignore state_referenced_locally
  let tags = $state(data.tags);
  let filter = $state<Filter>(filterFromParams(page.url.searchParams));
  let selectedIds = $state<Set<string>>(new Set());
  let editingId = $state<string | null>(null);

  // Task 15의 시접(seam): 행을 클릭하면 이 값만 바뀐다 — 페이지 이동도,
  // 목록 접힘도 없다. Task 15가 이 값을 읽어 하단 고정 플레이어에 녹음을
  // 로드한다.
  let selectedId = $state<string | null>(null);

  // data는 SvelteKit이 load를 다시 실행할 때마다(예: /import에서 돌아오는
  // 내비게이션, invalidateAll 등) 새 참조로 바뀐다. 이 이펙트는 그 순간마다
  // recordings·tags를 최신 load 결과로 되돌린다 — 그러지 않으면 위 $state
  // 초기값이 마운트 시점 스냅샷으로 굳어버려서, 가져오기 화면에서 새로
  // 등록한 녹음이 목록으로 돌아와도 새로고침 전까지 보이지 않는다.
  // send()가 PATCH 응답으로 recordings·tags를 직접 덮어쓰는 경로와는
  // 충돌하지 않는다 — 여기서는 오직 data.recordings/data.tags만 읽고
  // recordings/tags 자체는 읽지 않으므로, send()의 로컬 갱신이 이 이펙트를
  // 다시 돌리지 않는다.
  $effect(() => {
    recordings = data.recordings;
  });
  $effect(() => {
    tags = data.tags;
  });

  const shown = $derived(applyFilter(recordings, filter));

  // 필터를 URL에 반영해 새로고침과 링크 공유에서 유지되게 한다
  $effect(() => {
    const qs = filterToParams(filter).toString();
    replaceState(qs ? `?${qs}` : '/', {});
  });

  async function send(body: unknown) {
    const res = await fetch('/api/recordings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return;
    const next = await res.json();
    recordings = next.recordings;
    tags = next.tags;
  }

  function toggle(id: string) {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    selectedIds = s;
  }

  function fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  }
</script>

<div class="mx-auto max-w-6xl space-y-4 p-6 pb-40">
  <header class="flex items-baseline justify-between">
    <h1 class="h2">ULS Player</h1>
    <a href="/import" class="btn preset-filled">가져오기</a>
  </header>

  <FilterBar bind:filter {tags} total={recordings.length} shown={shown.length} />

  {#if selectedIds.size}
    <div class="card preset-tonal-primary flex flex-wrap items-center gap-3 p-3">
      <span class="text-sm">{selectedIds.size}개 선택됨</span>
      <button type="button" class="btn btn-sm preset-tonal"
        onclick={() => send({ op: 'delete', ids: [...selectedIds] }).then(() => (selectedIds = new Set()))}>
        목록에서 제거
      </button>
      <button type="button" class="btn btn-sm preset-tonal"
        onclick={() => (selectedIds = new Set())}>선택 해제</button>
    </div>
  {/if}

  <ul class="space-y-1">
    {#each shown as rec (rec.id)}
      <li class="card hover:preset-tonal flex items-center gap-3 p-3"
        class:preset-tonal-primary={selectedId === rec.id}>
        <input type="checkbox" class="checkbox"
          checked={selectedIds.has(rec.id)} onchange={() => toggle(rec.id)} />

        {#if editingId === rec.id}
          <input class="input grow" value={rec.title}
            onblur={(e) => {
              send({ op: 'patch', id: rec.id, title: e.currentTarget.value });
              editingId = null;
            }} />
        {:else}
          <!-- 재생 대상 선택(Task 15의 시접)과 제목 수정 진입을 같은
               버튼에 둔다 — 이미 포커스·키보드 조작이 되는 실제 버튼이라
               li 자체를 인위적으로 상호작용 요소로 만들 필요가 없다. -->
          <button type="button" class="grow text-left"
            onclick={() => (selectedId = rec.id)}
            ondblclick={() => (editingId = rec.id)}>
            {rec.title}
          </button>
        {/if}

        <div class="flex shrink-0 gap-1">
          {#each rec.tags as t (t)}<span class="chip preset-tonal">{t}</span>{/each}
        </div>
        <span class="text-surface-500 shrink-0 text-sm tabular-nums">
          {rec.recordedAt.replace('T', ' ').slice(0, 16)}
        </span>
        <span class="shrink-0 text-sm tabular-nums">{fmt(rec.durationSec)}</span>
        <div class="flex shrink-0 gap-1">
          {#each Object.keys(rec.files) as f (f)}
            <span class="badge preset-tonal text-xs uppercase">{f === 'original' ? rec.files[f].ext : f}</span>
          {/each}
        </div>
      </li>
    {:else}
      <li class="card preset-tonal p-8 text-center">
        {recordings.length ? '조건에 맞는 녹음이 없습니다' : '아직 가져온 녹음이 없습니다'}
      </li>
    {/each}
  </ul>
</div>
