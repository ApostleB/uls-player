import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isVbrMp3 } from './mp3Header';

const exec = promisify(execFile);
const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-mp3header-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function makeMp3(name: string, codecArgs: string[]): Promise<string> {
  const out = path.join(dir, name);
  await exec('ffmpeg', ['-v', 'error', '-i', SPATIAL, '-map', '0:a:0', ...codecArgs, out]);
  return out;
}

describe('isVbrMp3', () => {
  // 실제로 xxd로 확인한 바이트(리포트 참고): LAME이 CBR 128k에 쓰는 것은
  // Xing/VBRI가 아니라 'Info' 태그다. Xing이 없다고 곧장 true로 판정하면
  // 안 되는 이유가 이 케이스다.
  it('CBR(128k)은 VBR이 아니다 — LAME이 Info 태그를 쓴다', async () => {
    const file = await makeMp3('cbr.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k']);
    expect(await isVbrMp3(file)).toBe(false);
  });

  it('VBR(-q:a 2)은 VBR이다 — LAME이 Xing 태그를 쓴다', async () => {
    const file = await makeMp3('vbr.mp3', ['-c:a', 'libmp3lame', '-q:a', '2']);
    expect(await isVbrMp3(file)).toBe(true);
  });

  it('ID3v2 태그가 붙은 VBR도 VBR로 판정한다 — ID3 건너뛰기를 검증한다', async () => {
    const file = await makeMp3('vbr-id3.mp3', [
      '-c:a', 'libmp3lame', '-q:a', '2',
      '-metadata', 'title=테스트 제목'
    ]);
    // ffmpeg가 ID3v2 태그를 앞에 붙였는지 먼저 확인한다 — 안 붙었다면
    // 이 테스트는 ID3 건너뛰기를 검증하지 못한 채 통과해 버린다.
    const head = await fs.readFile(file, { encoding: null });
    expect(head.subarray(0, 3).toString('ascii')).toBe('ID3');

    expect(await isVbrMp3(file)).toBe(true);
  });
});
