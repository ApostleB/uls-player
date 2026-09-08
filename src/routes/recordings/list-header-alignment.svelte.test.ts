// 이 파일은 page.svelte.test.ts와 분리돼 있다 — 이유는 아래 첫 import.
//
// 헤더 줄과 각 행이 실제로 같은 자리에 있는지는 계산된 CSS 값이 아니라
// 실제 배치 결과(getBoundingClientRect)로 재야 한다(이유는 아래
// '헤더와 모든 행의 열 폭이 실제로 같다' 테스트의 주석 참고). 그런데 그
// 측정이 뭔가를 검증하려면 애초에 grid로 배치돼 있어야 한다 — 이 프로젝트의
// +page.svelte는 전역 CSS(app.css, Tailwind 포함)를 직접 import하지 않고
// +layout.svelte에서만 import한다. vitest-browser-svelte의 render()는
// +layout.svelte 없이 +page.svelte만 단독으로 mount하므로, app.css를 이
// 테스트 파일이 직접 import해 주지 않으면 grid·flex 같은 유틸리티 클래스가
// 전혀 적용되지 않는다(display가 grid가 아니라 기본값인 block/list-item에
// 머문다) — 그 상태에서는 인라인 style의 grid-template-columns가 있어도
// 실제 배치에 아무 영향이 없어, 이 테스트가 아무것도 검증 못 하면서
// 우연히 통과할 수 있다(Fix Round 1에서 실측 확인).
//
// 그렇다고 app.css를 page.svelte.test.ts에 바로 import하면 안 된다 —
// 실제로 시도해 보니 그 파일의 다른 5개 테스트(태그 칩 버튼을
// getByRole(/^데모\d/)로 찾는 테스트들)가 15초 타임아웃으로 깨졌다(실제
// CSS가 얹히면서 그 버튼들이 접근성 트리에서 더 이상 같은 방식으로 안
// 잡히는 것으로 보인다 — 정확한 원인까지는 이번 라운드에서 추적하지
// 않았다). vitest 브라우저 모드는 테스트 파일마다 별도의 페이지를 쓰므로
// (실측 확인: grid-check라는 임시 파일에 app.css를 import해서 같이
// 돌려봐도 page.svelte.test.ts 쪽 22개는 전혀 안 깨졌다), 이 측정에
// app.css가 필요한 테스트 하나만 별도 파일로 떼어내는 쪽이 다른 테스트를
// 안 건드리면서 실제 레이아웃을 잴 수 있는 유일한 방법이었다.
import '../../app.css';

import { describe, it, expect, vi } from 'vitest';
import { page as browserPage } from 'vitest/browser';
import { tick } from 'svelte';
import { SvelteURL } from 'svelte/reactivity';
import { render } from 'vitest-browser-svelte';
import type { Recording } from '$lib/types';

// page.svelte.test.ts의 모킹과 동일하다(주석은 그쪽 참고) — 이 화면을
// 마운트하려면 어느 파일에서든 같은 모킹이 필요하다.
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: (fn: () => void) => fn()
}));

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/recordings') }
}));

import Page from './+page.svelte';
import { page } from '$app/state';

page.url = new SvelteURL('http://localhost/recordings') as unknown as typeof page.url;

// page.svelte.test.ts의 rec()·pageData()와 동일하다 — 이 파일만 따로
// import할 수 없어서(그쪽 파일 전체가 로드되며 그 파일의 다른 describe들도
// 실행돼 버린다) 그대로 옮겨 적었다.
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

function pageData(recordings: Recording[]) {
  // mediaDir는 load가 실제로 내려보내는 값이라 타입상 필수다. 빈
  // 문자열이면 Player가 파일 경로 줄을 렌더하지 않으므로 이 파일이
  // 재는 배치는 그대로다.
  return { recordings, tags: [], formats: ['mp3', 'wav'], mediaDir: '' };
}

// page.svelte.test.ts의 같은 조치와 동일하다(주석은 그쪽 참고) — Task 3부터
// 행을 선택하면 Player 마운트만으로 자동재생이 걸리는데, 이 파일은 배치
// 측정이 목적이라 재생 자체와 무관하다. 존재하지 않는 가짜 id의 진짜
// play()를 그대로 두면 처리되지 않은 프라미스 거부가 생긴다.
HTMLMediaElement.prototype.play = () => Promise.resolve();

