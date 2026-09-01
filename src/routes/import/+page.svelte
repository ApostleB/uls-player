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
  let bulkTags = $state<string[]>([]);
  let jobs = $state<JobItem[]>([]);
  let watching = $state(false);

  // 스캔 결과가 오면 편집 행을 만든다. 이미 등록된 항목은 기본 해제한다.
  $effect(() => {
    if (form && 'items' in form && form.items) {
      rows = (form.items as ScanItem[]).map((scan) => ({
        scan,
        selected: !scan.duplicate && scan.error === null,
        title: scan.title,
        description: '',
        tags: []
      }));
    }
  });

  const selected = $derived(rows.filter((r) => r.selected));

  function applyBulkTags() {
    for (const r of rows) {
      if (r.selected) r.tags = Array.from(new Set([...r.tags, ...bulkTags]));
    }
    bulkTags = [];
  }

  function payload(): string {
    return JSON.stringify(
      selected.map((r) => ({
        scan: r.scan,
        title: r.title,
        description: r.description,
        tags: r.tags
      }))
    );
  }

  function watchProgress() {
    if (watching) return;
    watching = true;
    const es = new EventSource('/api/jobs/events');
    es.onmessage = (e) => {
      jobs = JSON.parse(e.data) as JobItem[];
    };
  }

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
      <input type="hidden" name="payload" value={payload()} />
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
          <li class="flex items-center gap-3">
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
