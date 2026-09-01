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
    const f = filterFromParams(new URLSearchParams('q=레&tags=데모,1절&mode=or&from=2026-07-01'));
    expect(f).toEqual({ q: '레', tags: ['데모', '1절'], tagMode: 'or', from: '2026-07-01', to: '' });
  });

  it('mode가 없으면 and가 기본이다', () => {
    expect(filterFromParams(new URLSearchParams('')).tagMode).toBe('and');
  });

  it('빈 값은 파라미터로 내보내지 않는다', () => {
    expect(filterToParams(EMPTY_FILTER).toString()).toBe('');
  });

  it('필터 → 파라미터 → 필터가 보존된다', () => {
    const f = { q: '레인', tags: ['데모'], tagMode: 'or' as const, from: '2026-07-01', to: '2026-08-01' };
    expect(filterFromParams(filterToParams(f))).toEqual(f);
  });

  it('쉼표를 포함한 태그도 보존된다', () => {
    const f = { q: '', tags: ['lo-fi,demo', '싱어'], tagMode: 'and' as const, from: '', to: '' };
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
