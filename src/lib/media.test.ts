import { describe, it, expect } from 'vitest';
import { mediaFileExt, mediaFilePath, downloadFileName } from './media';

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

describe('downloadFileName', () => {
  it('제목_녹음일자.확장자 형태로 만든다', () => {
    expect(downloadFileName('레인', '2026-07-09T22:36:13+09:00', 'qta')).toBe('레인_2026-07-09.qta');
  });

  it('recordedAt의 앞 10글자만 쓴다 — 오프셋이 붙어 있어 그 부분이 로컬 날짜다', () => {
    expect(downloadFileName('밤', '2026-12-31T23:59:59+09:00', 'mp3')).toBe('밤_2026-12-31.mp3');
  });

  it('경로 구분자와 파일명에 못 쓰는 글자를 바꾼다', () => {
    // 제목은 사용자가 자유롭게 적는 값이라 /, \, : 같은 글자가 들어올 수 있다.
    expect(downloadFileName('a/b\\c:d', '2026-07-09T00:00:00+09:00', 'wav')).toBe('a-b-c-d_2026-07-09.wav');
  });

  it('앞뒤 공백과 마침표를 떨어낸다', () => {
    // 마침표로 시작하면 숨김 파일이 되고, 끝에 있으면 일부 OS가 잘라낸다.
    expect(downloadFileName('  .조용한 밤.  ', '2026-07-09T00:00:00+09:00', 'mp3')).toBe(
      '조용한 밤_2026-07-09.mp3'
    );
  });

  it('제목이 비면 날짜만 쓴다', () => {
    expect(downloadFileName('   ', '2026-07-09T00:00:00+09:00', 'mp3')).toBe('2026-07-09.mp3');
  });

  it('아주 긴 제목은 잘라낸다', () => {
    // 대부분의 파일 시스템이 파일명 255바이트를 넘기지 못한다 — 한글은
    // UTF-8에서 글자당 3바이트라 글자수가 아니라 바이트로 재야 한다.
    const name = downloadFileName('가'.repeat(300), '2026-07-09T00:00:00+09:00', 'mp3');
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(240);
    expect(name.endsWith('_2026-07-09.mp3')).toBe(true);
  });
});
