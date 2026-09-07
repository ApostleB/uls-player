import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import { SvelteURL } from 'svelte/reactivity';
import { render } from 'vitest-browser-svelte';
// 이 파일은 아래에서 '$app/state'의 page를 이미 page라는 이름으로 쓰고
// 있어서(SvelteKit의 페이지 스토어 목), vitest 브라우저 모드의 page
// 로케이터는 browserPage로 별칭을 둔다.
import { page as browserPage } from 'vitest/browser';
import type { Recording } from '$lib/types';
import { filterToParams } from '$lib/filter';

// $app/navigation의 goto·afterNavigate는 실제 SvelteKit 클라이언트 라우터가
// 시작된 뒤에만 온전히 동작한다. vitest-browser-svelte의 render()는 컴포넌트를
// 실제 라우터 부트스트랩 없이 그대로 마운트하므로, 모킹하지 않으면 마운트
// 시점에 곧바로 도는 $effect가 렌더 자체를 깨뜨린다.
//
// +page.svelte는 이제 afterNavigate가 신호를 줄 때까지 필터 → URL 이펙트를
// 미룬다(진짜 라우터에서 겪은 경합 — tests/e2e/import-flow.spec.ts와 커밋
// 메시지 참고). 여기 mock의 afterNavigate는 콜백을 즉시 동기 호출해, "라우터가
// 이미 준비된 것"처럼 흉내내 아래 테스트들의 기존 기대(마운트 시점에 곧바로
// goto가 불린다)를 그대로 유지한다.
//
// goto 모킹은 아래에서(모든 import가 끝난 뒤) mockUrl을 실제로 갱신하도록
// 다시 정의한다 — 이유는 mockUrl 선언부 주석 참고.
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: (fn: () => void) => fn()
}));

// 화면은 page.url.searchParams를 $effect 안에서 읽는다 — 외부에서 URL이
// 바뀌면(메뉴바 검색 등) 그 이펙트가 다시 돌아야 하므로, 단순한 고정
// 객체가 아니라 svelte/reactivity의 SvelteURL로 진짜 $app/state의 반응성을
// 재현한다. setSearchParams()가 이 URL을 바꿔 "화면 밖에서 URL이 바뀌는"
// 상황을 흉내낸다.
//
// vi.mock 팩토리는 호이스팅되어 다른 모듈 import(SvelteURL 포함)보다
// 먼저 실행되므로, 여기서는 import가 필요 없는 내장 URL로 우선 채워두고
// 아래에서(모든 import가 끝난 뒤) 진짜 반응형 인스턴스로 바꿔 끼운다.
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/recordings') }
}));

import Page from './+page.svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';

const mockUrl = new SvelteURL('http://localhost/recordings');
// page.url의 실제 타입은 pathname을 라우트 패턴 리터럴로 좁혀 두므로,
// 일반 string pathname을 갖는 SvelteURL은 구조적으로 안 맞는다 — 테스트
// 전용 대체물이라는 걸 명시적으로 잘라 말한다.
page.url = mockUrl as unknown as typeof page.url;

// goto는 여기서 mockUrl을 실제로 갱신한다 — replaceState와 반대다. Round 1의
// mock 설계(replaceState는 mockUrl을 절대 안 건드림)는 "얕은 라우팅은
// page.url을 안 바꾼다"는 실제 SvelteKit 동작을 그대로 반영한 것이었다.
// Round 2에서 화면의 필터 → URL 이펙트 자체를 replaceState에서 goto(진짜
// 내비게이션)로 바꿨으므로, 이제는 그 반대 사실 — @sveltejs/kit@2.70.3의
// 실제 client.js를 읽어 확인한 대로 goto는 진짜 내비게이션이라 page.url을
// 실제로 갱신한다 — 을 그대로 반영해야 이 모킹이 여전히 "실제보다 더 성실한
// 가짜"가 되지 않는다. target은 '/recordings'나 '?q=...'처럼 상대 경로로
// 오므로 현재 mockUrl을 기준으로 해석한다.
const gotoMock = vi.mocked(goto).mockImplementation(async (target) => {
  mockUrl.href = new URL(String(target), mockUrl.href).href;
});

