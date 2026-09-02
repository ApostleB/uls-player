<script lang="ts">
  import { enhance } from '$app/forms';
  import type { JobItem, ScanItem } from '$lib/types';
  import TagInput from '$lib/components/TagInput.svelte';

  let { data, form } = $props();

  interface Row {
    scan: ScanItem;
    selected: boolean;
    title: string;
    description: string;
    tags: string[];
  }

  let rows = $state<Row[]>([]);
  let folder = $state('');
  let bulkTags = $state<string[]>([]);
  let jobs = $state<JobItem[]>([]);
  let watching = $state(false);

  // 스캔 결과가 오면 편집 행을 만든다. 이미 등록된 항목은 기본 해제한다.
  // folder도 함께 기억해둔다 — enqueue가 서버에서 재스캔할 때 지금 이
  // rows를 만들어낸 바로 그 폴더를 다시 읽어야 sourceName이 맞아떨어진다.
  // (사용자가 스캔 이후 위 입력창 텍스트를 다시 고쳐도 이 값은 안 바뀐다.)
  $effect(() => {
    if (form && 'items' in form && form.items) {
      rows = (form.items as ScanItem[]).map((scan) => ({
        scan,
        selected: !scan.duplicate && scan.error === null,
        title: scan.title,
        description: '',
        tags: []
      }));
      folder = (form as { folder?: string }).folder ?? folder;
    }
  });

  const selected = $derived(rows.filter((r) => r.selected));

  function applyBulkTags() {
    for (const r of rows) {
      if (r.selected) r.tags = Array.from(new Set([...r.tags, ...bulkTags]));
    }
    bulkTags = [];
  }

  // 서버가 신뢰하는 sourcePath 등은 보내지 않는다 — 서버가 folder를 다시
  // 스캔해서 자기 자신의 ScanItem으로 잡을 만든다. 여기서 보내는 건
  // 사용자가 편집한 필드(제목·설명·태그)와, 어느 파일인지 지목하는
  // sourceName뿐이다.
  function itemsPayload(): string {
    return JSON.stringify(
      selected.map((r) => ({
        sourceName: r.scan.sourceName,
        title: r.title,
        description: r.description,
        tags: r.tags
      }))
    );
  }

  // 컴포넌트 생명주기 밖의 평범한 변수다 — $state로 두면 안의 값(연결
  // 객체)이 바뀔 때마다 여기 의존하는 이펙트가 다시 도는 게 아니라, 그냥
  // "지금 열려 있는 연결이 있는지"를 쥐고 있다가 정리할 때만 쓰는 손잡이다.
  let es: EventSource | null = null;

  function closeStream() {
    es?.close();
    es = null;
    // 닫힌 뒤에는 다시 열 수 있어야 한다 — 그러지 않으면 같은 화면에서
    // 두 번째로 저장했을 때(예: 다른 행을 골라 다시 저장) 진행률을 다시는
    // 받지 못한 채로 남는다. watching은 "지금 열린 연결이 있는가"를
    // 지키는 가드지, "이 화면에서 평생 한 번만"이 아니다 — 그래서 열려
    // 있는 동안에는 절대 두 번째 연결이 생기지 않으면서도, 닫힌 뒤에는
    // 다음 저장이 새 연결을 열 수 있다.
    watching = false;
  }

  function watchProgress() {
    if (watching) return;
    watching = true;

    // 두 번째 이후 저장에서 실제로 겪은 경쟁 조건: 이 연결을 여는 시점엔
    // 이전 배치의 잡들이 이미 전부 done인 채로 큐에 남아 있다(큐는 잡을
    // 절대 지우지 않는다). enqueue POST는 서버에서 폴더를 다시 스캔한
        // 뒤에야 새 잡을 큐에 넣으므로 그보다 늦게 도착하는데, SSE는 열자마자
    // 그 "옛 잡만 있는" 스냅샷을 첫 프레임으로 즉시 받는다. 그 첫 프레임만
    // 보고 "전부 done"이라고 판단해 곧장 닫아버리면, 방금 요청한 새 잡이
    // 큐에 들어오기도 전에 연결이 끊겨 진행률을 영영 못 받는다. 그래서
    // "이번 배치의 새 잡이 실제로 큐에 나타난 뒤"부터만 완료 판정을 시작한다
    // — 지금 알고 있는 잡 개수보다 늘어난 걸 본 뒤에야 every(done/failed)를
    // 완료 신호로 받아들인다.
    const baselineCount = jobs.length;
    let sawNewJob = false;

    es = new EventSource('/api/jobs/events');
    es.onmessage = (e) => {
      jobs = JSON.parse(e.data) as JobItem[];
      if (!sawNewJob && jobs.length > baselineCount) sawNewJob = true;
      // 잡이 하나도 없는 첫 프레임(빈 배열)에서 매치해버리면 안 되므로
      // length 체크를 먼저 둔다 — every()는 빈 배열에 대해 항상 true다.
      if (sawNewJob && jobs.length && jobs.every((j) => j.status === 'done' || j.status === 'failed')) {
        closeStream();
      }
    };
  }

  // 탭을 닫거나 다른 페이지로 이동해 컴포넌트가 파괴될 때도 연결을 정리한다.
  // 그러지 않으면 이 화면을 여러 번 드나들 때마다 서버 쪽 구독자와 15초
  // 하트비트 타이머가 계속 쌓인다.
  $effect(() => {
    return () => es?.close();
  });

  const doneCount = $derived(jobs.filter((j) => j.status === 'done').length);
  const failedCount = $derived(jobs.filter((j) => j.status === 'failed').length);

  function fmtDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