describe('+page.svelte — 목록 테이블 헤더(실제 배치)', () => {
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

  it('헤더와 모든 행의 열 폭이 실제로 같다', async () => {
    // 이게 이 기능의 본체다. "정렬됐다"를 눈이 아니라 실제 배치 결과로
    // 확인한다.
    //
    // 처음에는 getComputedStyle(...).gridTemplateColumns 문자열을
    // 비교했다 — 그런데 Chromium에서 이 값은 고정 길이·fr 트랙은 실제
    // 사용된 픽셀 폭으로 돌아오지만, auto 트랙은 사용된 폭이 아니라
    // 리터럴 "auto" 문자열 그대로 돌아온다(실측 확인: --row-cols의
    // 마지막 트랙을 auto로 바꿔 배지 개수가 다른 행끼리 실제 배치 폭이
    // 갈리게 만들어도, 세 행 모두 "...auto"로 같은 문자열이라 이 비교는
    // 계속 통과했다 — Fix Round 1 보고 참고). 그래서 계산된 문자열이
    // 아니라 getBoundingClientRect()로 헤더의 n번째 칸과 각 행의 n번째
    // 칸이 실제로 같은 자리(왼쪽 끝·폭)에 있는지를 직접 잰다. 배지
    // 개수가 다른 행을 섞어 뒀으므로, 확장자 열이 내용 의존 트랙이면
    // 그 열부터(그리고 그 앞의 가변 열이 폭을 나눠 가지므로 이후 모든
    // 열이) 행끼리, 그리고 헤더와도 자리가 갈려 여기서 걸린다.
    render(Page, { data: rowsWithDifferentBadgeCounts() });

    const headerCells = Array.from(header().children) as HTMLElement[];
    expect(headerCells).toHaveLength(6);

    // 인덱스로 대응시키기 전에, 헤더의 n번째 자식과 각 행의 n번째
    // 자식이 실제로 개수가 같은지(선택 · 제목 · 태그 · 녹음일자 · 길이 ·
    // 저장된 확장자, 여섯 칸)부터 확인한다 — 성립하지 않으면 아래
    // 인덱스 대응 비교 자체가 의미가 없다.
    for (const row of rows()) {
      expect(row.children).toHaveLength(headerCells.length);
    }

    // 레이아웃은 소수점 픽셀 값을 낼 수 있어(subpixel layout) 정확한
    // float 동등 비교 대신 약간의 오차를 허용한다.
    const TOLERANCE_PX = 1;

    // 0번째 칸(체크박스)은 네이티브 폼 컨트롤이라 자기 칸 폭을 채우도록
    // 늘어나지 않는다(grid의 기본 stretch 정렬이 적용 안 되는 요소) —
    // 실측하면 헤더의 "선택" 글자칸은 트랙 전체 폭(32px)을 채우고
    // 체크박스는 자기 고유 크기(20px)로 남는다. 이건 정렬이 어긋난 게
    // 아니라 체크박스의 정상적인 렌더링이므로, 이 칸은 왼쪽 끝(칸이
    // 시작하는 자리)만 비교하고 폭은 비교하지 않는다. 나머지 다섯 칸은
    // 전부 일반 블록 요소(div/span)라 늘어나 칸을 꽉 채우므로 왼쪽
    // 끝·폭을 모두 비교한다.
    const WIDTH_NOT_COMPARABLE = new Set([0]);

    for (const row of rows()) {
      const rowCells = Array.from(row.children) as HTMLElement[];
      headerCells.forEach((headerCell, i) => {
        const expectedRect = headerCell.getBoundingClientRect();
        const actualRect = rowCells[i].getBoundingClientRect();
        expect(Math.abs(actualRect.left - expectedRect.left)).toBeLessThanOrEqual(TOLERANCE_PX);
        if (!WIDTH_NOT_COMPARABLE.has(i)) {
          expect(Math.abs(actualRect.width - expectedRect.width)).toBeLessThanOrEqual(TOLERANCE_PX);
        }
      });
    }
  });

  it('빈 상태 카드는 좁은 화면에서도 화면 안에 보인다', async () => {
    // Final Review Fix — 빈 상태 카드가 열 정의(overflow-x-auto/
    // min-w-[56rem]) 래퍼 밖에 있는지를 실제 배치로 잰다. 이 래퍼 안에
    // 갇히면 카드는 DOM에 있고 메시지 텍스트도 존재하지만(text-center로
    // 가운데 정렬된 채) 실제 화면 폭보다 훨씬 넓은 박스 한가운데로
    // 밀려나 사용자 눈에는 안 보인다 — textContent 존재 확인만으로는
    // 이 상태를 못 잡는다(그게 바로 이 결함이 새어나간 이유였다:
    // page.svelte.test.ts의 '빈 상태 카드는 열 정의를 쓰지 않고 전체
    // 폭을 쓴다'는 display !== 'grid'만 보고, 폭이 실제로 뷰포트
    // 안에 들어오는지는 보지 않는다). 그래서 실제 뷰포트를 좁혀 두고
    // getBoundingClientRect()로 카드가 문서 폭 안에 있는지를 잰다.
    //
    // 375px는 코디네이터가 실측한 회귀 재현 폭(896px 카드가 327px
    // 스크롤 뷰포트 안에 갇혀 메시지가 x≈448 근처로 밀려나 화면
    // 밖으로 나갔다)과 같다.
    await browserPage.viewport(375, 600);

    try {
      render(Page, { data: pageData([]) });

      const emptyCard = rows()[0];
      const cardRect = emptyCard.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;

      // 카드가 뷰포트보다 넓어서는 안 되고(전체 폭이지 56rem 고정폭이
      // 아니다), 왼쪽 끝도 0 근처(문서 스크롤 없이 바로 보이는 자리)에
      // 있어야 한다. 회귀 상태에서는 cardRect.width가 896px(56rem)로
      // 뷰포트(약 327px, mx-auto max-w-6xl의 p-6 패딩을 뺀 값)보다
      // 훨씬 넓어져 이 비교가 걸린다.
      const TOLERANCE_PX = 1;
      expect(cardRect.left).toBeGreaterThanOrEqual(-TOLERANCE_PX);
      expect(cardRect.width).toBeLessThanOrEqual(viewportWidth + TOLERANCE_PX);
      expect(cardRect.right).toBeLessThanOrEqual(viewportWidth + TOLERANCE_PX);
    } finally {
      // 이 파일의 다른 테스트(위 '헤더와 모든 행의 열 폭이 실제로
      // 같다')가 이 좁은 뷰포트를 물려받지 않도록 브라우저 기본
      // 뷰포트로 되돌린다 — 실행 순서에 이 테스트의 결과가 새지
      // 않게 하려는 것으로, 그 테스트 자체는(상대 위치 비교라)
      // 뷰포트 폭에 의존하지 않지만 명시적으로 원복해 우발적인
      // 순서 의존을 만들지 않는다.
      await browserPage.viewport(1280, 720);
    }
  });

  it('플레이어가 뜬 채로 목록을 끝까지 스크롤해도 마지막 행이 그 밑에 깔리지 않는다', async () => {
    // 회귀 대상: 이 파일 위쪽 컨테이너(`+page.svelte`)의 pb-*가 예약해
    // 두는 여백이 Player.svelte(`fixed inset-x-0 bottom-0`)의 실제 렌더링
    // 높이보다 작으면, 목록을 끝까지 내렸을 때 마지막 행의 아랫부분이
    // 고정 플레이어 밑에 조용히 깔린다 — 그 위를 눌러도 행이 아니라
    // 플레이어가 클릭을 가로챈다. 사전 존재 버그(task-6-report.md 4절):
    // 실측 Player 높이 193px(북마크 없음) vs 당시 pb-40 = 160px.
    //
    // Player는 fixed라 문서 흐름에서 완전히 빠져 있다. 그래서 "목록을
    // 끝까지 스크롤"했을 때 마지막 행의 뷰포트 기준 아랫변은 정확히
    // (뷰포트 높이 − pb)에 온다 — 위 컨테이너의 마지막 자식이 그 행이고,
    // pb는 그 뒤에 남는 유일한 여백이라서다. 이 부등식(Player 높이 >
    // pb ⇔ 겹침)은 목록 전체 길이와 무관하게 성립하므로, 실제로
    // 스크롤 가능한 만큼(뷰포트보다 큰) 더미 행을 채우고 진짜로 끝까지
    // 스크롤해 그 조건을 있는 그대로 재현한다.
    //
    // Player는 파형·전송 버튼 말고도 파일 경로 줄(mediaDir가 있을 때)과
    // 북마크 목록(있을 때만 렌더)에 따라 키가 달라진다 — 북마크가 여러
    // 개면 칩 목록이 새 줄로 넘어가 그만큼 더 커진다(이번 태스크의 실측:
    // 0개 193px, 여러 개(한 줄) 249px, 8개(두 줄) 301px, 15개(세 줄) 353px).
    // 그래서 이 테스트는 파일 경로가 보이고 북마크가 여러 개(6개) 붙은,
    // 실제로 더 키가 큰 쪽을 골라 잰다 — 기본 상태(북마크 0개)만 재는
    // 것보다 더 강한 핀이다.
    const bookmarks = Array.from({ length: 6 }, (_, i) => ({
      id: `bm-${i}`,
      atSec: i * 3,
      endSec: null,
      note: `메모${i + 1}`
    }));

    const recordings = [
      // 목록이 뷰포트(1280×720)보다 확실히 길어야 "끝까지 스크롤"이
      // 의미가 있다 — 그래야 마지막 행이 스크롤 전에는 화면 중간에
      // 있다가, 끝까지 내렸을 때 비로소 문서 맨 아래 근처로 온다.
      ...Array.from({ length: 12 }, (_, i) => rec({ id: `filler-${i}`, title: `더미 ${i}` })),
      rec({
        id: 'target',
        title: '마지막 행',
        files: {
          original: { ext: 'qta', bytes: 100 },
          mp3: { ext: 'mp3', bytes: 200 },
          wav: { ext: 'wav', bytes: 300 }
        },
        bookmarks
      })
    ];

    // 행을 선택하면 Player가 떠서 파형을 /api/waveform/:id로 GET한다
    // (page.svelte.test.ts와 같은 이유의 스텁). 이 테스트가 재는 배치
    // (파일 경로 줄·북마크 목록)는 recording prop에서 바로 오는 값이라
    // 이 응답 내용과는 무관하다 — 그래서 빈 배열이면 충분하다.
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      )
    );

    // pageData()의 mediaDir: ''는 파일 경로 줄을 일부러 꺼 둔 값이다(그쪽
    // 파일 상단 주석 참고) — 이 테스트는 그 줄이 켜진 실제 배치를 재야
    // 하므로 여기서만 채워 넣는다.
    const { getByRole } = render(Page, {
      data: { ...pageData(recordings), mediaDir: '/media' }
    });

    await getByRole('button', { name: '마지막 행' }).click();

    const player = document.querySelector('.fixed.inset-x-0.bottom-0');
    if (!player) throw new Error('플레이어가 뜨지 않았다');

    window.scrollTo(0, document.documentElement.scrollHeight);

    const rowEls = rows();
    const lastRow = rowEls[rowEls.length - 1];
    const rowRect = lastRow.getBoundingClientRect();
    const playerRect = (player as HTMLElement).getBoundingClientRect();

    // 마지막 행의 아랫변이 플레이어의 윗변보다 아래로 내려가면(=겹치면)
    // 회귀. TOLERANCE_PX는 이 파일의 다른 테스트와 같은 이유(서브픽셀
    // 레이아웃)로 둔다.
    const TOLERANCE_PX = 1;
    expect(rowRect.bottom).toBeLessThanOrEqual(playerRect.top + TOLERANCE_PX);
  });
});

