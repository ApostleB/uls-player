<script lang="ts">
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import type { Filter, Recording } from '$lib/types';
  import { applyFilter, filterFromParams, filterToParams } from '$lib/filter';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import TagInput from '$lib/components/TagInput.svelte';

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
  let editingDescriptionId = $state<string | null>(null);
  // 태그 편집은 TagInput을 감싸 쓰는 쪽이라 blur 한 번으로 끝나지 않는다
  // (칩을 추가/삭제할 때마다 내부 포커스가 이동한다) — 그래서 제목·설명과
  // 달리 명시적인 "완료" 버튼으로 커밋 시점을 못박는다. tagsDraft는 그
  // 커밋 전까지의 작업 사본이고, 실제 rec.tags는 서버 응답이 온 뒤에만
  // (recordings 전체 교체를 통해) 바뀐다.
  let editingTagsId = $state<string | null>(null);
  let tagsDraft = $state<string[]>([]);
  // 일괄 태그 추가/제거에 쓸 작업 중인 태그 집합. 목록 화면 전체에서
  // 하나뿐이라 행별 편집(tagsDraft)과는 별개다.
  let bulkTags = $state<string[]>([]);

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
  // 행 인라인 태그 편집·일괄 태그 추가/제거의 자동완성 후보.
  const tagNames = $derived(tags.map((t) => t.tag));

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

  function startEditTags(rec: Recording) {
    tagsDraft = [...rec.tags];
    editingTagsId = rec.id;
  }

  function commitTags(id: string) {
    send({ op: 'patch', id, tags: tagsDraft });
    editingTagsId = null;
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
      <span class="shrink-0 text-sm">{selectedIds.size}개 선택됨</span>

      <!-- 252개 중 여러 행을 골라 태그를 한 번에 붙이는 게 이 화면의
           핵심 동선이라, 삭제보다 먼저·더 넓게 배치한다. -->
      <div class="flex grow flex-wrap items-center gap-2">
        <TagInput bind:tags={bulkTags} suggestions={tagNames} />
        <button type="button" class="btn btn-sm preset-filled"
          disabled={!bulkTags.length}
          onclick={() =>
            send({ op: 'addTags', ids: [...selectedIds], tags: bulkTags }).then(
              () => (bulkTags = [])
            )}>
          태그 추가
        </button>
        <button type="button" class="btn btn-sm preset-tonal"
          disabled={!bulkTags.length}
          onclick={() =>
            send({ op: 'removeTags', ids: [...selectedIds], tags: bulkTags }).then(
              () => (bulkTags = [])
            )}>
          태그 제거
        </button>
      </div>

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

        <div class="flex min-w-0 grow flex-col gap-1">
          {#if editingId === rec.id}
            <input class="input" value={rec.title}
              onblur={(e) => {
                send({ op: 'patch', id: rec.id, title: e.currentTarget.value });
                editingId = null;
              }} />
          {:else}
            <!-- 재생 대상 선택(Task 15의 시접)과 제목 수정 진입을 같은
                 버튼에 둔다 — 이미 포커스·키보드 조작이 되는 실제 버튼이라
                 li 자체를 인위적으로 상호작용 요소로 만들 필요가 없다. -->
            <button type="button" class="text-left"
              onclick={() => (selectedId = rec.id)}
              ondblclick={() => (editingId = rec.id)}>
              {rec.title}
            </button>
          {/if}

          {#if editingDescriptionId === rec.id}
            <input class="input text-sm" value={rec.description} aria-label="설명 수정"
              onblur={(e) => {
                send({ op: 'patch', id: rec.id, description: e.currentTarget.value });
                editingDescriptionId = null;
              }} />
          {:else}
            <button type="button" class="text-surface-500 text-left text-sm"
              ondblclick={() => (editingDescriptionId = rec.id)}>
              {rec.description || '설명 없음'}
            </button>
          {/if}

          {#if editingTagsId === rec.id}
            <div class="flex flex-wrap items-center gap-2">
              <TagInput bind:tags={tagsDraft} suggestions={tagNames} />
              <button type="button" class="btn btn-sm preset-filled"
                onclick={() => commitTags(rec.id)}>완료</button>
            </div>
          {:else}
            <button type="button" class="flex flex-wrap gap-1 text-left"
              ondblclick={() => startEditTags(rec)}>
              {#each rec.tags as t (t)}<span class="chip preset-tonal">{t}</span>{/each}
              {#if !rec.tags.length}<span class="text-surface-500 text-sm">태그 없음</span>{/if}
            </button>
          {/if}
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
