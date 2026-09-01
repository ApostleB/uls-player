import { describe, it, expect } from 'vitest';
import { isTypingTarget } from './player';

// HTMLElement·document가 있어야 해서(브라우저 프로젝트) player.test.ts와
// 분리했다 — Space가 재생을 토글하는 대신 제목 입력창에 공백을 넣는지를
// 좌우하는 판정이라, 실제 DOM 요소로 검증한다.
describe('isTypingTarget — 단축키를 무시해야 하는 포커스 대상 판정', () => {
  it('INPUT·TEXTAREA는 타이핑 대상이다', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
  });

  it('contentEditable 요소도 타이핑 대상이다', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.appendChild(editable);
    try {
      expect(isTypingTarget(editable)).toBe(true);
    } finally {
      editable.remove();
    }
  });

  it('버튼·일반 div 등 그 외 요소는 타이핑 대상이 아니다', () => {
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
  });

  it('null이거나 HTMLElement가 아니면 false다', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(false);
  });
});
