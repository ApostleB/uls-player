<script lang="ts">
  import { untrack } from 'svelte';
  import type { Bookmark, Recording } from '$lib/types';
  import Waveform from './Waveform.svelte';
  import { isTypingTarget, loopWrapTarget, markLoop as nextLoop, restorePlaybackPosition } from '$lib/player';
  import type { LoopState } from '$lib/player';

  let {
    recording = null as Recording | null,
    formats = [] as string[],
    onbookmark = (_: Omit<Bookmark, 'id'>) => {}
  } = $props();

  let audio = $state<HTMLAudioElement | null>(null);
  let format = $state('mp3');
  let playing = $state(false);
  let current = $state(0);
  let volume = $state(1);
  let muted = $state(false);
  let rate = $state(1);
  let peaks = $state<number[]>([]);
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);

  const available = $derived(recording ? formats.filter((f) => recording.files[f]) : []);
  const duration = $derived(recording?.durationSec ?? 0);
  const progress = $derived(duration ? current / duration : 0);

  const src = $derived(
    recording && recording.files[format] ? `/api/media/${recording.id}/${format}` : ''
  );

  /**
   * 녹음이 "바뀌었을" 때만 파형을 새로 받고 재생 위치·A-B 루프를 리셋한다.
   * 여기서 recording 객체 전체가 아니라 recording?.id만 추적한다 — 목록
   * 화면의 recordings 배열은 관련 없는 행을 patch할 때마다 통째로 새
   * 참조로 교체되고(send()가 전체 목록을 다시 받아 덮어쓴다), 그러면
   * selected/recording도 같은 id를 가진 새 객체가 되어 이 이펙트가 다시
   * 돈다. $effect는 "읽은 값이 실제로 달라졌는지"가 아니라 "추적하던
   * 시그널이 갱신됐는지"로 재실행 여부를 정하므로, recording?.id를
   * 읽는 것만으로는 재실행 자체를 막지 못한다(recording 참조가 바뀌면
   * id 문자열이 같아도 다시 돈다) — 그래서 이전에 본 id를 일반
   * 변수(lastId, 반응형 아님)에 직접 기억해두고 실제로 바뀐 경우에만
   * 아래 리셋 로직을 태운다. 이걸 빼먹으면 재생 중 다른 행의 태그만
   * 고쳐도 현재 위치가 0으로 튀고 방금 잡아둔 A-B 구간이 조용히
   * 사라진다 — switchFormat이 지키려는 것과 정확히 같은 문제를 다른
   * 경로로 깨뜨리는 셈이다. format·available 읽기는 untrack으로 감싸,
   * switchFormat이 format을 바꿔도 이 이펙트가 재실행되지 않게 한다.
   */
  let lastId: string | null = null;
  $effect(() => {
    const id = recording?.id ?? null;
    if (id === lastId) return;
    lastId = id;

    if (!id) {
      peaks = [];
      return;
    }

    untrack(() => {
      const rec = recording!;
      if (!rec.files[format]) format = available[0] ?? 'original';
      current = 0;
      loopA = loopB = null;
    });

    fetch(`/api/waveform/${id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((p: number[]) => {
        // 응답이 오는 사이 다른 행으로 옮겨갔으면 지금 보이는 녹음의
        // 파형을 옛 응답으로 덮어쓰지 않는다.
        if (recording?.id === id) peaks = p;
      })
      .catch(() => {
        if (recording?.id === id) peaks = [];
      });
  });

  /**
   * 포맷을 바꿔도 재생 위치를 유지한다.
   * 같은 녹음을 mp3와 wav로 비교해 들으려면 이게 없으면 안 된다.
   */
  function switchFormat(next: string) {
    const at = audio?.currentTime ?? 0;
    const wasPlaying = playing;
    format = next;
    queueMicrotask(() => {
      if (!audio) return;
      restorePlaybackPosition(audio, at, wasPlaying);
    });
  }

  function toggle() {
    if (!audio) return;
    playing ? audio.pause() : void audio.play();
  }

  function seek(sec: number) {
    if (audio) audio.currentTime = Math.min(duration, Math.max(0, sec));
  }

  function nudge(delta: number) {
    seek((audio?.currentTime ?? 0) + delta);
  }

  function onTimeUpdate() {
    if (!audio) return;
    current = audio.currentTime;
    // A-B 구간 반복. 저장되지 않는 일시적 재생 상태다.
    const wrap = loopWrapTarget(current, { loopA, loopB });
    if (wrap !== null) audio.currentTime = wrap;
  }

  function markLoop() {
    const t = audio?.currentTime ?? 0;
    const next: LoopState = nextLoop({ loopA, loopB }, t);
    loopA = next.loopA;
    loopB = next.loopB;
  }

  function addBookmark() {
    if (!recording) return;
    onbookmark({ atSec: audio?.currentTime ?? 0, endSec: null, note: '' });
  }

  function onKeydown(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;
    if (!recording) return;

    switch (e.key) {
      case ' ': e.preventDefault(); toggle(); break;
      case 'ArrowLeft': e.preventDefault(); nudge(e.shiftKey ? -10 : -5); break;
      case 'ArrowRight': e.preventDefault(); nudge(e.shiftKey ? 10 : 5); break;
      case 'ArrowUp': e.preventDefault(); volume = Math.min(1, volume + 0.05); break;
      case 'ArrowDown': e.preventDefault(); volume = Math.max(0, volume - 0.05); break;
      case 'm': case 'M': muted = !muted; break;
      case 'b': case 'B': addBookmark(); break;
    }
  }

  function fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if recording}
  <div class="bg-surface-100-900 border-surface-200-800 fixed inset-x-0 bottom-0 border-t p-3">
    <audio
      bind:this={audio}
      {src}
      bind:volume
      bind:muted
      bind:playbackRate={rate}
      onplay={() => (playing = true)}
      onpause={() => (playing = false)}
      ontimeupdate={onTimeUpdate}
    ></audio>

    <div class="mx-auto max-w-6xl space-y-2">
      <div class="flex items-baseline gap-3">
        <strong class="truncate">{recording.title}</strong>
        <span class="text-surface-500 shrink-0 text-sm tabular-nums">
          {fmt(current)} / {fmt(duration)}
        </span>
        {#if loopA !== null}
          <span class="badge preset-tonal-tertiary shrink-0">
            A-B {fmt(loopA)}{loopB !== null ? `–${fmt(loopB)}` : '…'}
          </span>
        {/if}
      </div>

      <Waveform {peaks} {progress} bookmarks={recording.bookmarks} durationSec={duration}
        onseek={(r: number) => seek(r * duration)} />

      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn btn-sm preset-tonal" onclick={() => nudge(-10)}>−10초</button>
        <button type="button" class="btn btn-sm preset-tonal" onclick={() => nudge(-5)}>−5초</button>
        <button type="button" class="btn preset-filled-primary-500" onclick={toggle}>
          {playing ? '일시정지' : '재생'}
        </button>
        <button type="button" class="btn btn-sm preset-tonal" onclick={() => nudge(5)}>+5초</button>
        <button type="button" class="btn btn-sm preset-tonal" onclick={() => nudge(10)}>+10초</button>

        <button type="button" class="btn btn-sm preset-tonal" onclick={markLoop}>
          {loopA === null ? 'A 지정' : loopB === null ? 'B 지정' : '구간 해제'}
        </button>
        <button type="button" class="btn btn-sm preset-tonal" onclick={addBookmark}>북마크</button>

        <label class="flex items-center gap-1 text-sm">
          <button type="button" class="btn btn-sm preset-tonal" onclick={() => (muted = !muted)}>
            {muted ? '음소거 해제' : '음소거'}
          </button>
          <input type="range" min="0" max="1" step="0.01" bind:value={volume} class="w-24" />
        </label>

        <label class="flex items-center gap-1 text-sm">
          배속
          <select class="select select-sm" bind:value={rate}>
            {#each [0.5, 0.75, 1, 1.25, 1.5, 2] as r (r)}<option value={r}>{r}×</option>{/each}
          </select>
        </label>

        <!-- 스펙 8.3 "포맷" 항목: 전환(재생 위치 유지)과 포맷별 다운로드는
             별개 동작이다 — 전환은 재생 중인 포맷을 바꾸고, 다운로드는
             재생 포맷을 바꾸지 않고도 그 포맷 파일을 그대로 받을 수
             있어야 한다. 그래서 각 포맷마다 전환 버튼과 다운로드 링크를
             따로 둔다. -->
        <div class="ml-auto flex flex-wrap items-center gap-1">
          {#each available as f (f)}
            <div class="flex items-center overflow-hidden rounded">
              <button type="button"
                class="btn btn-sm {format === f ? 'preset-filled' : 'preset-tonal'}"
                onclick={() => switchFormat(f)}>
                {f === 'original' ? (recording.files.original.ext ?? '원본') : f}
              </button>
              <a class="btn btn-sm preset-tonal" href="/api/media/{recording.id}/{f}" download
                aria-label="{f} 다운로드">
                ↓
              </a>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
