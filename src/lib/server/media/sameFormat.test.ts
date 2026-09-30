import { describe, it, expect } from 'vitest';
import { isSameFormat } from './sameFormat';

const QTA = { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', codecName: 'aac', vbr: false };

describe('원본이 이미 출력 포맷인가', () => {
  it('mp3 컨테이너의 mp3 코덱은 mp3다', () => {
    expect(isSameFormat('mp3', { formatName: 'mp3', codecName: 'mp3', vbr: false })).toBe(true);
  });

  it('VBR mp3는 복사하지 않는다 — 복사본은 재생기 탐색이 부정확해진다', () => {
    expect(isSameFormat('mp3', { formatName: 'mp3', codecName: 'mp3', vbr: true })).toBe(false);
  });

  it('mp3 컨테이너라도 코덱이 mp2면 mp3로 복사하지 않는다 — 브라우저가 재생하지 못한다', () => {
    expect(isSameFormat('mp3', { formatName: 'mp3', codecName: 'mp2', vbr: false })).toBe(false);
  });

  it('이름만 .mp3인 AAC는 mp3가 아니다 — 확장자가 아니라 내용으로 판정한다', () => {
    expect(
      isSameFormat('mp3', { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', codecName: 'aac', vbr: false })
    ).toBe(false);
  });

  it('MP4 컨테이너에 든 mp3 코덱은 mp3가 아니다 — 복사하면 .mp3 이름의 MP4가 된다', () => {
    expect(
      isSameFormat('mp3', { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', codecName: 'mp3', vbr: false })
    ).toBe(false);
  });

  it('wav 컨테이너의 PCM은 비트 깊이와 무관하게 wav다', () => {
    expect(isSameFormat('wav', { formatName: 'wav', codecName: 'pcm_s16le', vbr: false })).toBe(
      true
    );
    expect(isSameFormat('wav', { formatName: 'wav', codecName: 'pcm_s24le', vbr: false })).toBe(
      true
    );
  });

  it('AIFF의 PCM은 wav가 아니다 — 코덱만 보면 .wav 이름의 AIFF가 된다', () => {
    expect(isSameFormat('wav', { formatName: 'aiff', codecName: 'pcm_s16be', vbr: false })).toBe(
      false
    );
  });

  it('wav 컨테이너라도 PCM이 아니면 wav로 복사하지 않는다', () => {
    expect(isSameFormat('wav', { formatName: 'wav', codecName: 'adpcm_ms', vbr: false })).toBe(
      false
    );
  });

  it('QTA의 AAC는 mp3도 wav도 아니다', () => {
    expect(isSameFormat('mp3', QTA)).toBe(false);
    expect(isSameFormat('wav', QTA)).toBe(false);
  });

  it('규칙이 없는 출력 포맷은 항상 변환한다', () => {
    expect(isSameFormat('flac', { formatName: 'flac', codecName: 'flac', vbr: false })).toBe(
      false
    );
  });
});
