import { describe, it, expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Bookmark } from '$lib/types';
import Waveform from './Waveform.svelte';

describe('Waveform.svelte — 북마크 마커 클릭 시 점프', () => {
  it('마커를 클릭하면 그 지점의 진행률로 onseek를 호출하고, 아래 캔버스로 클릭이 새지 않는다', async () => {
    const bookmarks: Bookmark[] = [{ id: 'b1', atSec: 25, endSec: null, note: '표시 지점' }];
    const onseek = vi.fn();

    render(Waveform, {
      peaks: [0.5, 0.5, 0.5, 0.5],
      progress: 0.1,
      bookmarks,
      durationSec: 100,
      onseek
    });

    await page.getByRole('button', { name: /표시 지점/ }).click();

    // 캔버스 클릭 핸들러까지 같이 불렸다면 onseek가 두 번(마커 값 +
    // 캔버스 클릭 위치 값) 불렸을 것이다 — stopPropagation이 그걸 막는다.
    expect(onseek).toHaveBeenCalledTimes(1);
    expect(onseek).toHaveBeenCalledWith(25 / 100);
  });

  it('durationSec이 0이면(길이 미상) 마커 클릭이 onseek를 호출하지 않는다', async () => {
    const bookmarks: Bookmark[] = [{ id: 'b1', atSec: 25, endSec: null, note: '표시 지점' }];
    const onseek = vi.fn();

    render(Waveform, { peaks: [], progress: 0, bookmarks, durationSec: 0, onseek });

    await page.getByRole('button', { name: /표시 지점/ }).click();

    expect(onseek).not.toHaveBeenCalled();
  });
});

describe('Waveform.svelte — 캔버스 클릭으로 탐색', () => {
  it('캔버스를 클릭하면 0~1 사이의 진행률로 onseek를 호출한다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.3, 0.6, 0.9], progress: 0, bookmarks: [], durationSec: 10, onseek });

    await page.getByRole('slider', { name: '재생 위치' }).click();

    expect(onseek).toHaveBeenCalledTimes(1);
    const ratio = onseek.mock.calls[0][0];
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });
});
