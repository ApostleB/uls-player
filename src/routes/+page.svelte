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

  // send() 실패를 화면에 보여줄 메시지. /import가 form.message를
  // preset-tonal-error 카드로 보여주는 것과 같은 패턴을 따른다.
  let errorMessage = $state<string | null>(null);

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

  // 선택은 필터가 바뀌어도 유지된다(스펙 의도: 필터로 골라낸 뒤 다시
  // 넓혀서 일괄 작업을 계속할 수 있어야 한다) — 다만 지금 화면에 없는
  // 선택 행이 섞여 있으면 일괄 작업이 안 보이는 행에도 적용된다는 걸
  // 툴바에서 알려준다.
  const hiddenSelectedCount = $derived(
    [...selectedIds].filter((id) => !shown.some((r) => r.id === id)).length
  );

  // 필터를 URL에 반영해 새로고침과 링크 공유에서 유지되게 한다
  $effect(() => {
    const qs = filterToParams(filter).toString();
    replaceState(qs ? `?${qs}` : '/', {});
  });

  // 태그를 편집하던 행이 필터에 걸리거나(검색어 변경 등) 새 load
  // 결과에서 아예 사라지면(예: 삭제) 완료 버튼이 없는 화면 밖에 초안만
  // 남는다 — 행을 바꿀 때와 같은 규칙으로 그 자리에서 저장하고 편집을
  // 닫는다.
  $effect(() => {
    if (editingTagsId !== null && !shown.some((r) => r.id === editingTagsId)) {
      saveTags(editingTagsId, tagsDraft);
      editingTagsId = null;
    }
  });

  // 실패를 호출한 쪽에 boolean으로 돌려준다 — 그래야 각 호출부가
  // "성공했을 때만" 선택·초안을 비운다. 예전에는 실패해도 그냥
  // return해서, 호출부는 무조건 .then()에서 상태를 비웠다 — 400/500이
  // 나도(동시에 삭제된 행, updateJson 쓰기 실패 등) 툴바가 그대로
  // 닫히며 성공한 것처럼 보이고, 252개 중 골라둔 선택이 이유 없이
  // 사라졌다.
  async function send(body: unknown): Promise<boolean> {
    const res = await fetch('/api/recordings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      // API는 400에서 { message } JSON을 돌려준다 — 그 문구를 그대로
      // 보여준다. 본문을 못 읽으면(예상 밖의 500 등) 상태 코드만이라도.
      const failure = await res.json().catch(() => null);
      errorMessage =
        (failure && typeof failure.message === 'string' && failure.message) ||
        `요청이 실패했습니다 (${res.status})`;
      return false;
    }
    errorMessage = null;
    const next = await res.json();
    recordings = next.recordings;
    tags = next.tags;
    return true;
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

  // 순수하게 서버로 보내기만 한다 — editingTagsId를 어떻게 다룰지는
  // 호출하는 쪽(완료 버튼 vs 다른 행/필터로 전환)이 각자 정한다.
  // commitTags가 여기서 editingTagsId까지 건드리면, startEditTags가 이미
  // 다음 행으로 넘어간 뒤에 이전 저장이 뒤늦게 끝나면서 방금 연 행의
  // 편집 상태를 지워버리는 경쟁 상태가 생긴다.
  function saveTags(id: string, draftTags: string[]) {
    return send({ op: 'patch', id, tags: draftTags });
  }

  function commitTags(id: string) {
    saveTags(id, tagsDraft).then((ok) => {
      if (ok) editingTagsId = null;
    });
  }

  function startEditTags(rec: Recording) {
    // 다른 행의 태그를 편집하던 중이면(완료를 안 누르고) 그 초안을 먼저
    // 저장한다 — 제목·설명은 blur로 이미 "옮겨가면 저장된다"가 되어
    // 있으니 태그도 같은 규칙을 따른다. 저장이 끝나길 기다리지 않는다
    // — 확인창도, 더러움 표시도 없이 그냥 저장하고 곧장 다음 행을 연다.
    if (editingTagsId !== null && editingTagsId !== rec.id) {
      saveTags(editingTagsId, tagsDraft);
    }
    tagsDraft = [...rec.tags];
    editingTagsId = rec.id;
  }
</script>

<div class="mx-auto max-w-6xl space-y-4 p-6 pb-40">
  <header class="flex items-baseline justify-between">
    <h1 class="h2">ULS Player</h1>
    <a href="/import" class="btn preset-filled">가져오기</a>
  </header>

  <FilterBar bind:filter {tags} total={recordings.length} shown={shown.length} />

  {#if errorMessage}
    <aside class="card preset-tonal-error p-4">{errorMessage}</aside>
  {/if}

  {#if selectedIds.size}
    <div class="card preset-tonal-primary flex flex-wrap items-center gap-3 p-3">
      <span class="shrink-0 text-sm">
        {selectedIds.size}개 선택됨
        {#if hiddenSelectedCount}
          <span class="text-surface-500">(현재 필터에 없는 {hiddenSelectedCount}개 포함)</span>
        {/if}
      </span>

      <!-- 252개 중 여러 행을 골라 태그를 한 번에 붙이는 게 이 화면의
           핵심 동선이라, 삭제보다 먼저·더 넓게 배치한다. -->
      <div class="flex grow flex-wrap items-center gap-2">
        <TagInput bind:tags={bulkTags} suggestions={tagNames} />
        <button type="button" class="btn btn-sm preset-filled"
          disabled={!bulkTags.length}
          onclick={() =>
            send({ op: 'addTags', ids: [...selectedIds], tags: bulkTags }).then((ok) => {
              if (ok) bulkTags = [];
            })}>
          태그 추가
        </button>
        <button type="button" class="btn btn-sm preset-tonal"
          disabled={!bulkTags.length}
          onclick={() =>
            send({ op: 'removeTags', ids: [...selectedIds], tags: bulkTags }).then((ok) => {
              if (ok) bulkTags = [];
            })}>
          태그 제거
        </button>
      </div>

      <button type="button" class="btn btn-sm preset-tonal"
        onclick={() =>
          send({ op: 'delete', ids: [...selectedIds] }).then((ok) => {
            if (ok) selectedIds = new Set();
          })}>
        목록에서 제거
      </button>
      <button type="button" class="btn btn-sm preset-tonal"
        onclick={() => (selectedIds = new Set())}>선택 해제</button>
    </div>
  {/if}

  <ul class="space-y-1">
    {#each shown as rec (rec.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- 행 아무 데나 눌러도 재생 대상으로 고른다(Task 15 시접, 스펙:
           "행을 클릭하면 하단 플레이어에 로드"). li 자체를 새 키보드
           타깃으로 만들 필요는 없다 — 제목이 이미 진짜 <button>이라
           Tab·Enter로도 같은 동작에 닿고, li에 role="button"은
           listitem이 가질 수 없는 role이라 줄 수도 없다. 그래서 li의
           클릭은 그 외 빈 영역(날짜·길이·포맷 배지)만을 위한 포인터
           전용 편의로 남긴다. 체크박스·본문 컬럼(제목/설명/태그와 그
           편집 컨트롤)은 각자 onclick에서 stopPropagation해 이 클릭이
           거기까지 번지지 않게 막는다. -->
      <li class="card hover:preset-tonal flex items-center gap-3 p-3"
        class:preset-tonal-primary={selectedId === rec.id}
        onclick={() => (selectedId = rec.id)}>
        <input type="checkbox" class="checkbox"
          checked={selectedIds.has(rec.id)}
          onchange={() => toggle(rec.id)}
          onclick={(e) => e.stopPropagation()} />

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- 이 컬럼 안의 클릭은 행 선택으로 안 번진다 — 제목은 자기
             onclick으로 이미 선택을 직접 처리하고(그래서 stopPropagation
             이후에도 그대로 동작), 설명·태그의 보기/편집 컨트롤은 선택과
             무관한 별개 동작이다. 이 div 자체를 새 상호작용 요소로 만드는
             게 아니라, 그 안의 실제 컨트롤(버튼·입력·TagInput)에게 이미
             있는 동작을 행 선택이 가리지 않게 전파만 끊는 것이다. -->
        <div class="flex min-w-0 grow flex-col gap-1" onclick={(e) => e.stopPropagation()}>
          {#if editingId === rec.id}
            <input class="input" value={rec.title}
              onblur={(e) => {
                send({ op: 'patch', id: rec.id, title: e.currentTarget.value }).then(
                  (ok) => {
                    if (ok) editingId = null;
                  }
                );
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
                send({ op: 'patch', id: rec.id, description: e.currentTarget.value }).then(
                  (ok) => {
                    if (ok) editingDescriptionId = null;
                  }
                );
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
