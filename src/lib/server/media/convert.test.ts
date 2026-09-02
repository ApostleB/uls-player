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

  it('실패 시 기존에 있던 출력 파일도 지운다', async () => {
    const out = path.join(dir, 'bad.mp3');
    await fs.writeFile(out, 'junk');
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

  // null("이 포맷은 이 옵션을 안 쓴다")과 0을 구분한다. 진리값 검사로
  // 두면 env에 0을 넣었을 때 -ar/-ac가 조용히 빠진 채 ffmpeg 기본값으로
  // 변환되어, 설정한 줄 알았던 값과 결과물이 어긋난다.
  it('sampleRate가 0이면 조용히 넘어가지 않고 거부한다', async () => {
    const spec: FormatSpec = { ...WAV, sampleRate: 0 };
    const { audioStreamIndex } = await probe(SPATIAL);
    await expect(convert(SPATIAL, path.join(dir, 'z.wav'), audioStreamIndex, spec)).rejects.toThrow(
      /sampleRate는 0보다 커야/
    );
  });

  it('channels가 0이면 조용히 넘어가지 않고 거부한다', async () => {
    const spec: FormatSpec = { ...WAV, channels: 0 };
    const { audioStreamIndex } = await probe(SPATIAL);
    await expect(convert(SPATIAL, path.join(dir, 'z.wav'), audioStreamIndex, spec)).rejects.toThrow(
      /channels는 0보다 커야/
    );
  });

  it('bitrate가 빈 문자열이면 거부한다', async () => {
    const spec: FormatSpec = { ...MP3, bitrate: '' };
    const { audioStreamIndex } = await probe(SPATIAL);
    await expect(convert(SPATIAL, path.join(dir, 'z.mp3'), audioStreamIndex, spec)).rejects.toThrow(
      /bitrate가 비어 있습니다/
    );
  });
});
