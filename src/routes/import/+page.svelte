<script lang="ts">
  import { onMount } from 'svelte';
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
  // Must Fix 2: 저장 요청이 서버 응답을 받을 때까지 저장 버튼을 비활성화한다.
  // 변환은 수 분 걸릴 수 있는데, 그 사이 버튼이 계속 눌려 있으면(더블
  // 클릭·연타) 서버가 매번 재스캔해서 duplicate:false로 보고할 여지가
  // 생긴다 — 서버도 in-flight 여부를 확인하지만(+page.server.ts), 이건
  // 그 앞단에서 가장 흔한 경로(같은 버튼을 두 번 누름) 자체를 막는다.
  let submitting = $state(false);
  // Must Fix 3: 재시도(fetch('/api/jobs/retry'))가 실패했을 때 보여줄
  // 메시지. form.message(폼 액션 실패)와는 별도 채널이다 — 재시도는 폼
  // 액션이 아니라 순수 fetch라 SvelteKit의 form 결과에 실리지 않는다.
  let retryError = $state<string | null>(null);

  /**
   * 파일 업로드가 서버 응답을 기다리는 중인지. 이게 없으면 화면이 멈춘
   * 것처럼 보인다 — 업로드 폼은 파일을 고르는 순간 자동 제출되는데(아래
   * input의 onchange), 원본 수백 개를 올리면 응답까지 수 분이 걸리는
   * 동안 어떤 표시도 나오지 않았다. 실사용에서 사용자가 "다음 동작
   * 진행 불가"로 판단하고 다시 누르는 일이 실제로 벌어졌고, 그러면 같은
   * 전송이 두 번 나간다 — 재생 버튼에 로딩 표시가 없어서 겪었던 것과
   * 같은 부류의 문제다.
   */
  let uploading = $state(false);

  // 업로드 드롭 영역. dragging은 순전히 시각 효과(테두리 강조)용이고,
  // 실제 제출은 fileInput.files를 채운 뒤 requestSubmit으로 한다 —
  // input[type=file] 자체가 드롭 대상이어도 되지만, 클릭 영역과 드롭
  // 영역을 하나로 넓히려고 바깥 label/div에서 드롭을 받는다.
  let fileInput = $state<HTMLInputElement | undefined>();
  let dragging = $state(false);

  function submitFiles(files: FileList) {
    if (!fileInput) return;
    fileInput.files = files;
    fileInput.form?.requestSubmit();
  }

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

    // 이 연결의 첫 프레임(들)이 "지금 이 연결이 신경 쓸 일과 무관한,
    // 이미 끝나 있던 이전 상태"일 수 있는 경우가 두 가지 있다:
    //   1) 두 번째 이후 저장: 이 연결을 여는 시점엔 이전 배치의 잡들이
    //      이미 전부 done인 채로 큐에 남아 있다(큐는 잡을 절대 지우지
    //      않는다). enqueue POST는 서버에서 폴더를 다시 스캔한 뒤에야
    //      새 잡을 큐에 넣으므로 그보다 늦게 도착하는데, SSE는 열자마자
    //      그 "옛 잡만 있는" 스냅샷을 첫 프레임으로 즉시 받는다.
    //   2) 재시도: retryFailed()는 새 id를 만들지 않고 기존 실패 잡의
    //      상태만 되돌린다 — 그래서 "잡 개수가 늘었는가"로는 재시도를
    //      감지할 수 없다.
    // 두 경우 모두 첫 프레임만 보고 "전부 done/failed"라고 판단해 곧장
    // 닫아버리면, 실제로 진행 중이거나 막 다시 시작된 작업의 진행률을
    // 영영 못 받는다. 그래서 "이 연결이 실제로 진행 중인(pending·running)
    // 잡을 한 번이라도 본 뒤"부터만 완료 판정을 시작한다 — armed가 그
    // 신호다. 잡 상태 전이는 큐 쪽에서 항상 pending/running을 거쳐야만
    // done/failed에 도달하므로(queue.ts의 enqueue·retryFailed·runOne),
    // 아무리 빨리 끝나도 이 연결이 그 중간 상태를 프레임으로 놓치는 일은
    // 없다 — SSE는 순서가 보장되는 스트림이라 done 프레임보다 먼저
    // 도착한다.
    let armed = false;

    es = new EventSource('/api/jobs/events');
    es.onmessage = (e) => {
      jobs = JSON.parse(e.data) as JobItem[];
      if (!armed && jobs.some((j) => j.status === 'pending' || j.status === 'running')) {
        armed = true;
      }
      // 잡이 하나도 없는 첫 프레임(빈 배열)에서 매치해버리면 안 되므로
      // length 체크를 먼저 둔다 — every()는 빈 배열에 대해 항상 true다.
      if (armed && jobs.length && jobs.every((j) => j.status === 'done' || j.status === 'failed')) {
        closeStream();
      }
    };
  }

  // Must Fix 3: 마운트 시점(최초 진입이든 새로고침이든)에 스트림을 즉시
  // 연다. 예전에는 저장(enqueue) 시에만 watchProgress()를 불렀으므로,
  // 진행 패널은 (a) 새로고침하면 통째로 사라졌고(load가 잡을 돌려주지
  // 않으므로 서버가 이미 알고 있는 진행 상황을 화면이 다시 볼 방법이
  // 없었다), (b) 재시도로 스트림이 다시 열리지 않아 실패 후 재시도가
  // 성공해도 화면이 실패 스냅샷에 멈춰 있었다. 마운트 시 여는 이 연결이
  // 첫 프레임으로 큐의 현재 스냅샷을 그대로 받으므로(events 엔드포인트가
  // 구독 전에 snapshot()을 먼저 보낸다), 재시작 복구로 이어서 돌고 있는
  // 작업도 그대로 보인다.
  //
  // onMount를 쓰는 이유: watchProgress가 `watching`($state)을 읽으므로,
  // 이걸 $effect 안에서 직접 부르면 그 읽기 때문에 effect가 watching에
  // 의존하게 된다 — 스트림이 닫혀 watching이 false가 될 때마다 effect가
  // 다시 돌면서 watchProgress()를 또 불러 즉시 재연결하는 루프가 생긴다
  // (의도한 "완료되면 연결을 정리한다"가 무력화된다). onMount는 마운트
  // 시 한 번만 실행되고 반응형 의존성을 추적하지 않으므로 이 문제가
  // 없다. 정리(unmount 시 연결 닫기)도 여기서 반환하는 함수로 처리한다 —
  // 탭을 닫거나 다른 페이지로 이동해 컴포넌트가 파괴될 때 연결을 안
  // 닫으면, 이 화면을 여러 번 드나들 때마다 서버 쪽 구독자와 15초
  // 하트비트 타이머가 계속 쌓인다.
  onMount(() => {
    watchProgress();
    return () => es?.close();
  });

  // Must Fix 3: 재시도 버튼이 부르는 함수. 예전에는 onclick={() =>
  // fetch(...)}로 응답을 아예 확인하지 않았다 — 요청이 실패해도(네트워크
  // 오류·서버 오류) 사용자는 아무 신호도 못 받았고, 큐가 실제로 재시작을
  // 받아들여도 스트림이 이미 닫혀 있으면(모든 잡이 failed가 된 뒤라면
  // watchProgress의 armed && every(...) 판정이 닫는다) 화면이 실패
  // 스냅샷에 영원히 멈춰 있었다.
  async function retry(): Promise<void> {
    retryError = null;
    // POST보다 먼저 연다 — 이미 열려 있으면(watching) no-op이라 안전하고,
    // 닫혀 있었다면 응답이 오기 전에 미리 구독해둬서 재시작된 진행
    // 상황을 놓치지 않는다.
    watchProgress();
    try {
      const res = await fetch('/api/jobs/retry', { method: 'POST' });
      if (!res.ok) {
        retryError = `재시도 요청이 실패했습니다 (서버 응답 ${res.status}). 잠시 후 다시 시도하세요.`;
      }
    } catch (err) {
      retryError = `재시도 요청을 보낼 수 없습니다: ${(err as Error).message}`;
    }
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
  </header>

  <form method="POST" action="?/scan" use:enhance class="flex gap-2">
    <!-- 이 스캔은 서버가 자기 파일시스템의 폴더를 읽는다. placeholder에
         macOS 경로(/Volumes/…)를 박아두면, 서버에 배포해 쓸 때 사용자가
         자기 노트북 경로를 넣고 ENOENT를 보게 된다 — 실제로 그렇게
         헤맸다. 브라우저에서 올릴 때는 아래 업로드 영역을 쓴다. -->
    <input
      name="folder"
      class="input"
      aria-label="스캔할 서버 폴더 경로"
      placeholder="서버에 있는 폴더 경로 (내 컴퓨터의 파일은 아래에서 올립니다)"
      required
    />
    <button type="submit" class="btn preset-filled">스캔</button>
  </form>

  <form
    method="POST"
    action="?/upload"
    enctype="multipart/form-data"
    use:enhance={() => {
      uploading = true;
      return async ({ update }) => {
        await update();
        uploading = false;
      };
    }}
    class="card preset-tonal p-4 border-2 border-dashed transition-colors"
    class:border-primary-500={dragging}
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={(e) => {
      e.preventDefault();
      dragging = false;
      if (e.dataTransfer?.files.length) submitFiles(e.dataTransfer.files);
    }}
  >
    <label class="flex flex-col gap-2">
      <span class="text-sm">
        또는 파일을 여기로 끌어다 놓거나 클릭해서 올립니다
        (CloudRecordings.db를 함께 올리면 제목이 복원됩니다)
      </span>
      <input
        bind:this={fileInput}
        type="file"
        name="files"
        class="input"
        multiple
        disabled={uploading}
        accept="audio/*,.qta,.m4a,.caf,.db,.db-wal,.db-shm"
        onchange={(e) => e.currentTarget.form?.requestSubmit()}
      />

      <!-- 전송이 끝날 때까지 이 줄이 자리를 지킨다. 브라우저의 네이티브
           폼 전송이라 진행률(몇 %)까지는 알 수 없지만, "지금 올라가는
           중"이라는 사실만이라도 보이면 사용자가 멈춘 줄 알고 다시
           누르는 일은 막을 수 있다 — 다시 누르면 같은 전송이 두 번 간다. -->
      {#if uploading}
        <span class="text-surface-500 text-sm" role="status">
          올리는 중입니다. 파일이 크면 몇 분 걸릴 수 있으니 이 화면을 닫지 마세요.
        </span>
      {/if}
    </label>
  </form>

  <!-- 업로드가 진행 중이면 지난 응답의 메시지를 감춘다. 그러지 않으면
       직전 스캔 실패 같은 옛 오류가 화면에 남아, 방금 시작한 업로드가
       실패한 것처럼 읽힌다(실사용에서 실제로 그렇게 오해했다). -->
  {#if form && 'message' in form && !uploading}
    <aside class="card preset-tonal-error p-4">{form.message}</aside>
  {/if}

  {#if form && 'skipped' in form && form.skipped}
    <aside class="card preset-tonal-warning p-4">
      {form.skipped}개 항목은 다시 스캔한 결과와 맞지 않아 건너뛰었습니다
      (파일이 삭제·이름변경되었거나, 이미 등록됐거나, 지금 변환 중입니다).
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
        submitting = true;
        watchProgress();
        return async ({ update }) => {
          try {
            await update({ reset: false });
          } finally {
            submitting = false;
          }
        };
      }}>
      <input type="hidden" name="folder" value={folder} />
      <input type="hidden" name="items" value={itemsPayload()} />
      <button type="submit" class="btn preset-filled-primary-500" disabled={submitting || !selected.length}>
        {selected.length}개 저장 및 변환
      </button>
    </form>
  {/if}

  {#if retryError}
    <aside class="card preset-tonal-error p-4">{retryError}</aside>
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
        <button type="button" class="btn btn-sm preset-tonal mt-3" onclick={retry}>
          실패한 {failedCount}개 재시도
        </button>
      {/if}
    </section>
  {/if}
</div>
