import { describe, it, expect, vi } from 'vitest';
import {
  ratioFromClick,
  barCount,
  bucketMax,
  markLoop,
  loopWrapTarget,
  restorePlaybackPosition,
  bookmarkDraft,
  sortBookmarks,
  withBookmarkNote,
  withoutBookmark,
  type LoopState
} from './player';

// isTypingTarget은 HTMLElement/document가 필요해 이 파일(node 환경)이
// 아니라 player.svelte.test.ts(브라우저 프로젝트)에서 검증한다.

describe('ratioFromClick — 파형 클릭 좌표를 0~1 진행률로', () => {
  it('가운데를 클릭하면 0.5', () => {
    expect(ratioFromClick(150, 100, 100)).toBe(0.5);
  });

  it('왼쪽 바깥을 클릭해도 0으로 clamp', () => {
    expect(ratioFromClick(0, 100, 100)).toBe(0);
  });

  it('오른쪽 바깥을 클릭해도 1로 clamp', () => {
    expect(ratioFromClick(500, 100, 100)).toBe(1);
  });

  it('폭이 0이면 0을 반환(0으로 나누기 방지)', () => {
    expect(ratioFromClick(50, 0, 0)).toBe(0);
  });
});

describe('barCount — 폭에 들어가는 막대 개수', () => {
  it('막대폭 2 + 간격 1일 때 폭 300이면 막대 100개', () => {
    expect(barCount(300, 2, 1)).toBe(100);
  });

  it('나누어떨어지지 않으면 내림', () => {
    expect(barCount(10, 2, 1)).toBe(3); // 10 / 3 = 3.33 -> 3
  });

  it('폭이 0 이하면 0', () => {
    expect(barCount(0)).toBe(0);
    expect(barCount(-5)).toBe(0);
  });
});

describe('bucketMax — peaks를 막대 개수로 묶어 최댓값 추출', () => {
  it('막대 하나당 여러 peak 중 최댓값을 고른다', () => {
    // 10개 peaks를 막대 5개로 묶으면 막대당 2개씩
    const peaks = [0.1, 0.9, 0.2, 0.2, 0.05, 0.05, 0.4, 0.4, 0.7, 0.1];
    expect(bucketMax(peaks, 5, 0)).toBe(0.9); // [0.1, 0.9]
    expect(bucketMax(peaks, 5, 1)).toBe(0.2); // [0.2, 0.2]
    expect(bucketMax(peaks, 5, 4)).toBe(0.7); // [0.7, 0.1]
  });

  it('peaks가 비어 있으면 0', () => {
    expect(bucketMax([], 10, 0)).toBe(0);
  });

  it('bars가 0 이하면 0', () => {
    expect(bucketMax([0.5], 0, 0)).toBe(0);
  });

  it('막대 개수가 peaks보다 많으면(버킷 폭 < 1) 바닥 나눗셈으로 빈 버킷이 생기고 0을 돌려준다', () => {
    // per = 2/10 = 0.2. barIndex 0: floor(0)=0, floor(0.2)=0 → 반개구간이
    // 비어 원소를 하나도 못 읽는다.
    const peaks = [0.3, 0.9];
    expect(bucketMax(peaks, 10, 0)).toBe(0);
  });

  it('마지막 막대도 peaks 배열 끝을 넘지 않는다(경계 밖 인덱스를 읽지 않는다)', () => {
    // per = 3/7이 부동소수점 오차로 7*per가 3을 살짝 넘을 수 있어도,
    // j < peaks.length 가드가 peaks[3](undefined)을 읽지 않게 막는다.
    const peaks = [0.1, 0.2, 0.9];
    expect(() => bucketMax(peaks, 7, 6)).not.toThrow();
    expect(bucketMax(peaks, 7, 6)).toBeLessThanOrEqual(0.9);
    expect(bucketMax(peaks, 7, 6)).toBeGreaterThanOrEqual(0);
  });
});

