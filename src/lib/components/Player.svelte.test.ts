import { describe, it, expect, vi, afterEach } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Bookmark, Recording } from '$lib/types';
import Player from './Player.svelte';

function rec(over: Partial<Recording> & { id: string }): Recording {
  return {
    title: '레인',
    description: '',
    tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00',
    durationSec: 120,
    sourceName: `${over.id}.qta`,
    appleAutoTitle: null,
    files: { original: { ext: 'qta', bytes: 100 }, mp3: { bytes: 50 }, wav: { bytes: 200 } },
    bookmarks: [],
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    ...over
  };
}

function bm(id: string, atSec: number, note = '', endSec: number | null = null): Bookmark {
  return { id, atSec, endSec, note };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('input[data-test-loose]').forEach((el) => el.remove());
});

describe('Player.svelte — 녹음 전환 시에만 A-B/위치를 리셋한다', () => {
  it('같은 id를 가진 새 객체로 다시 렌더링해도(관련 없는 목록 갱신) A-B 지정이 지워지지 않는다', async () => {
    const recA = rec({ id: 'aaaa' });
    const screen = render(Player, { recording: recA, formats: ['mp3', 'wav'] });
    await screen;

    await expect.element(page.getByText('레인')).toBeInTheDocument();

    // A 지정 — audio.currentTime은 로드 전이라 0
    await page.getByRole('button', { name: 'A 지정' }).click();
    await expect.element(page.getByText(/^A-B /)).toBeInTheDocument();

    // send()가 recordings 배열을 통째로 새로 받아올 때처럼, 같은 id지만
    // 다른 객체 참조로 다시 렌더링한다(무관한 행 patch를 흉내낸다).
    await screen.rerender({ recording: { ...recA }, formats: ['mp3', 'wav'] });

    // id가 그대로이니 A-B 배지가 그대로 남아 있어야 한다.
    await expect.element(page.getByText(/^A-B /)).toBeInTheDocument();
  });

  it('다른 id로 바뀌면 A-B 지정과 재생 위치를 리셋한다', async () => {
    const recA = rec({ id: 'aaaa' });
    const recB = rec({ id: 'bbbb', title: '정류장' });
    const screen = render(Player, { recording: recA, formats: ['mp3', 'wav'] });
    await screen;

    await page.getByRole('button', { name: 'A 지정' }).click();
    await expect.element(page.getByText(/^A-B /)).toBeInTheDocument();

    await screen.rerender({ recording: recB, formats: ['mp3', 'wav'] });

    await expect.element(page.getByText('정류장')).toBeInTheDocument();
    // 새 녹음으로 넘어갔으니 이전 A-B 배지는 사라져야 한다.
    await expect.element(page.getByText(/^A-B /)).not.toBeInTheDocument();
  });
});

describe('Player.svelte — 입력 필드에 포커스가 있으면 단축키를 무시한다', () => {
  it('Space를 눌러도 제목 입력창 등에 포커스가 있으면 재생을 토글하지 않는다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });
    await screen;

    // 목록 화면의 제목 입력창 같은 요소를 흉내낸다.
    const input = document.createElement('input');
    input.setAttribute('data-test-loose', '1');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

    expect(playSpy).not.toHaveBeenCalled();
  });

  it('입력 필드 밖이면 Space가 재생을 토글한다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });
    await screen;

    // 녹음을 고르면 lastId 이펙트가 즉시 loadState를 'loading'으로
    // 만든다(불러오는 중과 실패 관련 Fix round 1). 그 상태에서는 Space도
    // 재생 버튼과 똑같이 막혀야 하므로(별도 테스트가 그것을 지킨다),
    // 이 테스트가 원래 확인하려는 "불러오는 중이 아닐 때 Space가
    // 토글한다"를 보려면 먼저 canplay로 로딩을 끝내야 한다.
    document.querySelector('audio')!.dispatchEvent(new Event('canplay'));

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    );

    // toggle()은 paused 상태만 뒤집는다 — 실제 play() 호출은
    // bind:paused의 내부 이펙트가 다음 틱에 담당하므로 한 박자 기다린다.
    await vi.waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
  });

  it('배속 select에 포커스가 있으면 Space가 재생을 토글하지 않는다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });

    const select = await page.getByRole('combobox').element();
    (select as HTMLSelectElement).focus();
    select.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

    // "호출 안 됨"은 타이밍에 취약하다(가드가 깨졌다면 toggle()→paused
    // 변경→bind:paused의 내부 effect가 다음 마이크로태스크에 play()를
    // 부른다 — 검사를 너무 일찍 하면 아직 안 불렸을 뿐인데 통과해버린다).
    // 같은 이벤트를 document.body에서 쐈을 때 실제로 감지되는 데
    // 걸리는 시간(위 "Space가 재생을 토글한다" 테스트에서 vi.waitFor로
    // 확인됨, 보통 한 마이크로태스크 이내)보다 넉넉히 긴 시간을 실제로
    // 기다린 뒤에도 호출이 없어야 가드가 진짜로 막았다고 볼 수 있다.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(playSpy).not.toHaveBeenCalled();
  });
});

