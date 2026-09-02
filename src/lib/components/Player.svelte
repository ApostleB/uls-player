<script lang="ts">
  import { untrack } from 'svelte';
  import type { Bookmark, Recording } from '$lib/types';
  import Waveform from './Waveform.svelte';
  import {
    isTypingTarget,
    loopWrapTarget,
    markLoop as nextLoop,
    restorePlaybackPosition,
    bookmarkDraft,
    sortBookmarks,
    withBookmarkNote,
    withoutBookmark
  } from '$lib/player';
  import type { LoopState } from '$lib/player';

  let {
    recording = null as Recording | null,
    formats = [] as string[],
    onbookmark = (_: Omit<Bookmark, 'id'>) => {},
    // 성공하면 true(또는 true로 resolve하는 Promise)를 돌려줘야 한다 —
    // 실패(false)를 받으면 아래 목록이 낙관적으로 반영해둔 편집을
    // 되돌린다. 기본값(prop 미전달)은 "성공했다고 간주"해 아무것도
    // 되돌리지 않는다(기존 no-op과 동일한 무해한 기본 동작).
    onbookmarkchange = (_: Bookmark[]): boolean | Promise<boolean> => true
  } = $props();

  let audio = $state<HTMLAudioElement | null>(null);
  let format = $state('mp3');
  /**
   * <audio>의 paused와 양방향 바인딩한다(직접 playing 플래그를 관리하지
   * 않는다). 재생 중 다른 녹음으로 넘어가면(src 재할당) HTML 미디어
   * 스펙의 로드 알고리즘 abort 단계가 pause 이벤트 없이 paused를 그냥
   * true로 되돌린다 — onplay/onpause만으로 playing을 관리하면 그 경우
   * 토글 버튼이 "일시정지"에 박제된 채 다시는 안 바뀐다(버튼을 눌러도
   * 이미 paused인 엘리먼트에 pause()를 또 호출하는 것뿐이라 아무 일도
   * 안 생긴다). bind:paused는 play/pause 이벤트 말고 canplay도 듣는데
   * (Svelte 소스 bind_paused의 주석: "If someone switches the src while
   * media is playing, the player will pause. Listen to the canplay event
   * to get notified of this situation."), 새 src가 재생 가능해지는
   * 시점에 실제 paused 값으로 다시 맞춰준다 — 그래서 이 경로를 따로
   * 처리할 필요가 없다.
   */
  let paused = $state(true);
  const playing = $derived(!paused);
  let current = $state(0);
  let volume = $state(1);
  let muted = $state(false);
  let rate = $state(1);
  let peaks = $state<number[]>([]);
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);

  /**
   * 북마크 편집·삭제에서 "다음 배열"을 계산할 때 베이스로 쓰는 로컬
   * 사본. recording.bookmarks(프롭)는 onbookmarkchange → +page.svelte의
   * send()가 보낸 PATCH 응답이 돌아와야 갱신된다 — 그 응답을 기다리는
   * 사이 메모 입력 두 개를 연달아 blur하면, 두 번째 blur 시점에도
   * 프롭은 여전히 "첫 번째 편집 이전" 값 그대로다. 그 프롭을 그대로
   * 베이스로 삼아 새 배열을 만들면(PATCH가 배열을 통째로 교체하므로)
   * 두 번째 편집이 보낸 배열에는 첫 번째 편집이 없어, 나중에 어느 쪽
   * 응답이 이기든 한쪽 편집이 사라진다. 그래서 편집·삭제는 항상 이
   * 사본을 베이스로 계산하고, 계산 직후 이 사본도 곧바로(동기적으로)
   * 갱신해 다음 편집이 응답을 기다리지 않고도 방금 만든 배열 위에서
   * 시작하게 한다. recording.bookmarks가 실제로 바뀌면(다른 녹음
   * 선택, 지점 북마크 추가, 우리 자신의 patch가 확인됨 등) 아래
   * 이펙트가 이 사본을 다시 맞춰준다.
   *
   * PATCH가 실패하면(onbookmarkchange가 false를 돌려주면) 이 낙관적
   * 갱신을 그대로 두면 안 된다 — 에러 카드는 뜨는데 메모칸은 방금
   * 입력한 값을 그대로 보여줘서, 마치 저장은 됐고 에러는 다른 일 때문인
   * 것처럼 보인다(실패했는데도 화면은 성공한 것처럼 보이는 쪽이,
   * 이 사본을 도입하기 전 "편집이 통째로 사라지는" 버그보다 더 나쁘다
   * — 사용자가 실패를 알아챌 방법이 없다). 그래서 각 편집·삭제
   * 핸들러는 실패 시 자신이 만든 변화만 되돌린다(전체 스냅샷을 통째로
   * 복원하지 않는다) — 그래야 그 사이 다른 편집이 성공했어도 이
   * 되돌림이 그 결과를 덮어쓰지 않는다.
   */
  // svelte-ignore state_referenced_locally
  let localBookmarks = $state<Bookmark[]>(recording?.bookmarks ?? []);
  $effect(() => {
    localBookmarks = recording?.bookmarks ?? [];
  });

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
   *
   * 의도적 결정: 녹음을 바꿀 때 이전 녹음이 재생 중이었어도 새 녹음을
   * 자동 재생하지 않는다. 목록을 필터링하며 다음 항목을 고르는 화면
   * 특성상, 행을 클릭했을 뿐인데 소리가 갑자기 튀어나오는 쪽이 더
   * 당황스럽다고 판단했다 — 그리고 이건 별도 코드가 필요 없는
   * 기본값이기도 하다: src가 바뀌면 브라우저가 어차피 paused를 true로
   * 되돌리고, bind:paused가 그 값을 그대로 반영한다.
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

  /**
   * paused를 뒤집기만 한다 — 실제 play()/pause() 호출은 bind:paused의
   * 내부 이펙트가 담당한다. audio.play()/pause()를 여기서 직접 부르면
   * bind:paused가 반응형 상태와 다시 어긋날 여지가 생긴다.
   */
  function toggle() {
    paused = !paused;
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

  /**
   * timeupdate는 대략 250ms 간격으로만 도니, B가 끝자락 가까이 있으면
   * 문턱을 넘는 tick 없이 그대로 ended에 도달해 루프가 조용히 멈출 수
   * 있다 — ended를 보조 안전망으로 둬서 A-B 구간이 살아있으면 거기서도
   * A로 되감는다. 구간이 없으면(평범하게 끝까지 재생) 실제 Chromium
   * 에서는 ended 이전에 pause 이벤트도 발생한다(HTML 스펙의 "재생이
   * 끝에 도달" 절차: paused가 false였다면 먼저 paused를 true로 두고
   * pause를 쏜 뒤에야 ended를 쏜다) — bind:paused가 그 pause 이벤트로
   * paused를 이미 true로 맞춰 놓았을 것이므로 아래 대입은 대부분
   * 중복이다. 그래도 이벤트 순서에 기대지 않고 토글 버튼이 확실히
   * 실제 상태를 따라가도록 여기서도 명시적으로 정리해 둔다(멱등이라
   * 두 번 대입해도 무해하다).
   */
  function onEnded() {
    if (!audio) return;
    const wrapTo = loopWrapTarget(Number.POSITIVE_INFINITY, { loopA, loopB });
    if (wrapTo !== null) {
      audio.currentTime = wrapTo;
      void audio.play();
    } else {
      paused = true;
    }
  }

  function markLoop() {
    const t = audio?.currentTime ?? 0;
    const next: LoopState = nextLoop({ loopA, loopB }, t);
    loopA = next.loopA;
    loopB = next.loopB;
  }

  /**
   * A-B 구간이 완성돼 있으면(loopA·loopB 모두 값이 있으면) 그 구간을
   * 구간 북마크로 포착하고, 아니면 현재 재생 위치를 지점 북마크로
   * 남긴다. A-B 반복 자체는 여기서도 저장하지 않는다 — bookmarkDraft는
   * 순간을 옮겨 담을 뿐, loopA·loopB는 그대로 휘발성 재생 상태로
   * 남는다.
   */
  function addBookmark() {
    if (!recording) return;
    onbookmark(bookmarkDraft({ loopA, loopB }, audio?.currentTime ?? 0));
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
      bind:paused
      ontimeupdate={onTimeUpdate}
      onended={onEnded}
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

      <Waveform {peaks} {progress} bookmarks={localBookmarks} durationSec={duration}
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

      {#if localBookmarks.length}
        <ul class="flex flex-wrap gap-2 pt-1">
          {#each sortBookmarks(localBookmarks) as b (b.id)}
            <li class="chip preset-tonal-tertiary flex items-center gap-1">
              <button type="button" class="tabular-nums" onclick={() => seek(b.atSec)}>
                {fmt(b.atSec)}{b.endSec !== null ? `–${fmt(b.endSec)}` : ''}
              </button>
              <input
                class="input input-sm w-28"
                value={b.note}
                placeholder="메모"
                onblur={async (e) => {
                  // 되돌릴 값은 "이 항목의 이전 note"고, 되돌리는 시점의
                  // 베이스는 그때의 localBookmarks(지금이 아니라 실패
                  // 응답이 온 시점) — b.note를 캡처해두는 대신 id로
                  // 다시 찾아 읽는다. b는 각 블록의 렌더 시점 스냅샷이라
                  // 신뢰할 수 있지만, "지금 이 필드가 뭐였는지"를 각
                  // 리비전마다 명시적으로 다시 읽어 두면 되돌릴 때도
                  // 같은 방식으로 최신 배열 위에 얹을 수 있어 더 안전하다.
                  const id = b.id;
                  const before = localBookmarks.find((x) => x.id === id);
                  const oldNote = before ? before.note : '';
                  const next = withBookmarkNote(localBookmarks, id, e.currentTarget.value);
                  localBookmarks = next;
                  const ok = await onbookmarkchange(next);
                  // 실패하면 이 편집만 되돌린다 — 응답을 기다리는 사이
                  // 다른 항목(혹은 같은 항목의 다른 편집)이 성공했을 수
                  // 있으므로, 실패 시점의 프롭이나 낡은 스냅샷이 아니라
                  // "지금의" localBookmarks 위에 이 항목의 note만 원래
                  // 값으로 되돌린다. 그래야 이 되돌림이 다른 편집의
                  // 결과를 덮어쓰지 않는다(프롭을 그대로 베이스로 삼을
                  // 때와 같은 종류의 유실을 되돌리기 로직에서 또
                  // 만들지 않기 위함).
                  if (!ok) localBookmarks = withBookmarkNote(localBookmarks, id, oldNote);
                }}
              />
              <button type="button" aria-label="북마크 삭제"
                onclick={async () => {
                  const id = b.id;
                  const removed = localBookmarks.find((x) => x.id === id) ?? b;
                  const next = withoutBookmark(localBookmarks, id);
                  localBookmarks = next;
                  const ok = await onbookmarkchange(next);
                  // 실패하면 지금의 localBookmarks(그 사이 다른 편집이
                  // 성공했을 수 있다) 위에 지운 항목만 다시 얹는다 —
                  // 위치는 상관없다, 목록·마커 모두 atSec 기준으로
                  // 다시 정렬해 보여준다.
                  if (!ok) localBookmarks = [...localBookmarks, removed];
                }}>
                ×
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}
