<script lang="ts">
  import type { Bookmark } from '$lib/types';
  import { barCount, bucketMax, ratioFromClick } from '$lib/player';

  let {
    peaks = [] as number[],
    progress = 0,
    bookmarks = [] as Bookmark[],
    durationSec = 0,
    onseek = (_: number) => {}
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);

  function draw() {
    if (!canvas || !peaks.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(canvas);
    const played = styles.getPropertyValue('--wf-played').trim() || '#c4562b';
    const rest = styles.getPropertyValue('--wf-rest').trim() || '#9aa4ad';

    const bw = 2;
    const gap = 1;
    const bars = barCount(w, bw, gap);
    const mid = h / 2;

    for (let i = 0; i < bars; i++) {
      const m = bucketMax(peaks, bars, i);
      const barH = Math.max(1, m * (h - 2));
      ctx.fillStyle = i / bars <= progress ? played : rest;
      ctx.fillRect(i * (bw + gap), mid - barH / 2, bw, barH);
    }
  }

  $effect(() => {
    // peaks와 progress가 바뀔 때마다 다시 그린다
    void peaks;
    void progress;
    draw();
  });

  // 창 크기가 바뀌면 캔버스의 실제 픽셀 크기(clientWidth 기준)가 달라지므로
  // 다시 그려야 막대가 늘어지거나 잘리지 않는다.
  $effect(() => {
    const on = () => draw();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  });

  // 라이트/다크 전환은 --wf-played·--wf-rest가 가리키는 Skeleton 토큰
  // 값을 바꾼다. getComputedStyle은 draw() 호출 시점에만 값을 읽으므로,
  // peaks·progress가 그대로인 채로 테마만 바뀌면 다시 불러주지 않는 한
  // 이전 색이 캔버스에 그대로 남는다.
  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => draw();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  function seekAt(e: MouseEvent) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    onseek(ratioFromClick(e.clientX, r.left, r.width));
  }

  function seekToBookmark(b: Bookmark) {
    if (!durationSec) return;
    onseek(Math.min(1, Math.max(0, b.atSec / durationSec)));
  }
</script>

<div class="relative">
  <canvas
    bind:this={canvas}
    class="block h-16 w-full cursor-pointer"
    style="--wf-played: var(--color-primary-500); --wf-rest: var(--color-surface-400);"
    onclick={seekAt}
    role="slider"
    tabindex="0"
    aria-label="재생 위치"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(progress * 100)}
  ></canvas>

  {#if !peaks.length}
    <!-- 파형이 아직 생성되지 않았을 때(waveform API 404)도 최소한의
         시크바 역할은 하도록 진행률 막대만 표시한다. 클릭은 캔버스가
         그대로 받으므로 점프 자체는 파형 유무와 무관하게 동작한다. -->
    <div
      class="bg-surface-200-800 pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full"
    >
      <div class="bg-primary-500 h-full rounded-full" style="width: {progress * 100}%"></div>
    </div>
  {/if}

  {#each bookmarks as b (b.id)}
    <!-- 클릭하면 그 지점으로 점프한다(스펙 8.3: "마커 클릭 시 점프"). 캔버스
         위에 겹쳐 있으므로 클릭이 아래 캔버스로 새지 않게 stopPropagation. -->
    <button
      type="button"
      class="bg-tertiary-500 absolute top-0 h-2 w-2 -translate-x-1/2 cursor-pointer rounded-full border-0 p-0"
      style="left: {durationSec ? (b.atSec / durationSec) * 100 : 0}%"
      title={b.note || undefined}
      aria-label="북마크: {b.note || '메모 없음'}"
      onclick={(e) => {
        e.stopPropagation();
        seekToBookmark(b);
      }}
    ></button>
  {/each}
</div>