describe('+page.svelte — 편집 모드 진입 시 행 높이(실제 배치)', () => {
  // 이 describe만의 로컬 helper다 — 위 describe의 rows()를 그대로 쓰고
  // 싶지만 그쪽 스코프 안에 갇혀 있고, 이 파일의 다른 곳(rec()·pageData())도
  // 이미 page.svelte.test.ts에서 그대로 옮겨 적힌 전례가 있다(위 주석
  // 참고) — 같은 이유로 새로 옮겨 적는다.
  function rows(): HTMLElement[] {
    return Array.from(document.querySelectorAll('ul.space-y-1 > li')) as HTMLElement[];
  }

  it('제목 편집을 열어도 행 높이가 눈에 띄게 바뀌지 않는다', async () => {
    // 스펙 요구사항: 편집 모드에 들어가도 행 높이가 눈에 보이게 바뀌면
    // 안 된다. 지금 input에 붙은 `class="input py-1"`은 눈대중 값이고,
    // 옆에 새로 붙는 완료 버튼(`btn btn-sm`)도 자기 높이를 들여온다 —
    // 컴포넌트 테스트는 대부분 +layout.svelte 없이 마운트돼 Tailwind가
    // 적용되지 않으므로 실측이 불가능하지만, 이 파일만은 app.css를 직접
    // import해(파일 맨 위 주석 참고) 실제 배치를 잴 수 있다.
    //
    // 더블클릭으로 제목 편집을 열면 첫 클릭이 행을 선택해(Task 15) 하단
    // Player가 뜨고 파형을 GET한다 — 이 테스트가 재는 건 그 행(li) 자체의
    // 높이라 응답 내용과는 무관하므로 빈 배열이면 충분하다(이 파일의
    // 다른 테스트와 같은 이유의 스텁).
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      )
    );

    const { getByRole } = render(Page, { data: pageData([rec({ id: '1', title: '레인' })]) });

    const displayHeight = rows()[0].getBoundingClientRect().height;

    await getByRole('button', { name: '레인' }).dblClick();

    const editHeight = rows()[0].getBoundingClientRect().height;

    // 실측(3회 반복 실행 모두 동일, 흔들림 없음): 표시 모드 72px, 편집
    // 모드 74px, 차이 2px. 원인을 따로 재보면(디버그 실측, 이 자리엔
    // 남기지 않음) input(`py-1`)의 실제 높이가 border 포함 26px로, 표시
    // 모드 제목 버튼의 줄 높이 24px보다 2px 크다 — 완료 버튼(`btn btn-sm`,
    // 26px)도 같은 높이라 추가로 키우지는 않는다. 행 전체 72px 대비 2px
    // (약 2.8%)는 "눈에 띄게 바뀐다"고 보기 어려운 수준이라 py-1은 그대로
    // 두고, 이 실측값 자체를 허용치로 못박는다 — 통과시키려고 거꾸로
    // 끼워 맞춘 숫자가 아니라 지금 렌더링이 만드는 차이 그대로다. 허용치를
    // 이보다 넉넉히 두면(예: 임의로 큰 값) input이나 버튼 높이를 키우는
    // 회귀가 와도 못 잡아낸다.
    const TOLERANCE_PX = 2;
    expect(Math.abs(editHeight - displayHeight)).toBeLessThanOrEqual(TOLERANCE_PX);
  });
});