describe('markLoop — A-B 반복 지정 상태 전이', () => {
  it('처음 누르면 A를 지정한다', () => {
    const s: LoopState = { loopA: null, loopB: null };
    expect(markLoop(s, 10)).toEqual({ loopA: 10, loopB: null });
  });

  it('A가 있고 B가 없으면 B를 지정한다', () => {
    const s: LoopState = { loopA: 10, loopB: null };
    expect(markLoop(s, 20)).toEqual({ loopA: 10, loopB: 20 });
  });

  it('B가 A보다 앞이면 A+1초로 보정한다', () => {
    const s: LoopState = { loopA: 10, loopB: null };
    expect(markLoop(s, 5)).toEqual({ loopA: 10, loopB: 11 });
  });

  it('B가 A와 같아도 A+1초로 보정한다(빈 구간 방지)', () => {
    const s: LoopState = { loopA: 10, loopB: null };
    expect(markLoop(s, 10)).toEqual({ loopA: 10, loopB: 11 });
  });

  it('A·B가 모두 있으면 눌렀을 때 해제하고 새 A를 지정한다(순환)', () => {
    const s: LoopState = { loopA: 10, loopB: 20 };
    expect(markLoop(s, 30)).toEqual({ loopA: 30, loopB: null });
  });
});

describe('loopWrapTarget — A-B 구간을 지나면 되돌아갈 지점', () => {
  it('A·B가 모두 있고 현재 위치가 B 이상이면 A를 반환한다', () => {
    expect(loopWrapTarget(20, { loopA: 5, loopB: 20 })).toBe(5);
    expect(loopWrapTarget(25, { loopA: 5, loopB: 20 })).toBe(5);
  });

  it('B 이전이면 null(아직 되감지 않는다)', () => {
    expect(loopWrapTarget(19.9, { loopA: 5, loopB: 20 })).toBe(null);
  });

  it('B가 아직 지정되지 않았으면 null', () => {
    expect(loopWrapTarget(100, { loopA: 5, loopB: null })).toBe(null);
  });

  it('A·B 둘 다 없으면 null', () => {
    expect(loopWrapTarget(100, { loopA: null, loopB: null })).toBe(null);
  });
});

