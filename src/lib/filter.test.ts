import { describe, it, expect } from 'vitest';
import type { Filter, Recording } from './types';
import { EMPTY_FILTER, applyFilter, filterFromParams, filterToParams } from './filter';

function rec(over: Partial<Recording>): Recording {
  return {
    id: over.id ?? 'x', title: '레인', description: '', tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00', durationSec: 1, sourceName: 's.qta',
    appleAutoTitle: '화양동', files: {}, bookmarks: [],
    createdAt: '', updatedAt: '', deletedAt: null, ...over
  };
}

const data = [
  rec({ id: '1', title: '레인', tags: ['데모', '1절'], recordedAt: '2026-07-09T22:36:13+09:00' }),
  rec({ id: '2', title: '정류장', tags: ['데모'], recordedAt: '2026-07-15T10:00:00+09:00' }),
  rec({ id: '3', title: '빨래', tags: ['1절'], recordedAt: '2026-08-30T19:54:04+09:00' })
];

const ids = (f: Partial<Filter>) => applyFilter(data, { ...EMPTY_FILTER, ...f }).map((r) => r.id);

describe('applyFilter', () => {
  it('빈 필터는 전부 통과시킨다', () => {
    expect(ids({})).toEqual(['1', '2', '3']);
  });

  it('제목 부분일치, 대소문자 무시', () => {
    expect(ids({ q: '류' })).toEqual(['2']);
    expect(ids({ q: 'RAIN' })).toEqual([]);
  });

  it('제목만 검색하고 appleAutoTitle은 보지 않는다', () => {
    expect(ids({ q: '화양동' })).toEqual([]);
  });

  it('태그 AND는 전부 가진 것만', () => {
    expect(ids({ tags: ['데모', '1절'], tagMode: 'and' })).toEqual(['1']);
  });

  it('태그 OR는 하나라도 가진 것', () => {
    expect(ids({ tags: ['데모', '1절'], tagMode: 'or' })).toEqual(['1', '2', '3']);
  });

  it('날짜 범위는 양끝을 포함한다', () => {
    expect(ids({ from: '2026-07-09', to: '2026-07-09' })).toEqual(['1']);
    expect(ids({ from: '2026-07-15' })).toEqual(['2', '3']);
    expect(ids({ to: '2026-07-15' })).toEqual(['1', '2']);
  });

  it('세 조건은 AND로 결합된다', () => {
    expect(ids({ q: '레', tags: ['데모'], tagMode: 'and', from: '2026-07-01' })).toEqual(['1']);
    expect(ids({ q: '레', tags: ['없는태그'], tagMode: 'and' })).toEqual([]);
  });
});

describe('URL 왕복', () => {
  it('파라미터를 필터로 읽는다', () => {
    const f = filterFromParams(new URLSearchParams('q=레&tags=데모&tags=1절&mode=or&from=2026-07-01'));
    expect(f).toEqual({
      q: '레', scope: 'all', tags: ['데모', '1절'], tagMode: 'or', ext: [], from: '2026-07-01', to: ''
    });
  });

  it('mode가 없으면 and가 기본이다', () => {
    expect(filterFromParams(new URLSearchParams('')).tagMode).toBe('and');
  });

  it('빈 값은 파라미터로 내보내지 않는다', () => {
    expect(filterToParams(EMPTY_FILTER).toString()).toBe('');
  });

  it('필터 → 파라미터 → 필터가 보존된다', () => {
    const f: Filter = {
      q: '레인', scope: 'all', tags: ['데모'], tagMode: 'or', ext: [], from: '2026-07-01', to: '2026-08-01'
    };
    expect(filterFromParams(filterToParams(f))).toEqual(f);
  });

  it('쉼표를 포함한 태그는 단일 파라미터로 보존된다', () => {
    expect(filterFromParams(new URLSearchParams('tags=lo-fi,demo')).tags).toEqual(['lo-fi,demo']);
  });

  it('쉼표를 포함한 태그 왕복', () => {
    const f: Filter = { q: '', scope: 'all', tags: ['lo-fi,demo'], tagMode: 'and', ext: [], from: '', to: '' };
    const params = filterToParams(f);
    expect(filterFromParams(params)).toEqual(f);
  });
});

describe('EMPTY_FILTER 불변성', () => {
  it('EMPTY_FILTER 수정 시도는 에러를 발생시킨다', () => {
    expect(() => {
      EMPTY_FILTER.q = 'modified';
    }).toThrow();
  });

  it('EMPTY_FILTER의 tags 배열 수정 시도는 에러를 발생시킨다', () => {
    expect(() => {
      EMPTY_FILTER.tags.push('new-tag');
    }).toThrow();
  });
});

