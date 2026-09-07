import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Filter } from '$lib/types';
import type { ExtensionCount } from '$lib/extensions';
import { EMPTY_FILTER } from '$lib/filter';
import FilterBar from './FilterBar.svelte';

const tick = () => new Promise((r) => setTimeout(r, 0));

const EXTS: ExtensionCount[] = [
  { ext: 'qta', count: 215, original: true },
  { ext: 'm4a', count: 54, original: true },
  { ext: 'mp3', count: 269, original: false },
  { ext: 'wav', count: 269, original: false }
];

function setup(initial: Partial<Filter> = {}, exts: ExtensionCount[] = EXTS) {
  const state = $state({ filter: { ...EMPTY_FILTER, ...initial } as Filter });
  render(FilterBar, {
    get filter() {
      return state.filter;
    },
    set filter(next: Filter) {
      state.filter = next;
    },
    tags: [{ tag: '데모', count: 3 }],
    exts
  });
  return { state };
}

describe('FilterBar — 확장자 칩', () => {
  it('확장자마다 칩이 하나씩 있다', async () => {
    setup();
    for (const e of EXTS) {
      await expect.element(page.getByRole('button', { name: new RegExp(`^${e.ext}`) })).toBeInTheDocument();
    }
  });

  it('누르면 filter.ext에 들어가고 다시 누르면 빠진다', async () => {
    const { state } = setup();
    const chip = page.getByRole('button', { name: /^qta/ });
    await chip.click();
    await tick();
    expect(state.filter.ext).toEqual(['qta']);
    await chip.click();
    await tick();
    expect(state.filter.ext).toEqual([]);
  });

  it('여러 개를 동시에 고를 수 있다', async () => {
    const { state } = setup();
    await page.getByRole('button', { name: /^qta/ }).click();
    await page.getByRole('button', { name: /^mp3/ }).click();
    await tick();
    expect(state.filter.ext).toEqual(['qta', 'mp3']);
  });

  it('확장자가 한 종류뿐이면 칩 줄을 그리지 않는다', async () => {
    setup({}, [{ ext: 'qta', count: 3, original: true }]);
    await tick();
    expect(page.getByRole('button', { name: /^qta/ }).elements()).toHaveLength(0);
  });
});

describe('FilterBar — 초기화', () => {
  it('검색어·범위·확장자·태그·기간을 모두 비운다', async () => {
    const { state } = setup({
      q: '레인', scope: 'tags', tags: ['데모'], tagMode: 'or',
      from: '2026-01-01', to: '2026-12-31'
    });
    await page.getByRole('button', { name: /^qta/ }).click();
    await tick();
    expect(state.filter.ext).toEqual(['qta']);
    await page.getByRole('button', { name: '초기화' }).click();
    await tick();
    expect(state.filter).toEqual(EMPTY_FILTER);
  });
});
