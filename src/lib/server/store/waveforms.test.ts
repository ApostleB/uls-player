import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config';
import { savePeaks, loadPeaks } from './waveforms';

let dir: string;
let cfg: ReturnType<typeof loadConfig>;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-wave-'));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data') });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('waveforms store', () => {
  it('없으면 null이다', async () => {
    expect(await loadPeaks(cfg, 'nope')).toBeNull();
  });

  it('저장한 피크를 그대로 읽는다', async () => {
    await savePeaks(cfg, 'abc', [0, 0.5, 1]);
    expect(await loadPeaks(cfg, 'abc')).toEqual([0, 0.5, 1]);
  });

  it('recordings.json과 분리된 파일에 쓴다', async () => {
    await savePeaks(cfg, 'abc', [0.1]);
    const files = await fs.readdir(path.join(cfg.dataDir, 'waveforms'));
    expect(files).toEqual(['abc.json']);
  });
});
