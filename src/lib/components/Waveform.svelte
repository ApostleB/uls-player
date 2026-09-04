<script lang="ts">
  import type { Bookmark } from '$lib/types';
  import { barCount, bucketMax, formatTime, ratioFromClick } from '$lib/player';

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
    if (swallowNextClick) {
      swallowNextClick = false;
      return;
    }
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    onseek(ratioFromClick(e.clientX, r.left, r.width));
  }

  /**
   * 커서가 가리키는 위치(0~1). null이면 표시하지 않는다.
   *
   * 이 값은 progress와 별개다 — 드래그·호버 중에도 진행률 채움은
   * 움직이지 않는다(스크러빙 없음). 소리는 원래 위치에서 계속 나는데
   * 채움이 커서를 따라가면 소리와 화면이 어긋나 보인다.
   */
  let hoverRatio = $state<number | null>(null);

  function ratioFromPointer(e: { clientX: number }): number {
    if (!canvas) return 0;
    const r = canvas.getBoundingClientRect();
    return ratioFromClick(e.clientX, r.left, r.width);
  }

  /**
   * 3px보다 적게 움직이고 놓으면 드래그가 아니라 클릭이다. 마우스를
   * 누를 때 손이 1~2px 흔들리는 것은 정상이라, 0px을 기준으로 하면
   * 마커나 캔버스를 클릭하려던 사용자가 드래그 경로로 빠진다.
   */
  const DRAG_THRESHOLD_PX = 3;

  let pressX: number | null = null;
  let dragging = $state(false);
  /** 드래그로 점프한 직후 브라우저가 보내는 click을 한 번 무시한다. */
  let swallowNextClick = false;

  function onPointerDown(e: PointerEvent) {
    pressX = e.clientX;
    hoverRatio = ratioFromPointer(e);
    // 캔버스 밖으로 나가도 계속 따라간다 — 끝 근처를 노리다 살짝
    // 벗어나면 드래그가 조용히 죽는 쪽이 더 나쁘다.
    canvas?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    hoverRatio = ratioFromPointer(e);
    if (pressX !== null && Math.abs(e.clientX - pressX) >= DRAG_THRESHOLD_PX) dragging = true;
  }

  function onPointerUp(e: PointerEvent) {
    canvas?.releasePointerCapture(e.pointerId);
    // dragging만 보면 안 된다 — 캔버스 밖으로 빠르게 튕겨나가 pointerup
    // 전에 pointermove가 한 번도 안 오는 경우가 있다(이 함수가 받는
    // pointerup 자체가 그 판단의 마지막 기회다). 눌렀던 지점과 놓은
    // 지점의 최종 거리도 함께 임계값과 비교해, 중간 move가 없어도
    // 드래그로 잡는다.
    const wasDragging =
      dragging || (pressX !== null && Math.abs(e.clientX - pressX) >= DRAG_THRESHOLD_PX);
    const ratio = ratioFromPointer(e);
    pressX = null;
    dragging = false;

    // 움직임이 임계값 미만이면 아무것도 하지 않는다 — 뒤이어 오는
    // click이 기존 경로(캔버스 클릭 점프, 마커 클릭 점프)로 처리한다.
    if (!wasDragging) return;

    swallowNextClick = true;
    onseek(ratio);
  }

  function cancelDrag() {
    // 실제로 누르고 있던 상태였을 때만(pressX가 있을 때만) 뒤이어
    // 올 click을 삼킨다. Escape가 눌렸을 때 이미 놓여 있었다면(단순히
    // 캔버스에 포커스만 있던 경우) 삼킬 것이 없다 — 조건 없이 항상
    // 세우면, 그 뒤 아무 관련 없는 다음 클릭까지 먹어버릴 수 있다.
    //
    // Escape는 실제 브라우저에서 pointerup 뒤에도 click을 만든다 —
    // 캔버스가 pointerdown에서 잡은 포인터 캡처가 아직 살아있는 동안
    // (release는 이 함수가 아니라 onPointerUp에서 한다) 놓이므로,
    // 스펙(Pointer Events의 "pointer capture target override")에
    // 따라 release 위치가 캔버스 안이든 밖이든 뒤이은 click이 캔버스로
    // 다시 겨냥된다 — dragging·pressX를 지우는 것만으로는 onPointerUp이
    // 조용히 발을 뺄 뿐, 그 click까지 막지는 못해 결국 점프해버린다.
    const wasPressed = pressX !== null;
    pressX = null;
    dragging = false;
    hoverRatio = null;
    if (wasPressed) swallowNextClick = true;
  }

  function seekToBookmark(b: Bookmark) {
    if (!durationSec) return;
    onseek(Math.min(1, Math.max(0, b.atSec / durationSec)));
  }

  /**
   * Home/End만 여기서 처리한다 — ArrowLeft/ArrowRight는 일부러 손대지
   * 않는다. Player.svelte의 svelte:window keydown이 이미 화살표를
   * ±5초(Shift면 ±10초)로 처리하고 있고, keydown은 캔버스에서 window까지
   * 그대로 버블링된다(우리가 stopPropagation을 하지 않으므로). 여기서
   * 화살표까지 다시 처리하면 캔버스가 먼저 한 번 옮기고 나서 그 이벤트가
   * window까지 올라가 또 한 번 옮겨, 한 번 눌러도 두 번 움직이는
   * 사고(Fix Round 1에서 실제로 재현·확정)가 난다. Home/End는 그 전역
   * 핸들러에 대응하는 case가 아예 없어 이 위험이 없다.
   */
  function seekByKey(key: string): boolean {
    // 길이를 모르면 "끝"이 어디인지 알 수 없다 — 조용히 무시한다.
    if (!durationSec) return false;

    if (key === 'Home') onseek(0);
    else if (key === 'End') onseek(1);
    else return false;

    return true;
  }
</script>

<div class="relative">
  <canvas
    bind:this={canvas}
    class="block h-16 w-full cursor-pointer"
    style="--wf-played: var(--color-primary-500); --wf-rest: var(--color-surface-400);"
    onclick={seekAt}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointerleave={() => {
      if (!dragging) hoverRatio = null;
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        cancelDrag();
        return;
      }
      // Home/End가 페이지를 스크롤하지 않게 막는다 — 처리한 키만
      // (화살표는 일부러 여기서 처리하지 않으므로 그 preventDefault도
      // Player.svelte의 전역 핸들러 몫이다).
      if (seekByKey(e.key)) e.preventDefault();
    }}
    role="slider"
    tabindex="0"
    aria-label="재생 위치"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(progress * 100)}
  ></canvas>

  {#if hoverRatio !== null}
    <!-- 선과 말풍선 모두 포인터 이벤트를 받지 않는다 — 커서 바로 아래에
         있어서, 받으면 자기 자신이 캔버스의 pointermove를 가려 표시가
         깜빡인다. -->
    <div
      class="bg-surface-900-100 pointer-events-none absolute inset-y-0 w-px"
      style="left: {hoverRatio * 100}%"
    ></div>
    <!-- 좌우 끝에서 말풍선이 잘리지 않게 안쪽으로 민다. -->
    <div
      class="bg-surface-900-100 text-surface-100-900 pointer-events-none absolute -top-6 rounded px-1 text-xs tabular-nums"
      style="left: {hoverRatio * 100}%; transform: translateX({hoverRatio < 0.1
        ? '0'
        : hoverRatio > 0.9
          ? '-100%'
          : '-50%'})"
    >
      {formatTime(hoverRatio * durationSec)}
    </div>
  {/if}

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
