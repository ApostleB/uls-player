import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import type { FormatSpec } from '$lib/types';

/**
 * convert가 ffmpeg에 넘기는 인자만 본다. 실제 인코딩 결과는 convert.test.ts가
 * 진짜 ffmpeg로 확인한다 — 여기서는 "레벨이 null이면 플래그가 아예 없다"를
 * 고정하는 것이 목적이다. 그게 서버 배포의 인코딩이 바뀌지 않았다는 보증이다.
 */
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import { convert } from './convert';

const MP3: FormatSpec = {
  name: 'mp3',
  ext: 'mp3',
  codec: 'libmp3lame',
  bitrate: '192k',
  sampleRate: 44100,
  channels: 2,
  compressionLevel: null
};
const OUT = path.join(os.tmpdir(), 'uls-convert-args', 'out.mp3');

beforeEach(() => {
  execFileMock.mockReset();
  execFileMock.mockImplementation((_cmd: string, _args: string[], cb: unknown) => {
    (cb as (e: null, r: { stdout: string; stderr: string }) => void)(null, { stdout: '', stderr: '' });
  });
});

function argsOfFirstCall(): string[] {
  return execFileMock.mock.calls[0][1] as string[];
}

describe('convert의 인코더 레벨 인자', () => {
  it('레벨이 null이면 -compression_level을 넘기지 않는다', async () => {
    await convert('/tmp/in.qta', OUT, 0, MP3);
    expect(argsOfFirstCall()).not.toContain('-compression_level');
  });

  it('레벨이 있으면 출력 경로 앞에 -compression_level N을 넣는다', async () => {
    await convert('/tmp/in.qta', OUT, 0, { ...MP3, compressionLevel: 7 });
    const args = argsOfFirstCall();
    const i = args.indexOf('-compression_level');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('7');
    // ffmpeg는 출력 파일 뒤의 옵션을 그 출력에 적용하지 않는다.
    expect(i).toBeLessThan(args.indexOf(OUT));
  });

  it('레벨 0도 넘긴다 — 0을 "없음"으로 취급하지 않는다', async () => {
    await convert('/tmp/in.qta', OUT, 0, { ...MP3, compressionLevel: 0 });
    const args = argsOfFirstCall();
    expect(args[args.indexOf('-compression_level') + 1]).toBe('0');
  });
});
