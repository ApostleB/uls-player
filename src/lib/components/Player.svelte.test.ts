import { describe, it, expect, vi, afterEach } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Recording } from '$lib/types';
import Player from './Player.svelte';

function rec(over: Partial<Recording> & { id: string }): Recording {
  return {
    title: '레인',
    description: '',
    tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00',
    durationSec: 120,
    sourceName: `${over.id}.qta`,
    appleAutoTitle: null,
    files: { original: { ext: 'qta', bytes: 100 }, mp3: { bytes: 50 }, wav: { bytes: 200 } },
    bookmarks: [],
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    ...over
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('input[data-test-loose]').forEach((el) => el.remove());
});

describe('Player.svelte — 녹음 전환 시에만 A-B/위치를 리셋한다', () => {
  it('같은 id를 가진 새 객체로 다시 렌더링해도(관련 없는 목록 갱신) A-B 지정이 지워지지 않는다', async () => {
    const recA = rec({ id: 'aaaa' });
    const screen = render(Player, { recording: recA, formats: ['mp3', 'wav'] });
    await screen;

    await expect.element(page.getByText('레인')).toBeInTheDocument();

    // A 지정 — audio.currentTime은 로드 전이라 0
    await page.getByRole('button', { name: 'A 지정' }).click();
    await expect.element(page.getByText(/^A-B /)).toBeInTheDocument();

    // send()가 recordings 배열을 통째로 새로 받아올 때처럼, 같은 id지만
    // 다른 객체 참조로 다시 렌더링한다(무관한 행 patch를 흉내낸다).
    await screen.rerender({ recording: { ...recA }, formats: ['mp3', 'wav'] });

    // id가 그대로이니 A-B 배지가 그대로 남아 있어야 한다.
    await expect.element(page.getByText(/^A-B /)).toBeInTheDocument();
  });

  it('다른 id로 바뀌면 A-B 지정과 재생 위치를 리셋한다', async () => {
    const recA = rec({ id: 'aaaa' });
    const recB = rec({ id: 'bbbb', title: '정류장' });
    const screen = render(Player, { recording: recA, formats: ['mp3', 'wav'] });
    await screen;

    await page.getByRole('button', { name: 'A 지정' }).click();
    await expect.element(page.getByText(/^A-B /)).toBeInTheDocument();

    await screen.rerender({ recording: recB, formats: ['mp3', 'wav'] });

    await expect.element(page.getByText('정류장')).toBeInTheDocument();
    // 새 녹음으로 넘어갔으니 이전 A-B 배지는 사라져야 한다.
    await expect.element(page.getByText(/^A-B /)).not.toBeInTheDocument();
  });
});

describe('Player.svelte — 입력 필드에 포커스가 있으면 단축키를 무시한다', () => {
  it('Space를 눌러도 제목 입력창 등에 포커스가 있으면 재생을 토글하지 않는다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });
    await screen;

    // 목록 화면의 제목 입력창 같은 요소를 흉내낸다.
    const input = document.createElement('input');
    input.setAttribute('data-test-loose', '1');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

    expect(playSpy).not.toHaveBeenCalled();
  });

  it('입력 필드 밖이면 Space가 재생을 토글한다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });
    await screen;

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    );

    // toggle()은 paused 상태만 뒤집는다 — 실제 play() 호출은
    // bind:paused의 내부 이펙트가 다음 틱에 담당하므로 한 박자 기다린다.
    await vi.waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
  });

  it('배속 select에 포커스가 있으면 Space가 재생을 토글하지 않는다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });

    const select = await page.getByRole('combobox').element();
    (select as HTMLSelectElement).focus();
    select.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

    // "호출 안 됨"은 타이밍에 취약하다(가드가 깨졌다면 toggle()→paused
    // 변경→bind:paused의 내부 effect가 다음 마이크로태스크에 play()를
    // 부른다 — 검사를 너무 일찍 하면 아직 안 불렸을 뿐인데 통과해버린다).
    // 같은 이벤트를 document.body에서 쐈을 때 실제로 감지되는 데
    // 걸리는 시간(위 "Space가 재생을 토글한다" 테스트에서 vi.waitFor로
    // 확인됨, 보통 한 마이크로태스크 이내)보다 넉넉히 긴 시간을 실제로
    // 기다린 뒤에도 호출이 없어야 가드가 진짜로 막았다고 볼 수 있다.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(playSpy).not.toHaveBeenCalled();
  });
});