function setSearchParams(qs: string) {
  mockUrl.search = qs;
}

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

// Task 1(행에서 죽은 클릭 영역을 없앤다) 이후로, 설명·태그를 더블클릭해
// 편집을 여는 동작은 그 첫 클릭에서 행을 선택하기도 한다 — 그러면 재생기가
// 뜨면서 Player.svelte의 lastId 이펙트가 /api/waveform/:id도 GET한다.
// 아래 테스트들은 전역 fetch를 통째로 mock해 send()가 보내는 PATCH
// 횟수를 세는데, 그 mock이 이제 이 파형 GET까지 함께 잡는다. 테스트의
// 실제 주장은 언제나 "PATCH가 정확히 한 번 나갔다"였으므로, 그 주장을
// 그대로 지키려면 fetch 호출 전체가 아니라 PATCH 호출만 세야 한다.
function patchCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
}

function baseData() {
  return {
    recordings: [
      rec({ id: '1', title: '레인', tags: ['데모'] }),
      rec({ id: '2', title: '정류장', tags: [] })
    ],
    tags: [{ tag: '데모', count: 1 }],
    formats: ['mp3', 'wav'],
    // mediaDir는 load가 실제로 내려보내는 값이라 타입상 필수다. 빈
    // 문자열이면 Player가 파일 경로 줄을 렌더하지 않으므로(그쪽
    // filePath 파생 참고) 이 테스트들이 보는 화면은 그대로다.
    mediaDir: ''
  };
}

// baseData()의 두 행은 recordedAt·durationSec이 우연히 같아서(rec()의
// 기본값) 날짜·길이 텍스트로 행을 구분할 수 없다. 행 클릭 테스트는 li
// 안의 "다른 동작이 없는 영역"을 정확히 짚어야 하므로, 길이가 서로
// 다른 별도 데이터를 쓴다.
function twoRowDataWithDistinctDurations() {
  return {
    recordings: [
      rec({ id: '1', title: '레인', tags: ['데모'], durationSec: 65 }),
      rec({ id: '2', title: '정류장', tags: [], durationSec: 200 })
    ],
    tags: [{ tag: '데모', count: 1 }],
    formats: ['mp3', 'wav'],
    // mediaDir는 load가 실제로 내려보내는 값이라 타입상 필수다. 빈
    // 문자열이면 Player가 파일 경로 줄을 렌더하지 않으므로(그쪽
    // filePath 파생 참고) 이 테스트들이 보는 화면은 그대로다.
    mediaDir: ''
  };
}

// pageData()·titles()는 URL → 필터 동기화(외부에서 URL이 바뀌는 경우)를
// 검증하는 테스트에서 쓴다 — baseData()와 형태는 같지만 목록 내용을
// 자유롭게 넣을 수 있어야 하고, titles()로 화면에 실제 보이는 제목만
// 순서대로 뽑아 필터링 결과를 짧게 비교한다.
function pageData(recordings: Recording[]) {
  return { recordings, tags: [], formats: ['mp3', 'wav'], mediaDir: '' };
}

// 각 행의 제목은 li 안의 첫 번째 button이다(체크박스는 input이라
// 걸리지 않는다) — 설명도 button이지만 title 다음에 오므로 첫 번째만
// 집으면 제목만 남는다.
function titles(): string[] {
  return Array.from(document.querySelectorAll('ul.space-y-1 > li')).map(
    (li) => li.querySelector('button')?.textContent?.trim() ?? ''
  );
}

