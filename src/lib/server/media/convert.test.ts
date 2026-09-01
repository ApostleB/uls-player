import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FormatSpec } from '$lib/types';
import { loadConfig } from '../config';
import { probe } from './probe';
import { convert } from './convert';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const { formats } = loadConfig({});
const MP3 = formats.find((f) => f.name === 'mp3')!;
const WAV = formats.find((f) => f.name === 'wav')!;

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-convert-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('convert', () => {
  it('qta를 mp3로 바꾸고 길이를 보존한다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const out = path.join(dir, 'a.mp3');
    await convert(SPATIAL, out, audioStreamIndex, MP3);

    const r = await probe(out);
    expect(r.codecName).toBe('mp3');
    expect(r.durationSec).toBeCloseTo(2.2767, 1);
  });

  it('wav 설정의 채널·샘플레이트를 따른다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const out = path.join(dir, 'a.wav');
    await convert(SPATIAL, out, audioStreamIndex, WAV);

    const r = await probe(out);
    expect(r.channels).toBe(1);
  });

  it('apple_apac 스트림을 지정하면 실패한다', async () => {
    const out = path.join(dir, 'bad.mp3');
    // spatial.qta의 인덱스 1은 apple_apac이다
    await expect(convert(SPATIAL, out, 1, MP3)).rejects.toThrow(/apple_apac|decoder/i);
  });

  it('실패 시 부분 출력 파일을 남기지 않는다', async () => {
    const out = path.join(dir, 'bad.mp3');
    await expect(convert(SPATIAL, out, 1, MP3)).rejects.toThrow();
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('출력 디렉터리가 없으면 만든다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const out = path.join(dir, 'deep', 'nested', 'a.mp3');
    await convert(SPATIAL, out, audioStreamIndex, MP3);
    expect((await fs.stat(out)).size).toBeGreaterThan(0);
  });

  it('bitrate가 null인 포맷은 -b:a를 붙이지 않는다', async () => {
    const spec: FormatSpec = { ...WAV, sampleRate: 8000, channels: 1 };
    const { audioStreamIndex } = await probe(SPATIAL);
    const out = path.join(dir, 'b.wav');
    await convert(SPATIAL, out, audioStreamIndex, spec);
    expect((await fs.stat(out)).size).toBeGreaterThan(0);
  });
});
