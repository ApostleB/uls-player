import { describe, it, expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Bookmark } from '$lib/types';
import Waveform from './Waveform.svelte';

/** 캔버스의 실제 폭 안에서 비율 위치의 clientX를 만든다. */
function xAt(canvas: Element, ratio: number): number {
  const r = canvas.getBoundingClientRect();
  return r.left + r.width * ratio;
}

function canvasOf(): HTMLCanvasElement {
  const c = document.querySelector('canvas');
  if (!c) throw new Error('캔버스가 없다');
  return c as HTMLCanvasElement;
}

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

describe('Waveform.svelte — 호버 시 재생헤드와 시간', () => {
  it('파형 위에 커서를 올리면 그 지점의 시각을 보여준다', async () => {
    // ratio=0.5 하나만 확인하면 hoverRatio를 항상 0.5로 고정한 구현도
    // 통과한다 — 실제로 커서를 따라가는지 증명하려면 서로 다른 두
    // 지점을 각각 확인해야 한다.
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek: vi.fn() });

    const c = canvasOf();
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );

    // 100초의 절반 → 0:50
    await expect.element(page.getByText('0:50')).toBeInTheDocument();

    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.2), bubbles: true, pointerId: 1 })
    );

    // 100초의 20% → 0:20이어야 하고, 이전 0:50 표시는 사라져야 한다.
    await expect.element(page.getByText('0:20')).toBeInTheDocument();
    expect(page.getByText('0:50').elements()).toHaveLength(0);
  });

  it('커서가 파형을 벗어나면 표시가 사라진다', async () => {
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek: vi.fn() });

    const c = canvasOf();
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );
    await expect.element(page.getByText('0:50')).toBeInTheDocument();

    c.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1 }));

    // hoverRatio는 pointerleave 핸들러 안에서 동기적으로 null이 되지만,
    // Svelte 5의 DOM 반영은 마이크로태스크로 미뤄진다(tick으로 확인함).
    // 그래서 await 없는 document.body.textContent 검사는 반영 전 상태를
    // 읽어 경쟁 상태로 깨진다 — 재시도하는 locator 단언으로 실제 DOM이
    // 안정될 때까지 기다린다(고정 sleep이 아니라 관찰 가능한 조건 대기).
    await expect.element(page.getByText('0:50')).not.toBeInTheDocument();
  });

  it('호버만으로는 onseek를 호출하지 않는다', async () => {
    // 스크러빙 없음의 절반이다 — 올려놓기만 해도 소리가 튀면 안 된다.
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );

    expect(onseek).not.toHaveBeenCalled();
  });
});

describe('Waveform.svelte — 끌어서 점프', () => {
  /** pointerdown → pointermove → pointerup을 순서대로 보낸다. */
  function drag(c: HTMLCanvasElement, fromRatio: number, toRatio: number) {
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    c.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: xAt(c, fromRatio), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, toRatio), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointerup', { clientX: xAt(c, toRatio), bubbles: true, pointerId: 1 })
    );
  }

  it('끌어서 놓으면 놓은 지점의 진행률로 정확히 한 번 onseek를 호출한다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    drag(canvasOf(), 0.2, 0.75);

    expect(onseek).toHaveBeenCalledTimes(1);
    expect(onseek.mock.calls[0][0]).toBeCloseTo(0.75, 2);
  });

  it('끄는 동안에는 onseek를 호출하지 않는다', async () => {
    // 스크러빙 없음의 나머지 절반이다. 놓기 전에 소리가 따라오면 안 된다.
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    c.setPointerCapture = () => {};
    c.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: xAt(c, 0.2), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.8), bubbles: true, pointerId: 1 })
    );

    expect(onseek).not.toHaveBeenCalled();
  });

  it('캔버스 왼쪽 밖에서 놓으면 0으로 고정해 호출한다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    const r = c.getBoundingClientRect();
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    c.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointerup', { clientX: r.left - 500, bubbles: true, pointerId: 1 })
    );

    expect(onseek).toHaveBeenCalledTimes(1);
    expect(onseek).toHaveBeenCalledWith(0);
  });

  it('끄는 중 Escape를 누르면 점프하지 않고 표시도 사라진다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    c.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: xAt(c, 0.2), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.8), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    c.dispatchEvent(
      new PointerEvent('pointerup', { clientX: xAt(c, 0.8), bubbles: true, pointerId: 1 })
    );

    expect(onseek).not.toHaveBeenCalled();
  });

  it('거의 움직이지 않고 놓으면 드래그가 아니라 클릭으로 처리한다', async () => {
    // 마우스를 누를 때 손이 1~2px 흔들리는 것은 정상이다. 이걸 드래그로
    // 보면 마커를 클릭하려던 사용자가 의도치 않게 드래그 경로로 빠진다.
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    const x = xAt(c, 0.5);
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, bubbles: true, pointerId: 1 }));
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 2, bubbles: true, pointerId: 1 }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 2, bubbles: true, pointerId: 1 }));

    // 드래그로는 호출하지 않는다 — 뒤이어 오는 click이 기존 경로로 처리한다.
    expect(onseek).not.toHaveBeenCalled();
  });
});

describe('Waveform.svelte — 키보드 탐색', () => {
  function keyOn(c: HTMLCanvasElement, key: string) {
    c.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  it('오른쪽 화살표는 5초 앞으로 간다', async () => {
    const onseek = vi.fn();
    // 100초짜리에서 20초 지점(progress 0.2) → 25초 → 0.25
    render(Waveform, { peaks: [0.5, 0.5], progress: 0.2, durationSec: 100, onseek });

    keyOn(canvasOf(), 'ArrowRight');

    expect(onseek).toHaveBeenCalledTimes(1);
    expect(onseek.mock.calls[0][0]).toBeCloseTo(0.25, 3);
  });

  it('왼쪽 화살표는 5초 뒤로 간다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5], progress: 0.2, durationSec: 100, onseek });

    keyOn(canvasOf(), 'ArrowLeft');

    expect(onseek.mock.calls[0][0]).toBeCloseTo(0.15, 3);
  });

  it('Home은 처음으로, End는 끝으로 간다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5], progress: 0.4, durationSec: 100, onseek });

    keyOn(canvasOf(), 'Home');
    expect(onseek).toHaveBeenLastCalledWith(0);

    keyOn(canvasOf(), 'End');
    expect(onseek).toHaveBeenLastCalledWith(1);
  });

  it('시작과 끝을 넘어가지 않는다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5], progress: 0, durationSec: 100, onseek });

    keyOn(canvasOf(), 'ArrowLeft');

    expect(onseek).toHaveBeenCalledWith(0);
  });

  it('durationSec이 0이면 키를 눌러도 아무 일도 없다', async () => {
    // 0으로 나눠 NaN을 onseek에 넘기면 재생기가 조용히 망가진다.
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5], progress: 0, durationSec: 0, onseek });

    keyOn(canvasOf(), 'ArrowRight');

    expect(onseek).not.toHaveBeenCalled();
  });
});