beforeEach(() => {
  gotoMock.mockClear();
  // 테스트마다 목록 화면을 새로 마운트하지만 mockUrl은 모듈 전역이라
  // 이전 테스트가 남긴 검색어가 다음 테스트의 초기 필터로 새어 들어갈
  // 수 있다 — 매번 깨끗한 URL로 되돌린다.
  mockUrl.search = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('+page.svelte — 필터를 URL에 반영', () => {
  it('빈 필터로 마운트하면 목록 경로로 반영한다', async () => {
    render(Page, { data: baseData() });

    await vi.waitFor(() => expect(gotoMock).toHaveBeenCalled());
    expect(gotoMock).toHaveBeenLastCalledWith('/recordings', {
      replaceState: true,
      keepFocus: true,
      noScroll: true
    });
  });

  it('URL로 들어온 q와 로컬에서 고른 태그가 합쳐져 그대로 쿼리스트링에 반영된다', async () => {
    // q 입력은 메뉴바로 옮겨갔다 — 이 화면은 렌더하지 않으므로, 메뉴바
    // 검색과 같은 결과(URL의 q 변경)를 setSearchParams로 흉내낸다. 태그는
    // 여전히 이 화면(FilterBar) 안의 로컬 조작이라 그대로 클릭한다 — 두
    // 경로로 들어온 값이 하나의 쿼리스트링으로 합쳐지는지가 이 테스트의
    // 핵심이다.
    const { getByRole } = render(Page, { data: baseData() });

    setSearchParams('?q=레인');
    await tick();
    await getByRole('button', { name: /^데모\d/ }).click();

    const expected = filterToParams({
      q: '레인',
      tags: ['데모'],
      tagMode: 'and',
      from: '',
      to: ''
    }).toString();

    await vi.waitFor(() => {
      expect(gotoMock).toHaveBeenLastCalledWith(`?${expected}`, {
        replaceState: true,
        keepFocus: true,
        noScroll: true
      });
    });
  });

  it('태그를 눌러 바꾼 값이 그 자리에서 되돌아가지 않는다(실제 SvelteKit에서 재현한 회귀)', async () => {
    // 원래 이 테스트는 검색창 타이핑을 재현했다 — 하지만 q 입력은 메뉴바로
    // 옮겨가 이 화면에는 더 이상 없다. 버그의 본질은 "URL을 거치지 않은
    // 로컬 필터 변경이 곧바로 되돌아가는가"이지 q냐 tags냐가 아니다(아래
    // untrack 주석 참고) — 그래서 이 화면에 남은 유일한 로컬 변경 경로인
    // 태그 칩 클릭으로 같은 경로를 재현한다.
    //
    // untrack 없이 URL → 필터 이펙트가 filter 필드를 읽으면, 로컬 태그
    // 클릭 그 자체가(필터 → URL 이펙트의 goto가 아직 mockUrl에 반영되기도
    // 전에) 이 이펙트를 곧바로 다시 돌게 만든다 — 그 시점의 page.url은
    // 아직 마운트 때 그대로(빈 값)라, 지금 filter와 비교해 "다르다"고
    // 잘못 판단하고 방금 고른 태그를 그 자리에서 지워 버린다. Round 2에서
    // 필터 → URL 이펙트를 replaceState에서 goto로 바꾼 뒤에도(아래
    // gotoMock이 이제 mockUrl을 실제로 갱신하는데도) 이 경합은 그대로
    // 남아 있다 — goto도 비동기라 그 갱신이 아직 안 끝난 틈이 있기
    // 때문이다(+page.svelte의 필터 → URL 이펙트 주석에 실제 브라우저로
    // 재현한 절차를 적어뒀다). 이 테스트는 그 경합의 앞부분 — mockUrl이
    // 아직 갱신되기 전, 로컬 변경 직후의 순간 — 을 재현한다.
    const { getByRole } = render(Page, { data: baseData() });

    await getByRole('button', { name: /^데모\d/ }).click();
    // URL → 필터 이펙트가 (버그가 있다면) 다시 돌 기회를 준다.
    await tick();

    expect(titles()).toEqual(['레인']);
  });

  it('외부에서 URL의 q가 바뀌면 목록이 따라간다', async () => {
    // 메뉴바 검색이 이 경로로 동작한다 — 목록이 URL을 한 번만 읽고 말면
    // 메뉴바에서 검색해도 목록이 그대로 남는다.
    const { rerender } = render(Page, {
      data: pageData([rec({ id: '1', title: '레인' }), rec({ id: '2', title: '정류장' })])
    });

    expect(titles()).toEqual(['레인', '정류장']);

    setSearchParams('?q=레인');
    await rerender({
      data: pageData([rec({ id: '1', title: '레인' }), rec({ id: '2', title: '정류장' })])
    });

    expect(titles()).toEqual(['레인']);
  });

  it('자기가 쓴 URL 변경에는 다시 반응하지 않는다', async () => {
    // 필터 → URL → 필터로 도는 루프를 만들면 안 된다. 들어온 값이 지금
    // 필터와 같으면 아무것도 하지 않아야 한다.
    //
    // Round 2부터 필터 → URL 이펙트가 goto(진짜 내비게이션)를 쓰고,
    // gotoMock도 그 값을 실제로 mockUrl에 반영한다(위 gotoMock 선언부
    // 참고) — 그래서 태그를 한 번 누르기만 해도 "화면이 쓴 URL이 그대로
    // 되돌아오는" 상황이 자연스럽게 재현된다. Round 1처럼 같은 값을
    // setSearchParams로 다시 흘려보낼 필요가 없다 — 이미 gotoMock이
    // 그 왕복을 실제로 만들어낸다. 이 테스트가 확인하는 것: 그 왕복이
    // 일어난 뒤에도 goto가 "한 번 더" 불리지 않아야 한다(불리면 비교
    // 없이 무조건 덮어써 루프가 도는 회귀다).
    const { getByRole } = render(Page, { data: baseData() });

    await getByRole('button', { name: /^데모\d/ }).click();
    await tick();
    expect(titles()).toEqual(['레인']);

    await vi.waitFor(() => expect(gotoMock).toHaveBeenCalled());
    // gotoMock이 mockUrl을 갱신한 뒤 그 갱신이 URL → 필터 이펙트를 거쳐
    // 완전히 가라앉을 시간을 한 틱 더 준다 — 그래야 아래에서 잡는 호출
    // 수가 "왕복이 끝난 뒤"의 안정된 값이다.
    await tick();
    const callsAfterClick = gotoMock.mock.calls.length;

    // 루프가 있었다면 여기서 돌 시간을 더 준다.
    await tick();
    await tick();

    expect(titles()).toEqual(['레인']);
    expect(gotoMock.mock.calls.length).toBe(callsAfterClick);
  });
});

describe('+page.svelte — 초기화 버튼', () => {
  it('필터를 채운 뒤 초기화하면 완전히 비고, 그 뒤로도 필터가 계속 동작한다', async () => {
    const { getByRole, getByText } = render(Page, { data: baseData() });

    await expect.element(getByText('2 / 2')).toBeInTheDocument();

    // q는 이제 메뉴바 검색이 URL을 바꿔서 들어온다 — setSearchParams로
    // 흉내낸다.
    setSearchParams('?q=아무거나');
    await tick();
    await getByRole('button', { name: /^데모\d/ }).click();
    await expect.element(getByText('0 / 2')).toBeInTheDocument();

    await getByRole('button', { name: '초기화' }).click();
    // 0/2였던 게 2/2로 돌아온다는 것 자체가 태그뿐 아니라 q도 함께
    // 비워졌다는 증거다 — q가 "아무거나"로 남아 있었다면 태그를 지워도
    // 어떤 제목도 그 문자열을 포함하지 않아 여전히 0/2였을 것이다. 이
    // 화면에는 더 이상 q를 직접 보여주는 입력이 없어 값을 눈으로 확인할
    // 수 없으므로, 결과 카운트로 간접 검증한다.
    await expect.element(getByText('2 / 2')).toBeInTheDocument();

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
      formats: ['mp3', 'wav'],
      mediaDir: ''
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

    const patches = patchCalls(fetchMock);
    expect(patches).toHaveLength(1);
    const call = patches[0];
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

    const patches = patchCalls(fetchMock);
    expect(patches).toHaveLength(1);
    const call = patches[0];
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

describe('+page.svelte — send() 실패 처리', () => {
  it('일괄 태그 추가가 실패하면(400) 선택·초안이 그대로 남고, 서버 메시지가 화면에 뜬다', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: '동시에 삭제된 행이 있습니다' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getByRole, getByPlaceholder, getByText } = render(Page, { data: baseData() });

    const checkboxes = getByRole('checkbox');
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();
    await expect.element(getByText('2개 선택됨')).toBeInTheDocument();

    const tagInput = getByPlaceholder('태그 입력 후 Enter');
    await tagInput.fill('실패태그');
    pressEnter(tagInput.element());

    await getByRole('button', { name: '태그 추가' }).click();

    // 실패해도 선택은 그대로 남는다 — 252개 중 골라둔 걸 다시 고르게
    // 만들면 안 된다. 예전 코드는 실패 여부와 상관없이 무조건
    // selectedIds/bulkTags를 비워서, 이 두 assertion이 실패했다.
    await expect.element(getByText('2개 선택됨')).toBeInTheDocument();
    await expect.element(getByText('실패태그')).toBeInTheDocument();
    // 서버가 준 400 메시지를 그대로 보여준다.
    await expect.element(getByText('동시에 삭제된 행이 있습니다')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      op: 'addTags',
      ids: ['1', '2'],
      tags: ['실패태그']
    });
  });
});

describe('+page.svelte — 태그 편집 중 다른 행/필터로 전환', () => {
  it('완료를 누르지 않고 다른 행의 태그를 열면, 이전 행의 초안이 먼저 저장된다', async () => {
    const serverResponse = {
      recordings: [
        rec({ id: '1', title: '레인', tags: ['데모', '전환태그'] }),
        rec({ id: '2', title: '정류장', tags: [] })
      ],
      tags: [
        { tag: '데모', count: 1 },
        { tag: '전환태그', count: 1 }
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

    // row1(레인)의 태그를 연다 — 태그가 '데모' 하나뿐이라 이름이
    // 정확히 "데모"인 버튼(FilterBar 칩은 늘 개수가 붙어 "데모1"이라
    // exact 매치로 자연히 구분된다).
    await getByRole('button', { name: '데모', exact: true }).dblClick();
    const tagInput = getByPlaceholder('태그 입력 후 Enter');
    await tagInput.fill('전환태그');
    pressEnter(tagInput.element());

    // 완료를 누르지 않고 곧바로 row2(정류장)의 태그를 연다 — 정류장은
    // 태그가 없어 "태그 없음" 버튼 하나뿐이다.
    await getByText('태그 없음').dblClick();

    // row1의 초안이 자동으로 저장됐어야 한다 — 완료를 누르지 않았는데도.
    const patches = patchCalls(fetchMock);
    expect(patches).toHaveLength(1);
    const call = patches[0];
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      op: 'patch',
      id: '1',
      tags: ['데모', '전환태그']
    });

    // 응답 반영: row1에 새 태그가 실제로 붙었는지 화면으로도 확인.
    await expect.element(getByText('전환태그', { exact: true })).toBeInTheDocument();
  });
});

describe('+page.svelte — 행 클릭으로 재생 대상 선택(Task 15 시접)', () => {
  it('행의 빈 영역(길이 표시)을 클릭하면 선택되고, 체크박스 클릭은 선택으로 번지지 않는다', async () => {
    const { getByText, getByRole } = render(Page, { data: twoRowDataWithDistinctDurations() });

    // row2(정류장, 3:20)의 길이 표시 — 그 자체는 아무 동작도 없는 영역이라
    // 클릭이 li까지 그대로 전파돼 선택돼야 한다.
    const row2 = getByText('3:20').element().closest('li');
    if (!row2) throw new Error('행을 찾지 못했다');
    expect(row2.className).not.toContain('preset-tonal-primary');
    await getByText('3:20').click();
    expect(row2.className).toContain('preset-tonal-primary');

    // row1(레인, 1:05)의 체크박스를 눌러도 재생 선택(selectedId)은 안
    // 번진다 — 체크박스는 일괄 작업용 선택(selectedIds)과 별개다.
    const row1 = getByText('1:05').element().closest('li');
    if (!row1) throw new Error('행을 찾지 못했다');
    await getByRole('checkbox').first().click();
    expect(row1.className).not.toContain('preset-tonal-primary');
    // 체크박스 자체는 정상적으로 토글된다(일괄 작업용 선택).
    await expect.element(getByText('1개 선택됨')).toBeInTheDocument();
  });
});

describe('+page.svelte — 플레이어의 북마크 메모 편집(Task 16)', () => {
  function dataWithBookmark() {
    return {
      recordings: [
        rec({
          id: '1',
          title: '레인',
          durationSec: 120,
          bookmarks: [{ id: 'bm-1', atSec: 5, endSec: null, note: '원래 메모' }]
        })
      ],
      tags: [],
      formats: ['mp3', 'wav'],
      mediaDir: ''
    };
  }

  it('메모를 고치면 PATCH { op: "patch", id, bookmarks }를 보내고, 응답으로 화면을 갱신한다', async () => {
    const serverResponse = {
      recordings: [
        rec({
          id: '1',
          title: '레인',
          durationSec: 120,
          bookmarks: [{ id: 'bm-1', atSec: 5, endSec: null, note: '서버가 확정한 메모' }]
        })
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

    const { getByRole, getByPlaceholder, getByText } = render(Page, { data: dataWithBookmark() });

    // 행을 선택해 하단 고정 플레이어를 연다(Task 15 시접).
    await getByRole('button', { name: '레인' }).click();
    await expect.element(getByPlaceholder('메모')).toBeInTheDocument();

    await getByPlaceholder('메모').fill('내가 입력한 메모');
    // blur 전용 API가 없으니 편집 중인 입력 밖의 다른 요소를 눌러 실제
    // blur를 일으킨다(다른 인라인 편집 테스트들과 같은 패턴).
    await getByText('ULS Player').click();

    // 행 선택 자체가 Player의 파형(fetch('/api/waveform/1'))도 불러오므로
    // fetch 총 호출 수는 이 흐름과 무관하게 1보다 클 수 있다 — 실제로
    // PATCH /api/recordings를 보낸 호출만 찾아 검증한다.
    const patchCall = fetchMock.mock.calls.find(([url]) => url === '/api/recordings');
    if (!patchCall) throw new Error('PATCH /api/recordings 호출을 찾지 못했다');
    expect(JSON.parse(patchCall[1]!.body as string)).toEqual({
      op: 'patch',
      id: '1',
      bookmarks: [{ id: 'bm-1', atSec: 5, endSec: null, note: '내가 입력한 메모' }]
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/recordings')).toHaveLength(1);

    // 화면은 서버 응답을 반영한다 — 로컬 입력값을 그대로 붙잡고 있지 않는지 구분.
    expect((getByPlaceholder('메모').element() as HTMLInputElement).value).toBe('서버가 확정한 메모');
  });

  it('메모 편집이 실패하면(400) 입력값이 원래 메모로 되돌아가고, 서버 메시지가 에러 카드에 뜬다(Task 14와 같은 종류의 버그 회귀, 그리고 낙관적 갱신이 실패를 숨기지 않는지)', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: '동시에 삭제된 행입니다' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getByRole, getByPlaceholder, getByText } = render(Page, { data: dataWithBookmark() });

    await getByRole('button', { name: '레인' }).click();
    await expect.element(getByPlaceholder('메모')).toBeInTheDocument();

    await getByPlaceholder('메모').fill('저장 안 될 메모');
    await getByText('ULS Player').click();

    // send()가 실패를 삼키지 않고 카드로 보여준다.
    await expect.element(getByText('동시에 삭제된 행입니다')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/recordings')).toHaveLength(1);

    // 이 assertion이 핵심이다 — 에러 카드가 뜬다고 편집이 실제로
    // 되돌아갔는지가 증명되진 않는다. 낙관적으로 반영해둔 입력값을
    // 그대로 둔 채 에러 카드만 얹으면(실패해도 화면은 성공한 것처럼
    // 보이는 쪽이 이전 버그보다 더 나쁘다), 이 assertion이 실패로
    // 잡아낸다: 실패 응답이 오면 메모 입력값은 방금 입력한 값이 아니라
    // PATCH 이전의 원래 메모로 되돌아가야 한다.
    await vi.waitFor(() => {
      expect((getByPlaceholder('메모').element() as HTMLInputElement).value).toBe('원래 메모');
    });
  });
});

describe('+page.svelte — 목록 테이블 헤더', () => {
  /** 배지 개수가 서로 다른 세 행. 내용 의존 트랙이면 폭이 갈린다. */
  function rowsWithDifferentBadgeCounts() {
    return pageData([
      rec({ id: '1', title: '레인', files: { original: { ext: 'qta', bytes: 100 } } }),
      rec({
        id: '2',
        title: '정류장',
        files: { original: { ext: 'qta', bytes: 100 }, mp3: { ext: 'mp3', bytes: 200 } }
      }),
      rec({
        id: '3',
        title: '새벽',
        files: {
          original: { ext: 'qta', bytes: 100 },
          mp3: { ext: 'mp3', bytes: 200 },
          wav: { ext: 'wav', bytes: 300 }
        }
      })
    ]);
  }

  function header(): HTMLElement {
    const el = document.querySelector('[data-testid="list-header"]');
    if (!el) throw new Error('헤더 줄이 없다');
    return el as HTMLElement;
  }

  function rows(): HTMLElement[] {
    return Array.from(document.querySelectorAll('ul.space-y-1 > li')) as HTMLElement[];
  }

  // 여섯 열 이름을 순서대로 보여준다는 것은 아래 '여섯 번째 열
  // 이름으로 태그를 보여준다' 테스트가 header().children을 배열로
  // 통째 비교(toEqual)해 이미 못박고 있다 — 예전에는 태그 칸이
  // 없어서 다섯 개를 toContain으로만 확인하는 별도 테스트가 있었지만,
  // 그 다섯 라벨 존재 확인은 아래 여섯 라벨 순서 비교에 완전히
  // 포함되므로 접었다.

  // '헤더와 모든 행의 열 폭이 실제로 같다'(실제 배치 좌표로 정렬을
  // 재는 테스트)는 이 파일이 아니라 list-header-alignment.svelte.test.ts에
  // 있다 — 그 검증은 요소가 실제로 display:grid로 배치돼 있어야 의미가
  // 있는데, 이 파일은 +page.svelte만 단독으로 mount해서(+layout.svelte가
  // import하는 app.css/Tailwind를 거치지 않는다) grid·flex 유틸리티
  // 클래스가 전혀 적용되지 않는다 — 그 상태에서 그 테스트를 그대로 두면
  // grid가 아닌 기본 흐름 레이아웃을 재면서도 우연히 통과할 수 있다.
  // 이 파일에 app.css를 직접 import해서 고쳐 보려 했으나, 그러면 이
  // 파일의 다른 테스트 5개(태그 칩 버튼을 getByRole(/^데모\d/)로 찾는
  // 테스트들)가 15초 타임아웃으로 깨졌다 — 실제 CSS가 얹히면서 그
  // 버튼들이 접근성 트리에서 더 이상 같은 방식으로 안 잡히는 것으로
  // 보인다. vitest 브라우저 모드는 테스트 파일마다 별도의 페이지를
  // 쓰므로(실측 확인), app.css가 필요한 그 테스트 하나만 별도 파일로
  // 떼어 놓는 쪽이 이 파일의 다른 테스트를 안 건드리면서 실제 레이아웃을
  // 잴 수 있는 방법이었다(Fix Round 1 보고 참고).

  it('열 정의에 내용 의존 트랙이 없다', async () => {
    // 위 테스트는 지금 이 화면 폭에서 우연히 값이 맞아떨어질 수도 있다.
    // 정의 자체에 내용 의존 트랙이 없다는 것까지 못박아, 폭이 달라져도
    // 정렬이 유지되는 근거를 남긴다.
    render(Page, { data: rowsWithDifferentBadgeCounts() });

    const cols = getComputedStyle(header()).getPropertyValue('--row-cols');
    expect(cols.trim()).not.toBe('');
    expect(cols).not.toMatch(/\bauto\b|min-content|max-content|fit-content/);
  });

  it('보여줄 행이 없으면 헤더도 렌더하지 않는다', async () => {
    // 아무것도 없는 위에 열 이름만 떠 있는 상태를 만들지 않는다.
    render(Page, { data: pageData([]) });

    expect(document.querySelector('[data-testid="list-header"]')).toBeNull();
  });

  it('빈 상태 카드는 열 정의를 쓰지 않고 전체 폭을 쓴다', async () => {
    render(Page, { data: pageData([]) });

    const emptyCard = rows()[0];
    expect(emptyCard.textContent).toContain('아직 가져온 녹음이 없습니다');
    expect(getComputedStyle(emptyCard).display).not.toBe('grid');
  });

  it('태그가 제목 칸이 아니라 자기 열에 렌더된다', async () => {
    // 제목 칸(제목·설명이 세로로 쌓인 div) 안에 태그 칩이 남아 있으면
    // 열로 분리된 게 아니다. 칩이 화면 어딘가에 있다는 것만 확인하면
    // 분리 전에도 통과하므로, "제목 칸 안에는 없다"까지 본다.
    render(Page, { data: pageData([rec({ id: '1', title: '레인', tags: ['데모'] })]) });

    const row = document.querySelector('ul.space-y-1 > li') as HTMLElement;
    const titleCell = row.querySelector('button')!.closest('div')!;

    expect(titleCell.textContent).not.toContain('데모');
    expect(row.textContent).toContain('데모');
  });

  it('여섯 번째 열 이름으로 태그를 보여준다', async () => {
    render(Page, { data: pageData([rec({ id: '1', title: '레인', tags: ['데모'] })]) });

    const labels = Array.from(header().children).map((c) => c.textContent?.trim());
    expect(labels).toEqual(['선택', '제목', '태그', '녹음일자', '길이', '저장된 확장자']);
  });
});

describe('+page.svelte — 행에서 죽은 클릭 영역이 없다', () => {
  /**
   * 하단 재생기가 이 제목으로 떴는지 본다 — 행이 재생 대상이 됐다는 뜻이다.
   *
   * getByText(title, { exact: true })는 목록 행의 제목 버튼과 재생기 제목이
   * 둘 다 정확히 같은 문자열이라 strict mode violation(요소 2개)으로
   * 깨진다(getByRole('strong', ...)로 좁혀도 이 브라우저 프로바이더의 role
   * 엔진은 <strong>을 매치하지 않아 마찬가지로 깨졌다). Player.svelte는
   * <audio> 바로 다음 형제 div 안에만 제목 <strong>을 렌더하므로, 그
   * 구조로 재생기 쪽 제목만 골라 폴링한다.
   */
  async function playerShows(title: string) {
    await expect
      .poll(() => document.querySelector('audio + div strong')?.textContent?.trim() ?? null)
      .toBe(title);
  }

  it('설명을 한 번 클릭하면 그 행이 재생 대상이 된다', async () => {
    // 설명 버튼에는 ondblclick만 있었고 부모 div가 stopPropagation을 해서,
    // 한 번 클릭하면 아무 일도 일어나지 않았다 — 사용자가 클릭이 씹혔다고
    // 여기고 다시 누르게 되던 자리다.
    render(Page, { data: pageData([rec({ id: '1', title: '레인', description: '빗소리' })]) });

    await browserPage.getByText('빗소리').click();

    await playerShows('레인');
  });

  it('태그를 한 번 클릭하면 그 행이 재생 대상이 된다', async () => {
    render(Page, { data: pageData([rec({ id: '1', title: '레인', tags: ['데모'] })]) });

    await browserPage.getByText('데모', { exact: true }).click();

    await playerShows('레인');
  });

  it('설명이 비어 있어도("설명 없음") 클릭이 먹는다', async () => {
    render(Page, { data: pageData([rec({ id: '1', title: '레인' })]) });

    await browserPage.getByText('설명 없음').click();

    await playerShows('레인');
  });

  it('태그가 없어도("태그 없음") 클릭이 먹는다', async () => {
    render(Page, { data: pageData([rec({ id: '1', title: '레인' })]) });

    await browserPage.getByText('태그 없음').click();

    await playerShows('레인');
  });
});