describe('Player.svelte — 녹음 전환 시 재생 상태 표시가 실제 상태를 따라간다 (Finding 1)', () => {
  it('재생 중 다른 녹음으로 바뀌어 브라우저가 이벤트 없이 paused를 되돌려도, canplay가 오면 토글 버튼이 실제 상태로 맞춰진다', async () => {
    const recA = rec({ id: 'aaaa' });
    const recB = rec({ id: 'bbbb', title: '정류장' });
    const screen = render(Player, { recording: recA, formats: ['mp3', 'wav'] });
    await screen;

    const audioEl = document.querySelector('audio') as HTMLAudioElement;
    const button = () => document.querySelector('.preset-filled-primary-500') as HTMLButtonElement;

    // 녹음을 고르면 lastId 이펙트가 즉시 loadState를 'loading'으로
    // 만들고, audio의 실제 src(/api/media/aaaa/mp3)는 진짜로 요청된다
    // — 이 dev 서버에서 그 요청은 결국 진짜 오류로 끝난다(Fix round
    // 1·2에서 반복 확인). Fix round 2부터 오류 상태는 라벨을 '다시
    // 시도'로 바꾸므로, 그 진짜 오류가 이 테스트 도중 아무 때나
    // 끼어들면 '일시정지'/'재생' 라벨을 가릴 수 있다. 그래서 여기서는
    // retrying assertion으로 뜸을 들이지 않고, canplay를 합성으로
    // 흘려보낸 직후 tick()으로 반응형 플러시만 정확히 기다린 뒤 즉시
    // 확인한다 — 진짜 네트워크 응답은 마이크로태스크 하나보다 훨씬
    // 느리므로 이 시점엔 아직 끼어들 수 없다(같은 기법이 Fix round
    // 2의 '재생 가능해지면 재생 버튼으로 돌아온다' 테스트에도 있다).

    // "재생 중"이었다고 가정한다. 실제 미디어 없이 재생 상태를 흉내내는
    // 표준적인 방법으로 네이티브 paused 게터(읽기 전용 IDL 속성이라
    // 직접 대입은 못 한다)를 스텁하고 play 이벤트를 흉내낸다.
    audioEl.dispatchEvent(new Event('canplay'));
    Object.defineProperty(audioEl, 'paused', { get: () => false, configurable: true });
    audioEl.dispatchEvent(new Event('play'));
    await tick();
    expect(button().textContent?.trim()).toBe('일시정지');

    // 브라우저가 src 재할당(레코딩 전환) 시 HTML 미디어 스펙의 로드
    // 알고리즘 abort 단계를 따라 paused를 이벤트 없이 true로 되돌린다.
    // 뒤이어 canplay만 온다.
    Object.defineProperty(audioEl, 'paused', { get: () => true, configurable: true });
    await screen.rerender({ recording: recB, formats: ['mp3', 'wav'] });
    audioEl.dispatchEvent(new Event('canplay'));
    await tick();

    // pause 이벤트가 한 번도 없었는데도 토글 버튼이 "재생"으로 돌아와야
    // 한다 — onplay/onpause만으로 playing을 관리했다면(예전 구현) 이
    // 지점에서 영원히 "일시정지"로 박제된다.
    expect(button().textContent?.trim()).toBe('재생');
  });
});

describe('Player.svelte — A-B 구간 안전망 (Finding 3)', () => {
  it('A-B 구간이 설정된 채 ended에 도달하면 A로 되감고 이어서 재생한다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });
    await screen;

    const audioEl = document.querySelector('audio') as HTMLAudioElement;

    // A 지정 → B 지정. currentTime은 로드 전이라 항상 0이므로, markLoop의
    // "B가 A보다 앞이면 A+1초로 보정" 경로를 타 loopA=0, loopB=1이 된다.
    await page.getByRole('button', { name: 'A 지정' }).click();
    await page.getByRole('button', { name: 'B 지정' }).click();
    await expect.element(page.getByText(/^A-B /)).toBeInTheDocument();

    Object.defineProperty(audioEl, 'currentTime', { value: 20, writable: true, configurable: true });
    audioEl.dispatchEvent(new Event('ended'));

    expect(audioEl.currentTime).toBe(0); // loopA로 되감김
    expect(playSpy).toHaveBeenCalledTimes(1); // 이어서 재생
  });

  it('A-B 구간이 없으면 ended에서 되감거나 다시 재생하지 않는다', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3', 'wav'] });
    await screen;

    const audioEl = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audioEl, 'currentTime', { value: 20, writable: true, configurable: true });
    audioEl.dispatchEvent(new Event('ended'));

    expect(audioEl.currentTime).toBe(20); // 되감지 않음
    expect(playSpy).not.toHaveBeenCalled(); // 루프 없으니 다시 재생하지 않음
  });
});