describe('+page.svelte — 재생 바 높이(실제 배치)', () => {
  it('빈 재생 바와 녹음을 고른 재생 바의 높이가 같다', async () => {
    // 높이가 다르면 행을 고르는 순간 레이아웃이 움직이고, 그 프레임에
    // 더블클릭의 두 번째 클릭이 바에 가로채인다. 같은 높이여야 그 경합
    // 자체가 성립하지 않는다. 픽스처의 녹음에는 북마크가 없다 — 있으면
    // 북마크 줄만큼 로드된 바가 더 높아져 이 비교가 애초에 성립하지
    // 않는다(스펙 2.3절).
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      )
    );

    // pageData()의 mediaDir: ''는 파일 경로 줄을 일부러 꺼 둔 값이다(위
    // pageData 정의 옆 주석 참고) — 이 테스트는 경로 줄이 켜진 채로
    // 높이를 재야 그 줄의 높이 기여를 검증할 수 있으므로 여기서만 채워
    // 넣는다(세 번째 describe의 스크롤 테스트와 같은 이유).
    //
    // files는 original·mp3·wav를 모두 갖춘 실제 데이터 모양으로 둔다 —
    // rec()의 기본값(original만)을 그대로 쓰면, +page.svelte가 Player에
    // 넘기는 formats(`['original', ...data.formats]` = ['original','mp3',
    // 'wav'])와 recording.files의 교집합이 'original' 하나뿐이라 포맷
    // 버튼 줄(`{#each available as f}`, flex-wrap)이 1개짜리로만 그려져
    // 실사용을 대표하지 못한다. 실제 저장소의 269개 녹음은 전부 이 세
    // 파일을 갖고 있으므로, 선택된 바에는 항상 포맷 버튼 세 개(원본·
    // mp3·wav)와 그 다운로드 링크가 뜬다 — 그 실제 모양으로 재야 한다.
    const { getByRole, getByTestId } = render(Page, {
      data: {
        ...pageData([
          rec({
            id: '1',
            title: '레인',
            files: {
              original: { ext: 'qta', bytes: 100 },
              mp3: { ext: 'mp3', bytes: 200 },
              wav: { ext: 'wav', bytes: 300 }
            }
          })
        ]),
        mediaDir: '/media'
      }
    });

    const bar = () =>
      (getByTestId('player-bar').element() as HTMLElement).getBoundingClientRect().height;
    const empty = bar();

    await getByRole('button', { name: '레인', exact: true }).click();
    await tick();
    const loaded = bar();

    // 실측(Fix Round 3, 이 픽스처로): 빈 바 193px, 포맷 버튼 3개(원본·mp3·
    // wav)와 그 다운로드 링크까지 뜬 선택된 바도 193px — 정확히 일치한다.
    // 포맷 버튼 줄(`ml-auto flex flex-wrap`)이 이 폭(1280px 뷰포트,
    // max-w-6xl 안)에서는 둘째 줄로 넘어가지 않기 때문이다.
    expect(loaded).toBe(empty);
  });
});
