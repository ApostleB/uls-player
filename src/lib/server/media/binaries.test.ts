import { describe, it, expect, vi } from 'vitest';

/**
 * binaries.ts는 모듈이 처음 평가될 때 env를 한 번 읽는다(config.ts의
 * 싱글턴과 같은 방식). 그래서 다른 env로 확인하려면 모듈 캐시를 비우고
 * 다시 import해야 한다.
 */
async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await import('./binaries');
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('ffmpeg 실행 파일 경로', () => {
  it('환경변수가 없으면 PATH에서 찾도록 이름만 쓴다', async () => {
    const { FFMPEG, FFPROBE } = await loadWith({
      FFMPEG_PATH: undefined,
      FFPROBE_PATH: undefined
    });
    expect(FFMPEG).toBe('ffmpeg');
    expect(FFPROBE).toBe('ffprobe');
  });

  it('FFMPEG_PATH가 있으면 그 경로를 쓴다', async () => {
    const { FFMPEG } = await loadWith({ FFMPEG_PATH: '/opt/bundled/ffmpeg' });
    expect(FFMPEG).toBe('/opt/bundled/ffmpeg');
  });

  it('FFPROBE_PATH가 있으면 그 경로를 쓴다', async () => {
    const { FFPROBE } = await loadWith({ FFPROBE_PATH: '/opt/bundled/ffprobe' });
    expect(FFPROBE).toBe('/opt/bundled/ffprobe');
  });

  it('빈 문자열은 지정하지 않은 것으로 본다', async () => {
    const { FFMPEG, FFPROBE } = await loadWith({ FFMPEG_PATH: '', FFPROBE_PATH: '   ' });
    expect(FFMPEG).toBe('ffmpeg');
    expect(FFPROBE).toBe('ffprobe');
  });
});
