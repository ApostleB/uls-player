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

// Locator에는 키 입력 메서드가 없다(fill()은 값만 바로 채우고 keydown을
// 만들지 않는다) — TagInput은 Enter keydown으로 칩을 추가하므로, 그
// 이벤트를 실제 input 엘리먼트에 직접 디스패치한다.
function pressEnter(el: HTMLElement | SVGElement) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
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
    await getByRole('button', { name: /^데모\d/ }).click();

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
    await getByRole('button', { name: /^데모\d/ }).click();
    await expect.element(getByText('0 / 2')).toBeInTheDocument();

    await getByRole('button', { name: '초기화' }).click();
    await expect.element(getByText('2 / 2')).toBeInTheDocument();
    expect((getByPlaceholder('제목 검색').element() as HTMLInputElement).value).toBe('');

    // 리셋이 얼려 있는 EMPTY_FILTER를 그대로 재사용했다면, 여기서
    // filter.tags = [...] 대입이 던지면서 클릭 핸들러가 중간에 멈추고
    // 아래 카운트는 절대 "1 / 2"로 바뀌지 않는다 — 리셋 이후에도 필터
    // 객체가 진짜 새 객체(얼지 않은)인지를 이 재클릭으로 검증한다.
    await getByRole('button', { name: /^데모\d/ }).click();
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

describe('+page.svelte — 인라인 편집(설명·태그)', () => {
  it('설명을 더블클릭해 고치면 PATCH { op: "patch", id, description }를 보내고, 응답으로 화면을 갱신한다', async () => {
    // 서버가 돌려주는 값을 직접 입력한 값과 다르게 만들어서, 화면이 응답을
    // 반영하는지(로컬 입력값을 그대로 붙잡고 있는 게 아닌지) 구분한다.
    const serverResponse = {
      recordings: [
        rec({ id: '1', title: '레인', tags: ['데모'], description: '서버가 확정한 설명' }),
        rec({ id: '2', title: '정류장', tags: [] })
      ],
      tags: [{ tag: '데모', count: 1 }]
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(serverResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, getByLabelText } = render(Page, { data: baseData() });

    // 두 행 모두 설명이 비어 있어 "설명 없음"이 두 번 뜬다 — 첫 번째(레인)
    // 것만 편집한다.
    await getByText('설명 없음').first().dblClick();
    await getByLabelText('설명 수정').fill('내가 입력한 설명');
    // 이 컴포넌트에는 blur 전용 API가 없으니, 편집 중인 입력 밖의 다른
    // 요소를 눌러 실제 blur를 일으킨다.
    await getByText('ULS Player').click();

    await expect.element(getByText('서버가 확정한 설명')).toBeInTheDocument();
    await expect.element(getByText('내가 입력한 설명')).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      op: 'patch',
      id: '1',
      description: '내가 입력한 설명'
    });
  });

  it('행의 태그를 더블클릭해 TagInput으로 고치고 완료를 누르면 PATCH { op: "patch", id, tags }를 보내고, 응답으로 화면을 갱신한다', async () => {
    const serverResponse = {
      recordings: [
        rec({ id: '1', title: '레인', tags: ['데모', '서버가확정한태그'] }),
        rec({ id: '2', title: '정류장', tags: [] })
      ],
      tags: [
        { tag: '데모', count: 1 },
        { tag: '서버가확정한태그', count: 1 }
      ]
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(serverResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getByRole, getByPlaceholder, getByText } = render(Page, { data: baseData() });

    // row1의 태그 칩 묶음(태그가 '데모' 하나뿐이라 이름이 정확히 "데모"인
    // 버튼) — FilterBar의 칩은 항상 개수가 붙어("데모1") exact 매치로
    // 자연히 구분된다.
    await getByRole('button', { name: '데모', exact: true }).dblClick();

    const tagInput = getByPlaceholder('태그 입력 후 Enter');
    await tagInput.fill('내가입력한태그');
    pressEnter(tagInput.element());

    await getByRole('button', { name: '완료' }).click();

    // exact 매치가 필요하다 — FilterBar 칩은 "서버가확정한태그1"처럼
    // 개수가 뒤에 바로 붙어서, 부분일치로는 행의 태그 칩과 함께 걸린다.
    await expect.element(getByText('서버가확정한태그', { exact: true })).toBeInTheDocument();
    await expect.element(getByText('내가입력한태그', { exact: true })).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      op: 'patch',
      id: '1',
      tags: ['데모', '내가입력한태그']
    });
  });
});

describe('+page.svelte — 일괄 태그 추가/제거', () => {
  it('일부 행만 고르고 태그를 일괄 추가하면 선택된 ids만으로 PATCH { op: "addTags", ids, tags }를 보내고, 응답으로 목록과 필터바 태그 칩이 함께 갱신된다', async () => {
    // 두 행 중 하나만 선택한다 — recordings 전체 id를 보내는 실수와
    // selectedIds만 보내는 정상 동작이 여기서 갈린다(전부 선택했다면
    // 두 경우가 우연히 같은 ids가 되어 구분이 안 된다).
    const serverResponse = {
      recordings: [
        rec({ id: '1', title: '레인', tags: ['데모', '메모'] }),
        rec({ id: '2', title: '정류장', tags: [] })
      ],
      tags: [
        { tag: '데모', count: 1 },
        { tag: '메모', count: 1 }
      ]
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(serverResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getByRole, getByPlaceholder, getByText } = render(Page, { data: baseData() });

    const checkboxes = getByRole('checkbox');
    await checkboxes.nth(0).click();
    await expect.element(getByText('1개 선택됨')).toBeInTheDocument();

    const tagInput = getByPlaceholder('태그 입력 후 Enter');
    await tagInput.fill('메모');
    pressEnter(tagInput.element());

    await getByRole('button', { name: '태그 추가' }).click();

    // 눈에 보이는 결과: 필터바의 태그 칩 카운트가 응답을 따라 갱신된다.
    await expect.element(getByRole('button', { name: /^메모\d/ })).toBeInTheDocument();
    // 삭제와 달리 태그 추가는 선택을 비우지 않는다 — 같은 선택으로 다른
    // 태그를 더 붙이거나 이어서 지울 수 있어야 한다.
    await expect.element(getByText('1개 선택됨')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      op: 'addTags',
      ids: ['1'],
      tags: ['메모']
    });
  });

  it('일부 행만 고르고 태그를 일괄 제거하면 선택된 ids만으로 PATCH { op: "removeTags", ids, tags }를 보내고, 응답으로 필터바 태그 칩이 사라진다', async () => {
    // 여기서도 한 행만 선택한다 — recordings 전체 id로 잘못 보내는 실수를
    // ids 불일치로 잡아내려면 선택하지 않은 행이 최소 하나는 있어야 한다.
    const serverResponse = {
      recordings: [
        rec({ id: '1', title: '레인', tags: [] }),
        rec({ id: '2', title: '정류장', tags: [] })
      ],
      tags: []
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(serverResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getByRole, getByPlaceholder, getByText } = render(Page, { data: baseData() });

    const checkboxes = getByRole('checkbox');
    await checkboxes.nth(0).click();

    const tagInput = getByPlaceholder('태그 입력 후 Enter');
    await tagInput.fill('데모');
    pressEnter(tagInput.element());

    await getByRole('button', { name: '태그 제거' }).click();

    // FilterBar는 tags.length가 0이면 태그 칩 영역 자체를 렌더링하지 않는다.
    await expect.element(getByRole('button', { name: /^데모\d/ })).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      op: 'removeTags',
      ids: ['1'],
      tags: ['데모']
    });
  });
});
