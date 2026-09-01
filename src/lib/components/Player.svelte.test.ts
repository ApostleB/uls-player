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

    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});
