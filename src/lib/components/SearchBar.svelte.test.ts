import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Filter } from '$lib/types';
import { EMPTY_FILTER } from '$lib/filter';
import SearchBar from './SearchBar.svelte';

const DEBOUNCE_MS = 250;

/** 디바운스가 확실히 지나가도록 여유를 둔다. */
const afterDebounce = () => new Promise((r) => setTimeout(r, DEBOUNCE_MS + 60));
const tick = () => new Promise((r) => setTimeout(r, 0));

function enterKey(isComposing: boolean): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true, isComposing
  } as KeyboardEventInit);
}

/** bind:value가 반응하도록 실제 input 이벤트로 값을 넣는다. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function setup(initial: Partial<Filter> = {}) {
  const state = $state({ filter: { ...EMPTY_FILTER, ...initial } as Filter });
  render(SearchBar, {
    get filter() {
      return state.filter;
    },
    set filter(next: Filter) {
      state.filter = next;
    },
    total: 269,
    shown: 42
  });
  const input = (await page.getByPlaceholder('검색어').element()) as HTMLInputElement;
  return { state, input };
}

describe('SearchBar — 디바운스', () => {
  it('타이핑 직후에는 아직 반영하지 않는다', async () => {
    const { state, input } = await setup();
    type(input, '레인');
    await tick();
    expect(state.filter.q).toBe('');
  });

  it('입력이 멈추면 반영한다', async () => {
    const { state, input } = await setup();
    type(input, '레인');
    await afterDebounce();
    expect(state.filter.q).toBe('레인');
  });

  it('Enter는 대기를 건너뛴다', async () => {
    const { state, input } = await setup();
    type(input, '레인');
    input.dispatchEvent(enterKey(false));
    await tick();
    expect(state.filter.q).toBe('레인');
  });

  it('한글 조합 중 Enter는 커밋하지 않는다', async () => {
    const { state, input } = await setup();
    type(input, '정준일');
    input.dispatchEvent(enterKey(true));
    await tick();
    expect(state.filter.q).toBe('');
  });
});

describe('SearchBar — 범위 선택', () => {
  it('네 범위를 모두 고를 수 있다', async () => {
    await setup();
    const select = page.getByLabelText('검색 범위');
    await expect.element(select).toBeInTheDocument();
    const labels = [...(await select.element()).querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toEqual(['전체', '제목', '설명', '태그']);
  });

  it('범위 변경은 디바운스 없이 즉시 반영된다', async () => {
    const { state } = await setup();
    const select = (await page.getByLabelText('검색 범위').element()) as HTMLSelectElement;
    select.value = 'tags';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(state.filter.scope).toBe('tags');
  });

  it('범위를 바꾸면 대기 중이던 검색어도 함께 커밋된다', async () => {
    // 범위만 즉시 바뀌고 검색어가 옛 값으로 남으면, 사용자가 보는
    // 결과는 "새 범위 + 옛 검색어"라는 아무도 요청하지 않은 조합이 된다.
    const { state, input } = await setup();
    type(input, '레인');
    const select = (await page.getByLabelText('검색 범위').element()) as HTMLSelectElement;
    select.value = 'title';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(state.filter).toMatchObject({ q: '레인', scope: 'title' });
  });
});

describe('SearchBar — 바깥에서의 변경', () => {
  it('filter.q가 밖에서 비워지면 입력창도 비워진다', async () => {
    // 초기화 버튼이 이 경로를 쓴다.
    const { state, input } = await setup({ q: '레인' });
    expect(input.value).toBe('레인');
    state.filter = { ...EMPTY_FILTER };
    await tick();
    expect(input.value).toBe('');
  });
});

describe('SearchBar — 결과 카운트', () => {
  it('걸러진 개수와 전체 개수를 보여준다', async () => {
    await setup();
    await expect.element(page.getByText('42 / 269')).toBeInTheDocument();
  });
});
