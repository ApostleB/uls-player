import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';
import type { ScanItem } from '$lib/types';

// "전체 선택" 버튼 하나만 좁게 검증한다. 이 버튼은 브리프의 코드를 그대로
// 옮기면 Row에 없는 r.error(항상 undefined)를 검사해서, 클릭할 때마다
// 모든 행이 항상 해제되는 버그가 있었다(r.scan.error로 고침). 그 버그가
// 리뷰까지 살아남은 건 이 경로를 검증하는 테스트가 하나도 없었기 때문이라,
// 폼 제출·SSE 등 다른 기능은 건드리지 않고 이 핸들러만 실제 DOM 상호작용으로
// 확인한다.
function scanItem(over: Partial<ScanItem> & { sourceName: string }): ScanItem {
  return {
    sourcePath: `/tmp/${over.sourceName}`,
    title: over.sourceName,
    appleAutoTitle: null,
    recordedAt: '2026-07-11T18:15:30+09:00',
    durationSec: 12,
    ext: 'qta',
    bytes: 100,
    audioStreamIndex: 0,
    duplicate: false,
    error: null,
    ...over
  };
}

describe('+page.svelte — 전체 선택', () => {
  it('에러 없는 행만 선택하고, 에러 행은 계속 해제 상태로 둔다', async () => {
    const items: ScanItem[] = [
      scanItem({ sourceName: 'ok1.qta' }),
      scanItem({ sourceName: 'ok2.qta' }),
      scanItem({ sourceName: 'bad.qta', error: '깨진 파일' })
    ];

    render(Page, {
      data: { tags: [], formats: ['mp3'] },
      form: { items, folder: '/tmp/fake' }
    });

    // 스캔 직후 기본값: 에러 없는 두 행만 선택돼 있다.
    await expect.element(page.getByText('2개 선택됨 / 전체 3개')).toBeInTheDocument();

    // 전체 해제 → 0개.
    await page.getByRole('button', { name: '전체 해제' }).click();
    await expect.element(page.getByText('0개 선택됨 / 전체 3개')).toBeInTheDocument();

    // 전체 선택 → 에러 없는 두 행만 다시 선택돼야 한다. 고쳐지기 전
    // (r.error 참조)에는 이 클릭이 아무것도 선택하지 못해 "0개 선택됨"이
    // 그대로 남았다.
    await page.getByRole('button', { name: '전체 선택' }).click();
    await expect.element(page.getByText('2개 선택됨 / 전체 3개')).toBeInTheDocument();
  });
});