describe('Player.svelte — 북마크 버튼: A-B가 잡혀 있으면 구간, 아니면 지점 (Task 16)', () => {
  it('A-B가 잡혀 있지 않으면 현재 위치의 지점 북마크를 만든다', async () => {
    const onbookmark = vi.fn();
    const screen = render(Player, {
      recording: rec({ id: 'aaaa' }),
      formats: ['mp3', 'wav'],
      onbookmark
    });
    await screen;

    await page.getByRole('button', { name: '북마크' }).click();

    expect(onbookmark).toHaveBeenCalledTimes(1);
    // currentTime은 로드 전이라 0 — 지점 북마크는 endSec이 null이어야 한다.
    expect(onbookmark).toHaveBeenCalledWith({ atSec: 0, endSec: null, note: '' });
  });

  it('A-B 구간이 잡혀 있으면 currentTime이 아니라 그 구간을 구간 북마크로 만든다', async () => {
    const onbookmark = vi.fn();
    const screen = render(Player, {
      recording: rec({ id: 'aaaa' }),
      formats: ['mp3', 'wav'],
      onbookmark
    });
    await screen;

    // currentTime은 로드 전이라 항상 0 — markLoop의 "B가 A보다 앞이면
    // A+1초로 보정" 경로를 타 loopA=0, loopB=1이 된다.
    await page.getByRole('button', { name: 'A 지정' }).click();
    await page.getByRole('button', { name: 'B 지정' }).click();
    await page.getByRole('button', { name: '북마크' }).click();

    expect(onbookmark).toHaveBeenCalledTimes(1);
    expect(onbookmark).toHaveBeenCalledWith({ atSec: 0, endSec: 1, note: '' });
  });

  it('구간 북마크를 만들어도 A-B 반복 자체는 해제되지 않는다(구간 배지가 남는다)', async () => {
    const onbookmark = vi.fn();
    const screen = render(Player, {
      recording: rec({ id: 'aaaa' }),
      formats: ['mp3', 'wav'],
      onbookmark
    });
    await screen;

    await page.getByRole('button', { name: 'A 지정' }).click();
    await page.getByRole('button', { name: 'B 지정' }).click();
    await page.getByRole('button', { name: '북마크' }).click();

    // A-B 반복은 저장되지 않는 휘발성 재생 상태다 — 북마크를 만든
    // 것과 별개로 배지가 그대로 남아야 한다(다음 마크 로직에서 "해제"로
    // 넘어가지 않았는지도 함께 확인).
    await expect.element(page.getByText(/^A-B /)).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: '구간 해제' })).toBeInTheDocument();
  });
});

describe('Player.svelte — 북마크 목록 (Task 16)', () => {
  it('북마크가 없으면 메모 입력창을 렌더링하지 않는다', async () => {
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks: [] }),
      formats: ['mp3', 'wav']
    });
    await screen;

    await expect.element(page.getByPlaceholder('메모')).not.toBeInTheDocument();
  });

  it('데이터 순서와 무관하게 시작 시각(atSec) 오름차순으로 보여준다', async () => {
    const bookmarks = [bm('c', 30, '세번째'), bm('a', 5, '첫번째'), bm('b', 15, '두번째')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav']
    });
    await screen;

    const notes = Array.from(document.querySelectorAll('input[placeholder="메모"]')).map(
      (el) => (el as HTMLInputElement).value
    );
    expect(notes).toEqual(['첫번째', '두번째', '세번째']);
  });

  it('목록 칩에 표시되는 시각 배지는 지점은 하나, 구간은 시작–끝을 보여준다', async () => {
    const bookmarks = [bm('a', 65, '지점'), { id: 'b', atSec: 5, endSec: 12, note: '구간' }];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav']
    });
    await screen;

    await expect.element(page.getByRole('button', { name: '1:05' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: '0:05–0:12' })).toBeInTheDocument();
  });
});

describe('Player.svelte — 북마크 메모 입력 중에는 B 단축키가 안 먹는다 (Task 16)', () => {
  it('메모 입력창에 포커스가 있으면 B를 눌러도 새 북마크를 만들지 않는다', async () => {
    const onbookmark = vi.fn();
    const bookmarks = [bm('a', 5, '메모')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmark
    });
    await screen;

    const input = document.querySelector('input[placeholder="메모"]') as HTMLInputElement;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', bubbles: true, cancelable: true }));

    expect(onbookmark).not.toHaveBeenCalled();
  });
});

