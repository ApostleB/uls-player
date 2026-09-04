import { describe, it, expect } from 'vitest';
import { mediaFileExt, mediaFilePath } from './media';

describe('mediaFileExt — 포맷별 확장자 결정', () => {
  it("'original'은 files 항목의 ext를 쓴다", () => {
    expect(mediaFileExt('original', { ext: 'qta' })).toBe('qta');
  });

  it("'original'인데 ext가 없으면 'bin'으로 떨어진다", () => {
    // 실제로 이런 항목이 생기면 안 되지만, 없다고 던지는 것보다
    // 열어보고 실패하는 편이 진단하기 쉽다 — 기존 media 라우트의
    // 동작을 그대로 옮긴 것이다.
    expect(mediaFileExt('original', {})).toBe('bin');
    expect(mediaFileExt('original', undefined)).toBe('bin');
  });

  it('변환본은 포맷 이름이 곧 확장자다', () => {
    expect(mediaFileExt('mp3', { bytes: 1 } as { ext?: string })).toBe('mp3');
    expect(mediaFileExt('wav', undefined)).toBe('wav');
  });
});

describe('mediaFilePath — 저장 경로 조합', () => {
  it('mediaDir/포맷/아이디.확장자로 잇는다', () => {
    expect(mediaFilePath('/srv/media', 'a1b2', 'mp3', 'mp3')).toBe('/srv/media/mp3/a1b2.mp3');
  });

  it('original도 같은 규칙이다', () => {
    expect(mediaFilePath('/srv/media', 'a1b2', 'original', 'qta')).toBe(
      '/srv/media/original/a1b2.qta'
    );
  });

  it('mediaDir 끝의 슬래시가 중복되지 않는다', () => {
    // config.mediaDir는 path.resolve를 거쳐 보통 슬래시가 없지만,
    // 환경변수로 '/srv/media/'가 들어오면 이 함수가 '//'를 만들면 안 된다.
    expect(mediaFilePath('/srv/media/', 'a1b2', 'mp3', 'mp3')).toBe('/srv/media/mp3/a1b2.mp3');
  });
});
