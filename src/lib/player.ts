/**
 * 재생기·파형의 순수 로직만 모은 모듈. Waveform.svelte·Player.svelte는
 * <audio>·<canvas> 배선만 맡고 판단은 여기 함수들이 한다 — 그래야 브라우저
 * 없이도 뮤테이션으로 증명 가능하다.
 */

/**
 * 단축키를 무시해야 하는 포커스 대상인지 판정한다. 목록 화면의 제목·설명·
 * 태그 입력 필드에 스페이스를 치면 재생/정지가 아니라 그냥 공백이 들어가야
 * 한다.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/** 파형 위 클릭 좌표를 0~1 진행률로 바꾼다. 캔버스 바깥 좌표도 0~1로 clamp한다. */
export function ratioFromClick(clientX: number, rectLeft: number, rectWidth: number): number {
  if (rectWidth <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rectLeft) / rectWidth));
}

/** 주어진 폭에 들어가는 막대 개수. */
export function barCount(width: number, barWidth = 2, gap = 1): number {
  return width > 0 ? Math.floor(width / (barWidth + gap)) : 0;
}

/**
 * peaks 배열을 bars개 구간으로 묶어(버킷), barIndex번째 막대가 대표할
 * 최대값을 구한다. peaks가 bars보다 많을 때(보통 그렇다) 여러 peak 중
 * 최댓값 하나로 막대 하나를 그린다.
 */
export function bucketMax(peaks: number[], bars: number, barIndex: number): number {
  if (bars <= 0 || peaks.length === 0) return 0;
  const per = peaks.length / bars;
  let m = 0;
  for (let j = Math.floor(barIndex * per); j < Math.floor((barIndex + 1) * per) && j < peaks.length; j++) {
    if (peaks[j] > m) m = peaks[j];
  }
  return m;
}

export interface LoopState {
  loopA: number | null;
  loopB: number | null;
}

/**
 * A-B 반복 지정 버튼을 누를 때의 상태 전이: 미지정 → A 지정 → B 지정 →
 * 해제(다시 A 지정)를 순환한다. B가 A보다 앞이거나 같으면 최소 1초 뒤로
 * 보정해 항상 재생 가능한 구간이 되게 한다.
 */
export function markLoop(state: LoopState, t: number): LoopState {
  if (state.loopA === null || state.loopB !== null) return { loopA: t, loopB: null };
  return { loopA: state.loopA, loopB: t > state.loopA ? t : state.loopA + 1 };
}

/**
 * A-B 구간이 완성돼 있고 현재 위치가 B를 지났으면 되돌아갈 A 위치를,
 * 아니면 null을 돌려준다. 저장되지 않는 일시적 재생 상태다 — 구간
 * 북마크(Bookmark.endSec)와는 다른 개념이다.
 */
export function loopWrapTarget(current: number, state: LoopState): number | null {
  if (state.loopA !== null && state.loopB !== null && current >= state.loopB) return state.loopA;
  return null;
}

export interface AudioLike {
  currentTime: number;
  play(): void | Promise<void>;
}

/**
 * 포맷 전환 뒤 재생 위치를 복원하고, 전환 전에 재생 중이었다면 다시
 * 재생한다. mp3와 wav를 같은 지점에서 비교해 들으려면 이게 없으면 안 된다.
 */
export function restorePlaybackPosition(audio: AudioLike, atSec: number, wasPlaying: boolean): void {
  audio.currentTime = atSec;
  if (wasPlaying) void audio.play();
}