describe('Player.svelte — 북마크 메모 편집·삭제 (Task 16)', () => {
  it('메모 입력에서 blur하면 그 항목의 note만 바뀐 전체 배열로 onbookmarkchange를 부른다', async () => {
    const onbookmarkchange = vi.fn();
    const bookmarks = [bm('a', 5, '원래'), bm('b', 15, '그대로')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    await page.getByPlaceholder('메모').first().fill('새 메모');
    // 이 컴포넌트에는 blur 전용 API가 없으니, 편집 중인 입력 밖의 다른
    // 요소를 눌러 실제 blur를 일으킨다(+page.svelte 테스트와 같은 패턴).
    await page.getByText('레인').click();

    expect(onbookmarkchange).toHaveBeenCalledTimes(1);
    expect(onbookmarkchange).toHaveBeenCalledWith([
      { id: 'a', atSec: 5, endSec: null, note: '새 메모' },
      { id: 'b', atSec: 15, endSec: null, note: '그대로' }
    ]);
  });

  it('삭제 버튼을 누르면 그 항목만 뺀 전체 배열로 onbookmarkchange를 부른다', async () => {
    const onbookmarkchange = vi.fn();
    const bookmarks = [bm('a', 5, '남음'), bm('b', 15, '지워짐')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    await page.getByRole('button', { name: '북마크 삭제' }).nth(1).click();

    expect(onbookmarkchange).toHaveBeenCalledTimes(1);
    expect(onbookmarkchange).toHaveBeenCalledWith([{ id: 'a', atSec: 5, endSec: null, note: '남음' }]);
  });

  it('메모를 두 번 연달아 편집하면, 첫 번째 결과를 기다리지 않고 매번 onbookmarkchange를 부른다', async () => {
    // 이 테스트는 실패/에러 처리 자체는 검증하지 않는다(그건 아래
    // "실패하면 낙관적 갱신을 되돌린다" describe와 +page.svelte 쪽
    // 에러 카드 테스트가 맡는다) — 여기서는 한 번 호출했다고 다음
    // 편집을 막거나 조용히 삼키지 않는다는 것만 확인한다.
    const calls: Bookmark[][] = [];
    const onbookmarkchange = (b: Bookmark[]) => {
      calls.push(b);
    };
    const bookmarks = [bm('a', 5, '원래')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    await page.getByPlaceholder('메모').fill('첫 시도');
    await page.getByText('레인').click();
    await page.getByPlaceholder('메모').fill('두번째 시도');
    await page.getByText('레인').click();

    expect(calls).toHaveLength(2);
    expect(calls[0][0].note).toBe('첫 시도');
    expect(calls[1][0].note).toBe('두번째 시도');
  });
});

describe('Player.svelte — 편집·삭제가 실패하면 낙관적 갱신을 되돌린다 (후속 리뷰 대응)', () => {
  // onbookmarkchange가 언제 resolve될지 테스트에서 직접 제어하기 위한
  // 헬퍼. "응답이 오기 전엔 낙관적 값이 보이고, 실패 응답이 오면
  // 되돌아간다"를 순서대로 확인하려면 즉시 resolve되는 mock으로는 그
  // 중간 상태를 볼 수 없다.
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  function noteInputs(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll('input[placeholder="메모"]'));
  }

  it('메모 편집이 실패하면(onbookmarkchange가 false로 resolve) 입력값이 원래 메모로 되돌아간다', async () => {
    const d = deferred<boolean>();
    const onbookmarkchange = vi.fn((_: Bookmark[]) => d.promise);
    const bookmarks = [bm('a', 5, '원래 메모')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    await page.getByPlaceholder('메모').fill('실패할 메모');
    await page.getByText('레인').click();

    // 응답을 기다리는 동안에는 낙관적으로 반영해둔 값이 그대로 보인다.
    expect(noteInputs()[0].value).toBe('실패할 메모');

    d.resolve(false);

    await vi.waitFor(() => expect(noteInputs()[0].value).toBe('원래 메모'));
  });

  it('삭제가 실패하면(onbookmarkchange가 false로 resolve) 지운 항목이 다시 나타난다', async () => {
    const d = deferred<boolean>();
    const onbookmarkchange = vi.fn((_: Bookmark[]) => d.promise);
    const bookmarks = [bm('a', 5, '남는다')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    await page.getByRole('button', { name: '북마크 삭제' }).click();
    await expect.element(page.getByPlaceholder('메모')).not.toBeInTheDocument();

    d.resolve(false);

    await expect.element(page.getByPlaceholder('메모')).toBeInTheDocument();
    expect(noteInputs()[0].value).toBe('남는다');
  });

  it('삭제가 실패하기 전에 그 항목이 이미(다른 경로로) 되살아나 있으면, 실패 응답이 와도 중복으로 다시 추가하지 않는다(후속 리뷰: 삭제 경로에도 같은 compare-and-swap)', async () => {
    const d = deferred<boolean>();
    const onbookmarkchange = vi.fn((_: Bookmark[]) => d.promise);
    const bookmarks = [bm('a', 5, '항목')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    await page.getByRole('button', { name: '북마크 삭제' }).click();
    await expect.element(page.getByPlaceholder('메모')).not.toBeInTheDocument();

    // 삭제 PATCH가 아직 응답을 기다리는 사이, 이 녹음의 bookmarks
    // 프롭이 (다른 경로로 — 예: send()가 recordings 전체를 새로
    // 받아온 뒤 selected/recording이 새 참조가 될 때) 그 항목이 여전히
    // 있는 상태로 갱신됐다고 가정한다. localBookmarks는 id로
    // 게이트하지 않고 recording.bookmarks 참조가 바뀔 때마다
    // 다시 맞추므로(50~69번째 줄 주석 참고), 이 rerender만으로
    // 그 항목이 되살아난다.
    const recStillHasIt = rec({ id: 'aaaa', bookmarks: [bm('a', 5, '항목')] });
    await screen.rerender({ recording: recStillHasIt, formats: ['mp3', 'wav'], onbookmarkchange });
    await expect.element(page.getByPlaceholder('메모')).toBeInTheDocument();

    // 이제야 삭제가 실패 응답을 받는다 — 무조건 다시 추가하는
    // 구현이었다면 이미 있는 항목 옆에 똑같은 항목을 하나 더 추가해
    // 중복을 만든다. 다만 이 테스트 자체는 그 뮤테이션을 증명하는 데
    // 못 쓴다 — 직접 확인해보니, 무조건 다시 추가하는 구현으로
    // 되돌리면 Svelte의 keyed each가 중복 id를 런타임 에러
    // (each_key_duplicate)로 거부해 DOM에 중복이 아예 렌더링되지
    // 않고, 그래서 이 length assertion이 "우연히" 계속 통과해버린다
    // (에러로 막힌 것과 로직이 막은 것을 구분 못 함 — 뮤테이션으로
    // 실제 확인함). 그래서 이 compare-and-swap의 뮤테이션 검증은
    // restoreIfAbsent를 직접 겨냥한 player.test.ts에서 하고, 여기서는
    // "정상 구현이 실제로 이 흐름을 깨지 않고 통과한다"는 것만 하는
    // 스모크 테스트로 남긴다.
    d.resolve(false);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(noteInputs()).toHaveLength(1);
  });

  it('삭제 응답을 기다리는 사이 다른 녹음으로 옮겼으면, 늦게 온 실패가 그 녹음의 목록에 남의 북마크를 얹지 않는다', async () => {
    // restoreIfAbsent는 "이 id가 없으면 넣는다"라 되돌리기가 어느
    // 녹음의 목록 위에서 도는지를 따지지 않으면, A에서 지운 북마크가
    // B의 목록에 실제로 얹힌다. 거기서 B를 한 번만 편집해도 남의
    // 북마크가 B의 녹음에 저장된다.
    const d = deferred<boolean>();
    const onbookmarkchange = vi.fn((_: Bookmark[]) => d.promise);
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks: [bm('a', 5, 'A의 북마크')] }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    await page.getByRole('button', { name: '북마크 삭제' }).click();
    await expect.element(page.getByPlaceholder('메모')).not.toBeInTheDocument();

    // 응답이 오기 전에 사용자가 다른 행을 눌러 B로 옮긴다.
    const recB = rec({ id: 'bbbb', bookmarks: [] });
    await screen.rerender({ recording: recB, formats: ['mp3', 'wav'], onbookmarkchange });

    // 이제야 A의 삭제가 실패한다. 소속 녹음을 안 보는 구현이면 여기서
    // 'A의 북마크'가 B의 목록에 나타난다.
    d.resolve(false);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(noteInputs()).toHaveLength(0);
  });

  it('한 편집이 실패해 되돌아가도, 그 사이 성공한 다른 편집의 결과는 지우지 않는다', async () => {
    const dA = deferred<boolean>();
    const dB = deferred<boolean>();
    let call = 0;
    const onbookmarkchange = vi.fn(() => (call++ === 0 ? dA.promise : dB.promise));
    const bookmarks = [bm('a', 5, '원래a'), bm('b', 15, '원래b')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    const inputs = noteInputs();
    expect(inputs).toHaveLength(2);

    // a를 편집(나중에 실패 응답을 받을 예정), 응답이 오기 전에 b도
    // 편집(나중에 성공 응답을 받을 예정) — 두 blur를 await 없이
    // 연달아 일으켜, 두 PATCH가 동시에 떠 있는 상황을 재현한다.
    inputs[0].value = '실패할 편집';
    inputs[0].dispatchEvent(new Event('blur'));
    inputs[1].value = '성공할 편집';
    inputs[1].dispatchEvent(new Event('blur'));

    // b가 먼저 성공 응답을 받는다.
    dB.resolve(true);
    await vi.waitFor(() => expect(noteInputs()[1].value).toBe('성공할 편집'));

    // 그 다음에야 a가 실패 응답을 받는다.
    dA.resolve(false);
    await vi.waitFor(() => expect(noteInputs()[0].value).toBe('원래a'));

    // a의 되돌림이 이미 성공해 반영된 b의 편집까지 지우면 안 된다 —
    // 되돌리기가 실패 시점의 낡은 스냅샷이 아니라 "지금의"
    // localBookmarks 위에서 이 항목 하나만 되돌리는지가 이 assertion의
    // 핵심이다.
    expect(noteInputs()[1].value).toBe('성공할 편집');
  });

  it('같은 항목에 대한 두 편집 중 먼저 성공한 게 이겼는데, 나중에 실패 응답이 온 편집이 그 확정된 값을 덮어쓰면 안 된다(후속 리뷰 재발견)', async () => {
    // 위 테스트와 같은 모양이지만 서로 다른 두 항목(a, b)이 아니라
    // "같은 항목 하나"에 대한 두 번의 편집이다 — compare-and-swap이
    // 되돌릴 값을 무조건 자기 자신의 oldNote로 덮어쓰는 게 아니라,
    // "지금도 내가 쓴 값 그대로일 때만" 되돌리는지는 같은 id를 두 번
    // 건드려봐야 드러난다(다른 id끼리는 애초에 서로의 값을 참조하지
    // 않으니 이 버그가 나타날 수 없다).
    const dH1 = deferred<boolean>();
    const dH2 = deferred<boolean>();
    let call = 0;
    const onbookmarkchange = vi.fn(() => (call++ === 0 ? dH1.promise : dH2.promise));
    const bookmarks = [bm('a', 5, 'N0')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    const input = noteInputs()[0];

    // H1: N0 -> N1. blur를 일으켜 캡처(oldNote="N0")·낙관적 반영·
    // PATCH 전송까지 동기적으로 끝내고, await에서 멈춘다.
    input.value = 'N1';
    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('N1');

    // H2: 같은 입력에 이어서 N1 -> N2. H1의 응답이 아직 안 왔으므로
    // 이 시점에 읽는 "이전 값"은 H1이 낙관적으로 남겨둔 "N1"이다.
    input.value = 'N2';
    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('N2');

    // H2가 먼저 성공 응답을 받는다 — 서버가 N2에 동의했다.
    dH2.resolve(true);
    await vi.waitFor(() => expect(noteInputs()[0].value).toBe('N2'));

    // H1이 뒤늦게 실패 응답을 받는다. H1이 시도했던 값은 "N1"인데
    // 지금 이 항목은 이미 "N2"다 — compare-and-swap이 이 불일치를
    // 보고 되돌리기를 건너뛰어야 한다. 무조건 되돌리는 구현이었다면
    // 여기서 "N0"(H1의 oldNote)로 되돌아가 서버 상태(N2)와 어긋난다.
    dH1.resolve(false);

    // 실패 이후에도 값이 그대로 "N2"로 남아 있는지 확인한다 — "아무
    // 일도 안 일어남"을 증명해야 하므로 waitFor가 아니라, 잘못된
    // 구현이라면 되돌리기가 반영됐을 시간을 실제로 준 뒤(다른
    // "호출 안 됨" 검증들과 같은 패턴) 최종 상태를 확인한다.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(noteInputs()[0].value).toBe('N2');
    expect(onbookmarkchange).toHaveBeenCalledTimes(2);
  });

  it('되돌린 뒤에도 다시 편집해서 성공하면 정상 반영된다(사본이 어긋난 채로 멈추지 않는다)', async () => {
    let nextResult = false;
    const onbookmarkchange = vi.fn(async (_: Bookmark[]) => nextResult);
    const bookmarks = [bm('a', 5, '원래')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    // 첫 시도는 실패 -> 되돌아간다.
    await page.getByPlaceholder('메모').fill('첫 시도(실패)');
    await page.getByText('레인').click();
    await vi.waitFor(() => expect(noteInputs()[0].value).toBe('원래'));

    // 두 번째 시도는 성공 -> 이번엔 그 값 그대로 남아야 한다(되돌리기
    // 로직이 성공한 편집까지 되돌리면 안 된다).
    nextResult = true;
    await page.getByPlaceholder('메모').fill('두번째 시도(성공)');
    await page.getByText('레인').click();
    await vi.waitFor(() => expect(noteInputs()[0].value).toBe('두번째 시도(성공)'));

    expect(onbookmarkchange).toHaveBeenCalledTimes(2);
    expect(onbookmarkchange.mock.calls[1][0]).toEqual([
      { id: 'a', atSec: 5, endSec: null, note: '두번째 시도(성공)' }
    ]);
  });
});

describe('Player.svelte — 연달아 편집해도 앞선 편집을 잃지 않는다 (Task 16, 네 가지 중 #4)', () => {
  it('recording.bookmarks 프롭이 아직 갱신되기 전에 두 번째 편집이 시작돼도, 두 번째 onbookmarkchange 호출에 두 편집이 모두 담긴다', async () => {
    const onbookmarkchange = vi.fn();
    const bookmarks = [bm('a', 5, '원래a'), bm('b', 15, '원래b')];
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks }),
      formats: ['mp3', 'wav'],
      onbookmarkchange
    });
    await screen;

    const inputs = Array.from(
      document.querySelectorAll('input[placeholder="메모"]')
    ) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);

    // 실제 앱에서는 blur가 부모의 send()를 통해 비동기 PATCH를 보내고,
    // recording 프롭은 그 응답이 돌아와야(await 이후) 갱신된다. Player
    // 자신은 onbookmarkchange를 동기 콜백으로만 부르므로, 두 blur를
    // await 없이 연달아 일으키는 것만으로 "두 번째 편집이 첫 번째
    // 응답보다 먼저 시작"하는 상황을 그대로 재현한다 — 그 사이
    // recording.bookmarks(프롭)가 갱신될 기회 자체가 없다.
    inputs[0].value = '수정a';
    inputs[0].dispatchEvent(new Event('blur'));
    inputs[1].value = '수정b';
    inputs[1].dispatchEvent(new Event('blur'));

    expect(onbookmarkchange).toHaveBeenCalledTimes(2);
    // 첫 번째 호출은 a만 바뀐 배열이어야 한다.
    expect(onbookmarkchange.mock.calls[0][0]).toEqual([
      { id: 'a', atSec: 5, endSec: null, note: '수정a' },
      { id: 'b', atSec: 15, endSec: null, note: '원래b' }
    ]);
    // 두 번째 호출: recording.bookmarks(프롭)는 이 시점까지도 그대로인데,
    // a의 수정이 여전히 살아 있어야 한다 — 프롭을 그대로 베이스로
    // 삼았다면(로컬 사본 없이) 여기서 a가 '원래a'로 되돌아가 있을 것이다.
    expect(onbookmarkchange.mock.calls[1][0]).toEqual([
      { id: 'a', atSec: 5, endSec: null, note: '수정a' },
      { id: 'b', atSec: 15, endSec: null, note: '수정b' }
    ]);
  });
});

describe('Player.svelte — 재생 중인 파일의 저장 경로', () => {
  it('선택된 포맷의 절대 경로를 보여준다', async () => {
    render(Player, {
      recording: rec({
        id: 'a1b2',
        files: { original: { ext: 'qta', bytes: 1 }, mp3: { bytes: 2 } }
      }),
      formats: ['mp3', 'wav'],
      mediaDir: '/srv/media'
    });

    // 줄여서 보여주더라도 전체 경로는 title에 남아야 한다 — 줄인
    // 문자열만 있으면 사용자가 실제 위치를 알 방법이 없다.
    const el = await page.getByTitle('/srv/media/mp3/a1b2.mp3').element();
    expect(el).toBeTruthy();
  });

  it('재생 중인 녹음이 없으면 경로를 보여주지 않는다', async () => {
    render(Player, { recording: null, formats: ['mp3'], mediaDir: '/srv/media' });

    expect(document.body.textContent).not.toContain('/srv/media');
  });

  it('original 포맷은 files의 ext를 써서 경로를 만든다', async () => {
    // 변환본은 포맷 이름이 곧 확장자지만 original은 아니다 — 여기서
    // 규칙이 어긋나면 화면이 없는 파일을 가리킨다.
    render(Player, {
      recording: rec({ id: 'a1b2', files: { original: { ext: 'qta', bytes: 1 } } }),
      formats: ['original'],
      mediaDir: '/srv/media'
    });

    const el = await page.getByTitle('/srv/media/original/a1b2.qta').element();
    expect(el).toBeTruthy();
  });

  it('경로가 60자를 넘어도 title에는 줄이지 않은 전체 경로가 남는다', async () => {
    // 위 테스트들은 경로가 60자 이하라 title이 줄인 문자열이든 전체
    // 경로든 값이 같아 title={middleEllipsis(filePath, 60)}로 바꿔도
    // 통과해버린다(뮤테이션으로 실제 확인함 — task-2-report.md 참고).
    // filePath가 60자를 넘도록 mediaDir를 충분히 길게 잡아, title이
    // 실제로 줄지 않았는지를 이 테스트가 구분하게 한다.
    const longMediaDir = '/Volumes/ExternalStorage/voice-recordings/uls-media-archive-2026';
    const fullPath = `${longMediaDir}/mp3/a1b2.mp3`;
    expect(fullPath.length).toBeGreaterThan(60);

    render(Player, {
      recording: rec({ id: 'a1b2', files: { mp3: { bytes: 2 } } }),
      formats: ['mp3', 'wav'],
      mediaDir: longMediaDir
    });

    const el = await page.getByTitle(fullPath).element();
    expect(el).toBeTruthy();
    // 화면에 보이는 텍스트는 줄어든 문자열이어야 한다 — 그렇지 않으면
    // title도 어차피 같은 문자열이라는 우연으로 위 단언이 통과했을 수
    // 있다.
    expect(el.textContent).not.toBe(fullPath);
  });
});

describe('Player.svelte — 파형 마커가 북마크 목록과 같은 데이터를 보여준다 (Task 16)', () => {
  it('북마크를 추가하면(props 갱신) 파형에도 같은 메모의 마커가 뜬다', async () => {
    // 처음엔 이 녹음에 북마크가 없다 — 마커도, 목록도 없어야 한다.
    const screen = render(Player, {
      recording: rec({ id: 'aaaa', bookmarks: [] }),
      formats: ['mp3', 'wav']
    });
    await screen;
    await expect.element(page.getByRole('button', { name: /마커메모/ })).not.toBeInTheDocument();

    // send()가 PATCH 응답으로 recordings 전체를 새 참조로 덮어쓸 때와
    // 같은 모양으로 프롭을 갱신한다(같은 id, 다른 객체 참조, bookmarks
    // 배열도 새 참조) — Waveform.svelte가 마커를 aria-label="북마크:
    // {note}"인 버튼으로 렌더링한다. 목록의 메모 입력과 같은 데이터
    // (localBookmarks)에서 나온다는 걸, 목록에 없던 마커가 이 프롭
    // 변화만으로(별도 조작 없이) 나타나는지로 확인한다.
    const withBookmark = rec({ id: 'aaaa', bookmarks: [bm('a', 30, '마커메모')] });
    await screen.rerender({ recording: withBookmark, formats: ['mp3', 'wav'] });

    await expect.element(page.getByRole('button', { name: /마커메모/ })).toBeInTheDocument();
  });
});

describe('Player.svelte — 불러오는 중과 실패', () => {
  /** 렌더된 <audio>에 실제 미디어 이벤트를 흘려보낸다. */
  function audioEl(): HTMLAudioElement {
    const el = document.querySelector('audio');
    if (!el) throw new Error('audio 엘리먼트가 없다');
    return el as HTMLAudioElement;
  }

  it('불러오기가 시작되면 재생 버튼 자리에 진행 표시가 뜨고 누를 수 없다', async () => {
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));

    await expect.element(page.getByRole('button', { name: '불러오는 중' })).toBeDisabled();
  });

  it('불러오는 중에는 스페이스를 눌러도 토글되지 않는다', async () => {
    // 버튼은 disabled로 "지금은 누를 수 없다"고 말하는데, 전역 Space
    // 단축키는 이 버튼을 거치지 않고 toggle()을 직접 부른다 — 버튼만
    // 막고 단축키를 그대로 두면 그 말이 키보드에는 적용되지 않는다.
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));
    await expect.element(page.getByRole('button', { name: '불러오는 중' })).toBeDisabled();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    );

    // toggle()이 불렸다면 bind:paused의 내부 이펙트가 다음 틱에 play()를
    // 부른다(위 "Space가 재생을 토글한다" 테스트와 같은 지연). 그 지연을
    // 넉넉히 기다려도 끝내 불리지 않아야 한다는 것을, 같은 vi.waitFor가
    // 결국 타임아웃으로 거부하는 것으로 확인한다.
    await expect(
      vi.waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1), { timeout: 300 })
    ).rejects.toThrow();
  });

  it('재생 가능해지면 재생 버튼으로 돌아온다', async () => {
    // '재생' 라벨만으로는 ready와 error를 구분할 수 없다 — 버튼은
    // loadState==='loading'일 때만 다른 라벨('불러오는 중')을 쓰고, ready와
    // error는 둘 다 '재생'으로 렌더링된다(오류는 옆의 별도 문구로만
    // 드러난다). audio가 실제로 가리키는 /api/media/aaaa/mp3는 (테스트를
    // 띄우는 dev 서버에서) 진짜로 요청되고, 얼마 뒤 진짜 404로 응답해
    // 실제 error 이벤트가 도착한다 — 도착하면 onerror가 loadState를
    // 'error'로 덮어써, retrying assertion(expect.element/vi.waitFor)으로
    // 뜸을 들이면 canplay 처리 여부와 무관하게 결국 그 실제 오류를
    // 관찰하고 실패한다(직접 재현해 확인함 — task-2-report.md 참고).
    // 그래서 여기서는 뜸을 들이지 않는다 — tick()으로 Svelte의 반응형
    // 플러시(마이크로태스크 한 번)만 정확히 기다린 뒤 바로 확인한다.
    // 진짜 네트워크 응답은 실제 IPC·네트워크 스택을 거치므로 마이크로
    // 태스크보다 훨씬 느려 이 시점엔 아직 도착할 수 없다 — canplay를
    // 처리하지 않았다면(뮤테이션) 이 시점에도 여전히 '불러오는 중'이고,
    // 처리했다면 이미 '재생'이다.
    const button = () => document.querySelector('.preset-filled-primary-500') as HTMLButtonElement;
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));
    audioEl().dispatchEvent(new Event('canplay'));
    await tick();

    expect(button().textContent?.trim()).toBe('재생');
    expect(document.body.textContent).not.toContain('불러오지 못했습니다');
  });

  it('불러오기가 실패하면 실패했다고 보여준다', async () => {
    // 지금은 <audio>에 error 핸들러가 아예 없어서, 파일을 못 읽어도
    // 화면은 조용히 '재생' 버튼만 보여준다 — 눌러도 아무 일이 없다.
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));
    audioEl().dispatchEvent(new Event('error'));

    await expect.element(page.getByText('불러오지 못했습니다')).toBeInTheDocument();
  });

  it('실패 상태에서 버튼을 누르면 리소스를 다시 불러온다(다시 시도)', async () => {
    // 기준: loadState가 다시 'loading'으로 바뀌는 것만으로는 부족하다
    // — 실제로 리소스를 다시 받아오는지가 판정 기준이다(Fix round 2).
    // audio.load()가 미디어 로드 알고리즘을 다시 돌리는 유일한 방법이라
    // 실제로 불렸는지를 스파이로 직접 확인한다. 네트워크까지 진짜로
    // 나가게 두면(=스파이에서 흉내내지 않으면) dev 서버로 실제 요청이
    // 나가 이 테스트의 목적과 무관한 시간차가 생기므로 no-op으로 막는다.
    const loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));
    audioEl().dispatchEvent(new Event('error'));
    await expect.element(page.getByText('불러오지 못했습니다')).toBeInTheDocument();

    // 라벨 자체가 '다시 시도'로 바뀌어 있어야 한다 — '재생'인 채로
    // 두면(그런데 눌러도 리소스를 다시 안 받아오면) 라벨이 약속하는
    // 동작과 실제 동작이 어긋난다.
    await page.getByRole('button', { name: '다시 시도' }).click();

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('실패 상태에서는 스페이스도 버튼과 같이 다시 시도한다', async () => {
    // Fix round 1에서 Space를 버튼과 같은 조건(로딩 중엔 막는다)으로
    // 맞췄던 것과 같은 이유로, 오류 상태의 동작(다시 시도)도 버튼과
    // 키보드가 같아야 한다 — 그러지 않으면 버튼을 고쳐도 키보드로는
    // 여전히 이미 실패한 리소스에 play()만 다시 시도하는(고쳐지지 않는)
    // 경로가 남는다.
    const loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));
    audioEl().dispatchEvent(new Event('error'));
    await expect.element(page.getByText('불러오지 못했습니다')).toBeInTheDocument();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    );

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('실패 상태에서 다시 시도를 눌러도 스스로 재생을 시작하지 않는다', async () => {
    // retry()는 리소스만 다시 불러올 뿐 재생을 요청하지 않는다 —
    // 사용자가 요청하지 않은 자동 재생이 섞여 들어오면 안 된다.
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));
    audioEl().dispatchEvent(new Event('error'));
    await expect.element(page.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();

    await page.getByRole('button', { name: '다시 시도' }).click();

    expect(playSpy).not.toHaveBeenCalled();
  });

  it('재생 중 실패했다가 다시 시도로 복구되면 재생 버튼이 실제 상태를 따라간다(일시정지에 박제되지 않는다)', async () => {
    // load()를 no-op으로 막아 이 테스트가 진짜 네트워크 타이밍과 겨루지
    // 않게 한다 — 오직 합성 이벤트만으로 상태를 결정한다.
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));
    audioEl().dispatchEvent(new Event('canplay'));
    await expect.element(page.getByRole('button', { name: '재생' })).toBeInTheDocument();

    // "재생 중"이었다고 가정한다 — 위 Finding 1 테스트와 같은 방식으로
    // 읽기 전용 paused 게터를 스텁하고 play 이벤트를 흉내낸다.
    Object.defineProperty(audioEl(), 'paused', { get: () => false, configurable: true });
    audioEl().dispatchEvent(new Event('play'));
    await expect.element(page.getByRole('button', { name: '일시정지' })).toBeInTheDocument();

    // 재생 중 실패한다.
    audioEl().dispatchEvent(new Event('error'));
    await expect.element(page.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();

    // 다시 시도 -> 실제 load()가 리소스를 다시 받아오면, 브라우저는
    // "다른 녹음으로 전환" 때와 같은 abort 경로로 재생을 이벤트 없이
    // 끊는다(paused가 이벤트 없이 true로 돌아간다). 뒤이어 canplay만
    // 온다 — 이 흐름을 흉내낸다.
    Object.defineProperty(audioEl(), 'paused', { get: () => true, configurable: true });
    await page.getByRole('button', { name: '다시 시도' }).click();
    audioEl().dispatchEvent(new Event('canplay'));

    // pause 이벤트가 한 번도 없었는데도 '일시정지'에 박제되지 않고
    // 실제 상태(멈춤)를 따라 '재생'으로 돌아와야 한다.
    await expect.element(page.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });

  it('다른 녹음으로 바꾸면 실패 표시가 남지 않는다', async () => {
    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });
    audioEl().dispatchEvent(new Event('error'));
    await expect.element(page.getByText('불러오지 못했습니다')).toBeInTheDocument();

    await screen.rerender({ recording: rec({ id: 'bbbb', title: '정류장' }), formats: ['mp3'] });

    expect(document.body.textContent).not.toContain('불러오지 못했습니다');
  });
});
