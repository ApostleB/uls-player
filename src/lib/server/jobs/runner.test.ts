import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, ScanItem } from '$lib/types';
import { loadConfig } from '../config';
import { listAll } from '../store/recordings';
import { loadPeaks } from '../store/waveforms';
import { scanFolder } from '../scan';
import { JobQueue } from './queue';
import { buildJobs, makeRunner } from './runner';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const QTA_NAME = '20260711 181530-1923A106.qta';

let dir: string;
let src: string;
let cfg: AppConfig;
let scan: ScanItem[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-runner-'));
  src = path.join(dir, 'src');
  await fs.mkdir(src, { recursive: true });
  await fs.copyFile(SPATIAL, path.join(src, QTA_NAME));
  cfg = loadConfig({
    DATA_DIR: path.join(dir, 'data'),
    MEDIA_DIR: path.join(dir, 'media'),
    WAVEFORM_PEAKS: '64'
  });
  scan = await scanFolder(cfg, src);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('buildJobs', () => {
  it('입력한 제목·설명·태그를 녹음 항목에 담는다', () => {
    const { recordings, jobs } = buildJobs(cfg, [
      { scan: scan[0], title: '레인', description: '데모', tags: ['1절'] }
    ]);
    expect(recordings[0].title).toBe('레인');
    expect(recordings[0].description).toBe('데모');
    expect(recordings[0].tags).toEqual(['1절']);
    expect(recordings[0].sourceName).toBe(QTA_NAME);
    expect(jobs[0].recordingId).toBe(recordings[0].id);
  });

  it('설정된 포맷을 pending으로 초기화한다', () => {
    const { jobs } = buildJobs(cfg, [{ scan: scan[0], title: 't', description: '', tags: [] }]);
    expect(jobs[0].formats).toEqual({ mp3: 'pending', wav: 'pending' });
  });
});

describe('makeRunner', () => {
  it('원본을 복사하고 모든 포맷을 만들고 파형을 저장한다', async () => {
    const { recordings, jobs } = buildJobs(cfg, [
      { scan: scan[0], title: '레인', description: '', tags: ['데모'] }
    ]);
    const q = new JobQueue(2, makeRunner(cfg));
    q.enqueue(jobs);
    await q.idle();

    expect(q.snapshot()[0].status).toBe('done');

    const id = recordings[0].id;
    expect((await fs.stat(path.join(cfg.mediaDir, 'original', `${id}.qta`))).size).toBeGreaterThan(0);
    expect((await fs.stat(path.join(cfg.mediaDir, 'mp3', `${id}.mp3`))).size).toBeGreaterThan(0);
    expect((await fs.stat(path.join(cfg.mediaDir, 'wav', `${id}.wav`))).size).toBeGreaterThan(0);

    const peaks = await loadPeaks(cfg, id);
    expect(peaks).toHaveLength(64);

    const stored = await listAll(cfg);
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('레인');
    expect(Object.keys(stored[0].files).sort()).toEqual(['mp3', 'original', 'wav']);
    expect(stored[0].files.mp3.bytes).toBeGreaterThan(0);
  });

  it('원본이 사라지면 실패로 기록하고 저장소를 오염시키지 않는다', async () => {
    const { jobs } = buildJobs(cfg, [{ scan: scan[0], title: 't', description: '', tags: [] }]);
    await fs.rm(jobs[0].sourcePath);

    const q = new JobQueue(1, makeRunner(cfg));
    q.enqueue(jobs);
    await q.idle();

    expect(q.snapshot()[0].status).toBe('failed');
    expect(await listAll(cfg)).toEqual([]);
  });
});