describe('restorePlaybackPosition — 포맷 전환 뒤 재생 위치 복원', () => {
  it('currentTime을 캡처해둔 위치로 되돌린다', () => {
    const audio = { currentTime: 0, play: vi.fn() };
    restorePlaybackPosition(audio, 42.5, false);
    expect(audio.currentTime).toBe(42.5);
  });

  it('전환 전에 재생 중이었다면 play()를 호출한다', () => {
    const audio = { currentTime: 0, play: vi.fn() };
    restorePlaybackPosition(audio, 10, true);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('전환 전에 정지 상태였다면 play()를 호출하지 않는다', () => {
    const audio = { currentTime: 0, play: vi.fn() };
    restorePlaybackPosition(audio, 10, false);
    expect(audio.play).not.toHaveBeenCalled();
  });
});

describe('bookmarkDraft — 북마크 버튼을 누른 순간 지점/구간 중 무엇을 남길지', () => {
  it('A-B가 둘 다 없으면 현재 위치의 지점 북마크를 만든다(endSec: null)', () => {
    expect(bookmarkDraft({ loopA: null, loopB: null }, 42)).toEqual({
      atSec: 42,
      endSec: null,
      note: ''
    });
  });

  it('A만 지정되고 B가 없으면 아직 구간이 아니다 — 현재 위치의 지점 북마크', () => {
    // loopA만 있는 상태(B 지정 대기 중)를 구간으로 오판하면 안 된다.
    // atSec이 loopA(10)가 아니라 currentTime(42)이어야 이 케이스를 잡아낸다.
    expect(bookmarkDraft({ loopA: 10, loopB: null }, 42)).toEqual({
      atSec: 42,
      endSec: null,
      note: ''
    });
  });

  it('A·B가 모두 지정돼 있으면 그 구간을 구간 북마크로 포착한다(currentTime은 무시)', () => {
    // currentTime(999)이 아니라 loopA·loopB를 써야 한다는 걸, 서로
    // 확연히 다른 값으로 구분해서 확인한다.
    expect(bookmarkDraft({ loopA: 10, loopB: 20 }, 999)).toEqual({
      atSec: 10,
      endSec: 20,
      note: ''
    });
  });

  it('구간 북마크의 atSec은 loopB가 아니라 loopA다(둘을 뒤바꿔도 걸리게)', () => {
    const d = bookmarkDraft({ loopA: 5, loopB: 30 }, 0);
    expect(d.atSec).toBe(5);
    expect(d.endSec).toBe(30);
  });
});

describe('sortBookmarks — 시작 시각 순 정렬, 원본은 건드리지 않는다', () => {
  function bm(id: string, atSec: number) {
    return { id, atSec, endSec: null as number | null, note: '' };
  }

  it('atSec 오름차순으로 정렬한다', () => {
    const input = [bm('c', 30), bm('a', 5), bm('b', 15)];
    expect(sortBookmarks(input).map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('원본 배열의 순서를 바꾸지 않는다(제자리 정렬 금지)', () => {
    const input = [bm('c', 30), bm('a', 5), bm('b', 15)];
    sortBookmarks(input);
    // sort() 대신 slice().sort()를 쓰지 않았다면 이 assertion이
    // 실패한다 — 위 아래 두 뮤테이션 검증으로 실제로 그런지 확인함
    // (task-16-report.md 참고).
    expect(input.map((b) => b.id)).toEqual(['c', 'a', 'b']);
  });

  it('입력과 다른 배열 참조를 돌려준다', () => {
    const input = [bm('a', 1)];
    expect(sortBookmarks(input)).not.toBe(input);
  });

  it('빈 배열도 그대로 빈 배열', () => {
    expect(sortBookmarks([])).toEqual([]);
  });
});

describe('withBookmarkNote — id가 일치하는 항목의 note만 바꾼 새 배열', () => {
  function bm(id: string, note: string) {
    return { id, atSec: 0, endSec: null as number | null, note };
  }

  it('일치하는 항목의 note만 바뀌고 나머지는 그대로다', () => {
    const input = [bm('a', '원래 메모'), bm('b', '안 바뀜')];
    const next = withBookmarkNote(input, 'a', '새 메모');
    expect(next).toEqual([bm('a', '새 메모'), bm('b', '안 바뀜')]);
  });

  it('원본 배열과 그 항목들을 바꾸지 않는다', () => {
    const input = [bm('a', '원래 메모')];
    withBookmarkNote(input, 'a', '새 메모');
    expect(input[0].note).toBe('원래 메모');
  });

  it('일치하는 id가 없으면 내용은 그대로지만 새 배열 참조를 돌려준다', () => {
    const input = [bm('a', '메모')];
    const next = withBookmarkNote(input, 'no-such-id', '무시됨');
    expect(next).toEqual(input);
    expect(next).not.toBe(input);
  });
});

describe('withoutBookmark — id가 일치하는 항목을 뺀 새 배열', () => {
  function bm(id: string) {
    return { id, atSec: 0, endSec: null as number | null, note: '' };
  }

  it('일치하는 항목만 제거하고 나머지는 순서대로 남긴다', () => {
    const input = [bm('a'), bm('b'), bm('c')];
    expect(withoutBookmark(input, 'b').map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('원본 배열은 길이가 그대로다(제자리 삭제 금지)', () => {
    const input = [bm('a'), bm('b')];
    withoutBookmark(input, 'a');
    expect(input).toHaveLength(2);
  });

  it('일치하는 id가 없으면 전부 그대로 남는다', () => {
    const input = [bm('a'), bm('b')];
    expect(withoutBookmark(input, 'no-such-id').map((b) => b.id)).toEqual(['a', 'b']);
  });
});