describe('검색 범위', () => {
  const scoped = [
    rec({ id: 'T', title: '레인', description: '', tags: [] }),
    rec({ id: 'D', title: '무제', description: '레인 코트를 입고', tags: [] }),
    rec({ id: 'G', title: '무제', description: '', tags: ['레인보우'] })
  ];
  const scopedIds = (f: Partial<Filter>) =>
    applyFilter(scoped, { ...EMPTY_FILTER, ...f }).map((r) => r.id);

  it('all은 제목·설명·태그 어디에 있어도 걸린다', () => {
    expect(scopedIds({ q: '레인', scope: 'all' })).toEqual(['T', 'D', 'G']);
  });

  it('title은 제목만 본다', () => {
    expect(scopedIds({ q: '레인', scope: 'title' })).toEqual(['T']);
  });

  it('description은 설명만 본다', () => {
    expect(scopedIds({ q: '레인', scope: 'description' })).toEqual(['D']);
  });

  it('tags는 개별 태그에 부분 일치한다', () => {
    // '레인'으로 '레인보우'가 걸린다 — 칩 필터의 정확 일치와 다른 점이다.
    expect(scopedIds({ q: '레인', scope: 'tags' })).toEqual(['G']);
  });

  it('빈 검색어면 범위와 무관하게 전부 통과한다', () => {
    expect(scopedIds({ q: '   ', scope: 'title' })).toEqual(['T', 'D', 'G']);
  });
});

describe('확장자 필터', () => {
  const withFiles = [
    rec({ id: 'A', files: { original: { ext: 'qta', bytes: 1 }, mp3: { bytes: 1 }, wav: { bytes: 1 } } }),
    rec({ id: 'B', files: { original: { ext: 'm4a', bytes: 1 }, mp3: { bytes: 1 }, wav: { bytes: 1 } } }),
    rec({ id: 'C', files: { original: { ext: 'qta', bytes: 1 }, wav: { bytes: 1 } } })
  ];
  const extIds = (ext: string[]) =>
    applyFilter(withFiles, { ...EMPTY_FILTER, ext }).map((r) => r.id);

  it('빈 배열이면 전부 통과한다', () => {
    expect(extIds([])).toEqual(['A', 'B', 'C']);
  });

  it('원본 확장자로 거른다', () => {
    expect(extIds(['m4a'])).toEqual(['B']);
  });

  it('변환 포맷으로 거른다 — 변환이 깨진 녹음이 빠진다', () => {
    expect(extIds(['mp3'])).toEqual(['A', 'B']);
  });

  it('여러 개는 AND — 모두 가진 것만 남는다', () => {
    expect(extIds(['qta', 'mp3'])).toEqual(['A']);
  });

  it('함께 가질 수 없는 조합은 0건이다', () => {
    expect(extIds(['qta', 'm4a'])).toEqual([]);
  });
});

describe('URL 왕복 — scope와 ext', () => {
  it('기본값 all은 URL에 싣지 않는다', () => {
    expect(filterToParams({ ...EMPTY_FILTER, q: '레인' }).toString()).toBe('q=%EB%A0%88%EC%9D%B8');
  });

  it('all이 아닌 범위는 싣는다', () => {
    const p = filterToParams({ ...EMPTY_FILTER, q: 'x', scope: 'tags' });
    expect(p.get('scope')).toBe('tags');
  });

  it('확장자는 값마다 파라미터를 하나씩 붙인다', () => {
    const p = filterToParams({ ...EMPTY_FILTER, ext: ['qta', 'mp3'] });
    expect(p.getAll('ext')).toEqual(['qta', 'mp3']);
  });

  it('scope와 ext를 읽어들인다', () => {
    const f = filterFromParams(new URLSearchParams('q=x&scope=description&ext=qta&ext=mp3'));
    expect(f.scope).toBe('description');
    expect(f.ext).toEqual(['qta', 'mp3']);
  });

  it('모르는 scope는 all로 떨어진다', () => {
    expect(filterFromParams(new URLSearchParams('scope=xyz')).scope).toBe('all');
  });

  it('scope가 없으면 all이다', () => {
    expect(filterFromParams(new URLSearchParams('q=x')).scope).toBe('all');
  });

  it('빈 ext 값은 버린다', () => {
    expect(filterFromParams(new URLSearchParams('ext=&ext=+&ext=qta')).ext).toEqual(['qta']);
  });

  it('왕복이 자기 자신으로 돌아온다', () => {
    const f: Filter = {
      q: '레인', scope: 'tags', tags: ['데모'], tagMode: 'or',
      ext: ['qta', 'mp3'], from: '2026-01-01', to: '2026-12-31'
    };
    expect(filterFromParams(filterToParams(f))).toEqual(f);
  });
});
