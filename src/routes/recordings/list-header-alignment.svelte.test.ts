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
  return { recordings, tags: [], formats: ['mp3', 'wav'] };
}

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
});
