import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Recording } from '$lib/types';
import { filterToParams } from '$lib/filter';

// $app/navigation의 replaceState는 실제 SvelteKit 클라이언트 라우터가 시작된
// 뒤에만 부를 수 있다 — 시작 전에 부르면 "Cannot call replaceState(...)
// before router is initialized"를 던진다. vitest-browser-svelte의 render()는
// 컴포넌트를 실제 라우터 부트스트랩 없이 그대로 마운트하므로, 모킹하지
// 않으면 마운트 시점에 곧바로 도는 $effect가 렌더 자체를 깨뜨린다.
vi.mock('$app/navigation', () => ({ replaceState: vi.fn() }));

import Page from './+page.svelte';
import { replaceState } from '$app/navigation';

const replaceStateMock = vi.mocked(replaceState);

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
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    ...over
  };
}

function baseData() {
  return {
    recordings: [
      rec({ id: '1', title: '레인', tags: ['데모'] }),
      rec({ id: '2', title: '정류장', tags: [] })
    ],
    tags: [{ tag: '데모', count: 1 }],
    formats: ['mp3', 'wav']
  };
}

beforeEach(() => {
  replaceStateMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('+page.svelte — 필터를 URL에 반영', () => {
  it('빈 필터로 마운트하면 루트 경로로 반영한다', async () => {
    render(Page, { data: baseData() });

    await vi.waitFor(() => expect(replaceStateMock).toHaveBeenCalled());
    expect(replaceStateMock).toHaveBeenLastCalledWith('/', {});
  });

  it('검색어를 입력하고 태그를 고르면 그 상태 그대로 쿼리스트링에 반영한다', async () => {
    const { getByPlaceholder, getByRole } = render(Page, { data: baseData() });

    await getByPlaceholder('제목 검색').fill('레인');
    await getByRole('button', { name: '데모' }).click();

    const expected = filterToParams({
      q: '레인',
      tags: ['데모'],
      tagMode: 'and',
      from: '',
      to: ''
    }).toString();

    await vi.waitFor(() => {
      expect(replaceStateMock).toHaveBeenLastCalledWith(`?${expected}`, {});
    });
  });
});

describe('+page.svelte — 초기화 버튼', () => {
  it('필터를 채운 뒤 초기화하면 완전히 비고, 그 뒤로도 필터가 계속 동작한다', async () => {
    const { getByPlaceholder, getByRole, getByText } = render(Page, { data: baseData() });

    await expect.element(getByText('2 / 2')).toBeInTheDocument();

    await getByPlaceholder('제목 검색').fill('아무거나');
    await getByRole('button', { name: '데모' }).click();
    await expect.element(getByText('0 / 2')).toBeInTheDocument();

    await getByRole('button', { name: '초기화' }).click();
    await expect.element(getByText('2 / 2')).toBeInTheDocument();
    expect((getByPlaceholder('제목 검색').element() as HTMLInputElement).value).toBe('');

    // 리셋이 얼려 있는 EMPTY_FILTER를 그대로 재사용했다면, 여기서
    // filter.tags = [...] 대입이 던지면서 클릭 핸들러가 중간에 멈추고
    // 아래 카운트는 절대 "1 / 2"로 바뀌지 않는다 — 리셋 이후에도 필터
    // 객체가 진짜 새 객체(얼지 않은)인지를 이 재클릭으로 검증한다.
    await getByRole('button', { name: '데모' }).click();
    await expect.element(getByText('1 / 2')).toBeInTheDocument();
  });
});

describe('+page.svelte — send() 헬퍼', () => {
  it('PATCH 응답으로 받은 recordings·tags로 화면 상태를 바꾸고, 다시 조회하지 않는다', async () => {
    // 응답을 원래 데이터와 확연히 다르게 만들어서, 화면이 로컬에서 계산한
    // 값이 아니라 이 응답 그 자체를 반영하는지 구분해낸다.
    const serverAfterDelete = {
      recordings: [rec({ id: '9', title: '서버가 돌려준 항목', tags: [] })],
      tags: [{ tag: '서버태그', count: 5 }]
    };
    // typeof fetch로 시그니처를 못박아 둔다 — 안 그러면 인자 없는
    // 화살표 함수에서 매개변수 타입을 추론해 mock.calls의 각 항목이
    // 빈 튜플([])이 되고, 아래 calls[0][1] 접근이 컴파일 에러가 된다.
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(serverAfterDelete), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getByRole, getByText } = render(Page, { data: baseData() });

    await expect.element(getByText('레인')).toBeInTheDocument();

    await getByRole('checkbox').first().click();
    await expect.element(getByText('1개 선택됨')).toBeInTheDocument();

    await getByRole('button', { name: '목록에서 제거' }).click();

    await expect.element(getByText('서버가 돌려준 항목')).toBeInTheDocument();
    await expect.element(getByRole('button', { name: '서버태그' })).toBeInTheDocument();
    // 응답에 없는 원래 항목들은 더 이상 화면에 없어야 한다 — 로컬에서
    // id만 걸러낸 게 아니라 응답을 통째로 반영했는지 확인.
    await expect.element(getByText('레인')).not.toBeInTheDocument();
    await expect.element(getByText('정류장')).not.toBeInTheDocument();
    // 선택 상태도 응답 처리 후 비워진다.
    await expect.element(getByText('1개 선택됨')).not.toBeInTheDocument();

    // 다시 불러오기(refetch) 없이 PATCH 응답 하나로만 상태를 갱신했는지.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recordings',
      expect.objectContaining({ method: 'PATCH' })
    );
    const call = fetchMock.mock.calls[0];
    expect(JSON.parse(call[1]!.body as string)).toEqual({ op: 'delete', ids: ['1'] });
  });
});

describe('+page.svelte — data 재동기화', () => {
  it('load가 다시 실행되어 data가 바뀌면(예: 가져오기에서 돌아오는 내비게이션) 목록도 최신 결과를 따라간다', async () => {
    const { getByText, rerender } = render(Page, { data: baseData() });

    await expect.element(getByText('레인')).toBeInTheDocument();
    await expect.element(getByText('정류장')).toBeInTheDocument();

    // /import에서 새로 몇 개를 가져오고 목록으로 돌아오면 SvelteKit이
    // load를 다시 실행해 data를 새 참조로 갈아끼운다 — 여기서는 그 상황을
    // 흉내낸다. 이전 두 항목은 사라지고 새로 가져온 한 항목만 남는
    // 시나리오로 만들어서, 화면이 "합쳐서" 보여주는 게 아니라 최신 data를
    // 그대로 따라가는지 명확히 구분한다.
    const refreshed = {
      recordings: [rec({ id: '3', title: '새로_가져온_녹음', tags: [] })],
      tags: [],
      formats: ['mp3', 'wav']
    };
    await rerender({ data: refreshed });

    await expect.element(getByText('새로_가져온_녹음')).toBeInTheDocument();
    await expect.element(getByText('레인')).not.toBeInTheDocument();
    await expect.element(getByText('정류장')).not.toBeInTheDocument();
  });
});
