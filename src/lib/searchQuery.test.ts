import { describe, it, expect } from 'vitest';
import { mergeSearchQuery } from './searchQuery';

describe('mergeSearchQuery', () => {
  it('다른 파라미터를 보존한 채 q를 추가한다', () => {
    expect(mergeSearchQuery('tags=데모', '레인')).toBe('tags=%EB%8D%B0%EB%AA%A8&q=%EB%A0%88%EC%9D%B8');
  });

  it('다른 파라미터를 보존한 채 q를 갱신한다(이미 q가 있을 때)', () => {
    expect(mergeSearchQuery('q=정류장&tags=데모', '레인')).toBe(
      'q=%EB%A0%88%EC%9D%B8&tags=%EB%8D%B0%EB%AA%A8'
    );
  });

  it('빈 문자열을 넘기면 q를 지운다 — 다른 파라미터는 남는다', () => {
    expect(mergeSearchQuery('q=레인&tags=데모&from=2026-01-01', '')).toBe(
      'tags=%EB%8D%B0%EB%AA%A8&from=2026-01-01'
    );
  });

  it('빈 입력 + 빈 q면 빈 문자열이다', () => {
    expect(mergeSearchQuery('', '')).toBe('');
  });
});
