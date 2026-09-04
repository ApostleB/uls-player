import { describe, it, expect } from 'vitest';
import { middleEllipsis } from './pathDisplay';

describe('middleEllipsis — 긴 경로 줄이기', () => {
  it('max 이하면 그대로 둔다', () => {
    expect(middleEllipsis('/a/b.mp3', 40)).toBe('/a/b.mp3');
  });

  it('가운데를 줄이고 앞과 끝을 남긴다', () => {
    // 끝만 남기면 어느 저장소인지 모르고, 앞만 남기면 어느 파일인지
    // 모른다 — 둘 다 남는 것이 이 함수의 존재 이유다.
    const long = '/Volumes/Storage/voice/uls/media/mp3/a1b2c3d4e5f6.mp3';
    const out = middleEllipsis(long, 30);

    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).toContain('…');
    expect(out.startsWith('/Volumes')).toBe(true);
    expect(out.endsWith('.mp3')).toBe(true);
  });

  it('줄인 뒤에도 파일명이 알아볼 만큼 남는다', () => {
    const long = '/very/long/prefix/that/keeps/going/on/and/on/recording.wav';
    expect(middleEllipsis(long, 30)).toContain('recording.wav');
  });

  it('max가 말줄임표보다도 작으면 빈 문자열이 아니라 끝부분을 준다', () => {
    // 어느 파일인지가 어느 저장소인지보다 급하다.
    const out = middleEllipsis('/a/bbbbbbbbbb/cccc.mp3', 5);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(5);
  });
});
