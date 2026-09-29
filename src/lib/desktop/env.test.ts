import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildServerEnv } from './env';

const BASE = {
  port: 45678,
  userDataDir: '/Users/me/Library/Application Support/uls-player',
  binariesDir: null,
  base: {} as NodeJS.ProcessEnv,
  platform: 'darwin' as NodeJS.Platform
};

describe('서버 자식에게 넘길 환경변수', () => {
  it('ORIGIN이 PORT와 같은 포트를 가리킨다', () => {
    const env = buildServerEnv(BASE);
    expect(env.PORT).toBe('45678');
    expect(env.ORIGIN).toBe('http://127.0.0.1:45678');
  });

  it('바깥에서 못 붙도록 127.0.0.1에만 바인딩한다', () => {
    expect(buildServerEnv(BASE).HOST).toBe('127.0.0.1');
  });

  it('Electron 바이너리를 순수 Node로 돌리도록 표시한다', () => {
    expect(buildServerEnv(BASE).ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('DATA_DIR과 MEDIA_DIR을 userData 아래로 잡는다', () => {
    const env = buildServerEnv(BASE);
    expect(env.DATA_DIR).toBe(path.join(BASE.userDataDir, 'data'));
    expect(env.MEDIA_DIR).toBe(path.join(BASE.userDataDir, 'media'));
  });

  it('이미 지정된 DATA_DIR은 덮어쓰지 않는다', () => {
    const env = buildServerEnv({ ...BASE, base: { DATA_DIR: '/mnt/library/data' } });
    expect(env.DATA_DIR).toBe('/mnt/library/data');
  });

  it('이미 지정된 MEDIA_DIR은 덮어쓰지 않는다', () => {
    const env = buildServerEnv({ ...BASE, base: { MEDIA_DIR: '/mnt/library/media' } });
    expect(env.MEDIA_DIR).toBe('/mnt/library/media');
  });

  it('빈 문자열 DATA_DIR은 지정하지 않은 것으로 본다', () => {
    const env = buildServerEnv({ ...BASE, base: { DATA_DIR: '  ' } });
    expect(env.DATA_DIR).toBe(path.join(BASE.userDataDir, 'data'));
  });

  it('ORIGIN은 바깥 값이 있어도 셸이 이긴다 — 포트가 어긋나면 403이 된다', () => {
    const env = buildServerEnv({ ...BASE, base: { ORIGIN: 'https://example.com' } });
    expect(env.ORIGIN).toBe('http://127.0.0.1:45678');
  });

  it('동봉 폴더를 주면 Windows에서 .exe 확장자를 붙인다', () => {
    const env = buildServerEnv({
      ...BASE,
      platform: 'win32',
      binariesDir: 'C:\\app\\resources\\ffmpeg\\win'
    });
    expect(env.FFMPEG_PATH).toBe(path.join('C:\\app\\resources\\ffmpeg\\win', 'ffmpeg.exe'));
    expect(env.FFPROBE_PATH).toBe(path.join('C:\\app\\resources\\ffmpeg\\win', 'ffprobe.exe'));
  });

  it('동봉 폴더를 주면 그 외 플랫폼에서는 확장자를 붙이지 않는다', () => {
    const env = buildServerEnv({ ...BASE, binariesDir: '/app/resources/ffmpeg/darwin' });
    expect(env.FFMPEG_PATH).toBe('/app/resources/ffmpeg/darwin/ffmpeg');
  });

  it('동봉 폴더가 없으면 FFMPEG_PATH를 넣지 않는다 — PATH에 맡긴다', () => {
    const env = buildServerEnv(BASE);
    expect(env.FFMPEG_PATH).toBeUndefined();
    expect(env.FFPROBE_PATH).toBeUndefined();
  });

  it('이미 지정된 FFMPEG_PATH는 동봉 폴더보다 우선한다', () => {
    const env = buildServerEnv({
      ...BASE,
      binariesDir: '/app/resources/ffmpeg/darwin',
      base: { FFMPEG_PATH: '/opt/homebrew/bin/ffmpeg' }
    });
    expect(env.FFMPEG_PATH).toBe('/opt/homebrew/bin/ffmpeg');
  });

  it('업로드 본문 한도를 4GB로 올린다 — 기본값 512KB면 첫 파일부터 막힌다', () => {
    expect(buildServerEnv(BASE).BODY_SIZE_LIMIT).toBe(String(4 * 1024 ** 3));
  });

  it('바깥 환경변수를 그대로 물려준다', () => {
    const env = buildServerEnv({ ...BASE, base: { CONVERT_CONCURRENCY: '2' } });
    expect(env.CONVERT_CONCURRENCY).toBe('2');
  });
});
