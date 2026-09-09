import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Recording } from '$lib/types';
import Page from './+page.svelte';

function rec(over: Partial<Recording> & { id: string }): Recording {
  return {
    title: '레인',
    description: '',
    tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00',
    durationSec: 125,
    sourceName: `${over.id}.qta`,
    appleAutoTitle: null,
    files: { original: { ext: 'qta', bytes: 100 } },
    bookmarks: [],
    createdAt: '2026-08-31T20:35:00+09:00',
    updatedAt: '2026-08-31T20:35:00+09:00',
    favoritedAt: null,
    deletedAt: null,
    ...over
  };
}

describe('메인 페이지 카드', () => {
  it('즐겨찾기가 있으면 그 카드와 제목들이 보인다', async () => {
    render(Page, { data: { favorites: [rec({ id: 'a', title: '레인' })], recent: [] } });

    await expect.element(page.getByText('즐겨찾기')).toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: '레인' })).toBeInTheDocument();
  });

  it('즐겨찾기가 없으면 그 카드를 그리지 않는다', async () => {
    // 빈 카드는 자리만 차지한다. 목록 화면의 태그·확장자 칩이 같은 규칙을 쓴다.
    render(Page, { data: { favorites: [], recent: [rec({ id: 'b', title: '정류장' })] } });

    expect(page.getByText('즐겨찾기').elements()).toHaveLength(0);
  });

  it('제목 링크가 그 녹음을 재생하는 주소를 가리킨다', async () => {
    render(Page, { data: { favorites: [], recent: [rec({ id: 'b', title: '정류장' })] } });

    await expect
      .element(page.getByRole('link', { name: '정류장' }))
      .toHaveAttribute('href', '/recordings?play=b');
  });
});
