import { describe, it, expect, vi, afterEach } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
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

    // "재생 중"이었다고 가정한다. 실제 미디어 없이 재생 상태를 흉내내는
    // 표준적인 방법으로 네이티브 paused 게터(읽기 전용 IDL 속성이라
    // 직접 대입은 못 한다)를 스텁하고 play 이벤트를 흉내낸다.
    Object.defineProperty(audioEl, 'paused', { get: () => false, configurable: true });
    audioEl.dispatchEvent(new Event('play'));
    await expect.element(page.getByRole('button', { name: '일시정지' })).toBeInTheDocument();

    // 브라우저가 src 재할당(레코딩 전환) 시 HTML 미디어 스펙의 로드
    // 알고리즘 abort 단계를 따라 paused를 이벤트 없이 true로 되돌린다.
    // 뒤이어 canplay만 온다.
    Object.defineProperty(audioEl, 'paused', { get: () => true, configurable: true });
    await screen.rerender({ recording: recB, formats: ['mp3', 'wav'] });
    audioEl.dispatchEvent(new Event('canplay'));

    // pause 이벤트가 한 번도 없었는데도 토글 버튼이 "재생"으로 돌아와야
    // 한다 — onplay/onpause만으로 playing을 관리했다면(예전 구현) 이
    // 지점에서 영원히 "일시정지"로 박제된다.
    await expect.element(page.getByRole('button', { name: '재생' })).toBeInTheDocument();
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