</script>

<div class="mx-auto max-w-6xl space-y-6 p-6">
  <header class="flex items-baseline justify-between">
    <h1 class="h2">가져오기</h1>
    <a href="/" class="anchor">목록으로</a>
  </header>

  <form method="POST" action="?/scan" use:enhance class="flex gap-2">
    <input
      name="folder"
      class="input"
      placeholder="/Volumes/Storage/voice"
      required
    />
    <button type="submit" class="btn preset-filled">스캔</button>
  </form>

  {#if form && 'message' in form}
    <aside class="card preset-tonal-error p-4">{form.message}</aside>
  {/if}

  {#if form && 'skipped' in form && form.skipped}
    <aside class="card preset-tonal-warning p-4">
      {form.skipped}개 항목은 다시 스캔한 결과와 맞지 않아 건너뛰었습니다
      (파일이 삭제·이름변경되었거나 그 사이 이미 등록됨).
    </aside>
  {/if}

  {#if rows.length}
    <div class="card preset-tonal p-4">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm">{selected.length}개 선택됨 / 전체 {rows.length}개</span>
        <button type="button" class="btn btn-sm preset-tonal"
          onclick={() => rows.forEach((r) => (r.selected = r.scan.error === null))}>전체 선택</button>
        <button type="button" class="btn btn-sm preset-tonal"
          onclick={() => rows.forEach((r) => (r.selected = false))}>전체 해제</button>
        <div class="grow">
          <TagInput bind:tags={bulkTags} suggestions={data.tags} placeholder="선택 항목에 붙일 태그" />
        </div>
        <button type="button" class="btn btn-sm preset-filled"
          disabled={!bulkTags.length || !selected.length}
          onclick={applyBulkTags}>선택 항목에 태그 적용</button>
      </div>
    </div>

    <div class="table-wrap overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th></th>
            <th>제목</th>
            <th>설명</th>
            <th>태그</th>
            <th>녹음시각</th>
            <th>길이</th>
            <th>원본</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.scan.sourceName)}
            <tr class:opacity-50={row.scan.error !== null}>
              <td>
                <input type="checkbox" class="checkbox"
                  bind:checked={row.selected} disabled={row.scan.error !== null} />
              </td>
              <td class="min-w-48">
                <input class="input" bind:value={row.title} disabled={row.scan.error !== null} />
                {#if row.scan.duplicate}
                  <span class="badge preset-tonal-warning mt-1">이미 있음</span>
                {/if}
                {#if row.scan.error}
                  <span class="badge preset-tonal-error mt-1">읽을 수 없음</span>
                {/if}
              </td>
              <td class="min-w-48">
                <input class="input" bind:value={row.description} disabled={row.scan.error !== null} />
              </td>
              <td class="min-w-56">
                <TagInput bind:tags={row.tags} suggestions={data.tags} />
              </td>
              <td class="whitespace-nowrap text-sm tabular-nums">
                {row.scan.recordedAt.replace('T', ' ').slice(0, 16)}
              </td>
              <td class="tabular-nums">{fmtDuration(row.scan.durationSec)}</td>
              <td class="uppercase">{row.scan.ext}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <form method="POST" action="?/enqueue"
      use:enhance={() => {
        watchProgress();
        return async ({ update }) => update({ reset: false });
      }}>
      <input type="hidden" name="folder" value={folder} />
      <input type="hidden" name="items" value={itemsPayload()} />
      <button type="submit" class="btn preset-filled-primary-500" disabled={!selected.length}>
        {selected.length}개 저장 및 변환
      </button>
    </form>
  {/if}

  {#if jobs.length}
    <section class="card p-4">
      <h2 class="h4 mb-2">
        변환 진행 — 완료 {doneCount} / {jobs.length}
        {#if failedCount}<span class="text-error-500">· 실패 {failedCount}</span>{/if}
      </h2>
      <ul class="space-y-1 text-sm">
        {#each jobs as job (job.id)}
          <li class="flex flex-col gap-0.5">
            <div class="flex items-center gap-3">
              <span class="w-20 shrink-0">
                {#if job.status === 'done'}<span class="badge preset-tonal-success">완료</span>
                {:else if job.status === 'running'}<span class="badge preset-tonal-primary">변환중</span>
                {:else if job.status === 'failed'}<span class="badge preset-tonal-error">실패</span>
                {:else}<span class="badge preset-tonal">대기</span>{/if}
              </span>
              <span class="grow truncate">{job.title}</span>
              <span class="text-surface-500 shrink-0 font-mono text-xs">
                {Object.entries(job.formats).map(([k, v]) => `${k}:${v}`).join(' ')}
              </span>
            </div>
            {#if job.status === 'failed' && job.error}
              <p class="text-error-500 pl-[5.75rem] text-xs">{job.error}</p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if failedCount}
        <button type="button" class="btn btn-sm preset-tonal mt-3"
          onclick={() => fetch('/api/jobs/retry', { method: 'POST' })}>
          실패한 {failedCount}개 재시도
        </button>
      {/if}
    </section>
  {/if}
</div>