describe('Player.svelte — 녹음 전환 시 재생 상태 표시가 실제 상태를 따라간다 (Finding 1)', () => {
  it('재생 중 다른 녹음으로 바뀌어 브라우저가 이벤트 없이 paused를 되돌려도, canplay가 오면 토글 버튼이 실제 상태로 맞춰진다', async () => {
    const recA = rec({ id: 'aaaa' });
    const recB = rec({ id: 'bbbb', title: '정류장' });
    const screen = render(Player, { recording: recA, formats: ['mp3', 'wav'] });
    await screen;

    const audioEl = document.querySelector('audio') as HTMLAudioElement;

    // "재생 중"이었다고 가정한다. 실제 미디어 없이 재생 상태를 흉내내는
    // 표준적인 방법으로 네이티브 paused 게터(읽기 전용 IDL 속성이라
    // 직접 대입은 못 한다)를 스텁하고 play 이벤트를 흉내낸다.
    Object.defineProperty(audioEl, 'paused', { get: () => false, configurable: true });
    audioEl.dispatchEvent(new Event('play'));
    await expect.element(page.getByRole('button', { name: '일시정지' })).toBeInTheDocument();

    // 브라우저가 src 재할당(레코딩 전환) 시 HTML 미디어 스펙의 로드
    // 알고리즘 abort 단계를 따라 paused를 이벤트 없이 true로 되돌린다.
    // 뒤이어 canplay만 온다.
    Object.defineProperty(audioEl, 'paused', { get: () => true, configurable: true });
    await screen.rerender({ recording: recB, formats: ['mp3', 'wav'] });
    audioEl.dispatchEvent(new Event('canplay'));

    // pause 이벤트가 한 번도 없었는데도 토글 버튼이 "재생"으로 돌아와야
    // 한다 — onplay/onpause만으로 playing을 관리했다면(예전 구현) 이
    // 지점에서 영원히 "일시정지"로 박제된다.
    await expect.element(page.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });
});

describe('Player.svelte — A-B 구간 안전망 (Finding 3)', () => {
  it('A-B 구간이 설정된 채 ended에 도달하면 A로 되감고 이어서 재생한다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });
    await screen;

    const audioEl = document.querySelector('audio') as HTMLAudioElement;

    // A 지정 → B 지정. currentTime은 로드 전이라 항상 0이므로, markLoop의
    // "B가 A보다 앞이면 A+1초로 보정" 경로를 타 loopA=0, loopB=1이 된다.
    await page.getByRole('button', { name: 'A 지정' }).click();
    await page.getByRole('button', { name: 'B 지정' }).click();
    await expect.element(page.getByText(/^A-B /)).toBeInTheDocument();

    Object.defineProperty(audioEl, 'currentTime', { value: 20, writable: true, configurable: true });
    audioEl.dispatchEvent(new Event('ended'));

    expect(audioEl.currentTime).toBe(0); // loopA로 되감김
    expect(playSpy).toHaveBeenCalledTimes(1); // 이어서 재생
  });

  it('A-B 구간이 없으면 ended에서 되감거나 다시 재생하지 않는다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });
    await screen;

    const audioEl = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audioEl, 'currentTime', { value: 20, writable: true, configurable: true });
    audioEl.dispatchEvent(new Event('ended'));

    expect(audioEl.currentTime).toBe(20); // 되감지 않음
    expect(playSpy).not.toHaveBeenCalled(); // 루프 없으니 다시 재생하지 않음
  });
});
