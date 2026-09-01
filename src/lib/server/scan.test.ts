import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, Recording } from '$lib/types';
import { loadConfig } from './config';
import { addMany, newId } from './store/recordings';
import { scanFolder } from './scan';

const FIX_DB = path.resolve('tests/fixtures/CloudRecordings.db');
const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const PLAIN = path.resolve('tests/fixtures/audio/plain.m4a');

const QTA_NAME = '20260711 181530-1923A106.qta';
const M4A_NAME = '20260725 210049-B752B57A.m4a';

let dir: string;
let src: string;
let cfg: AppConfig;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-scan-'));
  src = path.join(dir, 'src');
  await fs.mkdir(src, { recursive: true });
  await fs.copyFile(SPATIAL, path.join(src, QTA_NAME));
  await fs.copyFile(PLAIN, path.join(src, M4A_NAME));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data'), MEDIA_DIR: path.join(dir, 'media') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('scanFolder', () => {
  it('오디오 파일만 집어온다', async () => {
    await fs.writeFile(path.join(src, 'notes.txt'), 'x');
    await fs.writeFile(path.join(src, 'a-track0.waveform'), 'x');
    const items = await scanFolder(cfg, src);
    expect(items.map((i) => i.sourceName).sort()).toEqual([M4A_NAME, QTA_NAME].sort());
  });

  it('DB가 있으면 사용자 제목을 쓴다', async () => {
    await fs.copyFile(FIX_DB, path.join(src, 'CloudRecordings.db'));
    const items = await scanFolder(cfg, src);
    const qta = items.find((i) => i.sourceName === QTA_NAME)!;
    expect(qta.title).toBe('새로운 녹음 2');
    expect(qta.appleAutoTitle).toBe('새로운 녹음 2');
  });

  it('DB가 없으면 파일 메타 title로 대체하고 계속 진행한다', async () => {
    const items = await scanFolder(cfg, src);
    const qta = items.find((i) => i.sourceName === QTA_NAME)!;
    expect(qta.title).toBe('새로운 녹음 2');
    expect(qta.error).toBeNull();
  });

  it('디코딩 가능한 스트림 인덱스를 담는다', async () => {
    const items = await scanFolder(cfg, src);
    expect(items.find((i) => i.sourceName === QTA_NAME)!.audioStreamIndex).toBe(0);
  });

  it('이미 등록된 원본명은 duplicate로 표시한다', async () => {
    const existing: Recording = {
      id: newId(), title: 'x', description: '', tags: [],
      recordedAt: '2026-07-11T18:15:30+09:00', durationSec: 2.2767,
      sourceName: QTA_NAME, appleAutoTitle: null,
      files: {}, bookmarks: [], createdAt: '', updatedAt: '', deletedAt: null
    };
    await addMany(cfg, [existing]);
    const items = await scanFolder(cfg, src);
    expect(items.find((i) => i.sourceName === QTA_NAME)!.duplicate).toBe(true);
    expect(items.find((i) => i.sourceName === M4A_NAME)!.duplicate).toBe(false);
  });

  it('손상 파일은 error를 달고 나머지는 계속 처리한다', async () => {
    await fs.writeFile(path.join(src, 'broken.m4a'), 'not audio');
    const items = await scanFolder(cfg, src);
    const broken = items.find((i) => i.sourceName === 'broken.m4a')!;
    expect(broken.error).toBeTruthy();
    expect(items.find((i) => i.sourceName === QTA_NAME)!.error).toBeNull();
  });

  it('recordedAt 내림차순으로 준다', async () => {
    const items = await scanFolder(cfg, src);
    expect(items[0].sourceName).toBe(M4A_NAME); // 07-25가 07-11보다 나중
  });

  it('없는 폴더면 던진다', async () => {
    await expect(scanFolder(cfg, path.join(dir, 'nope'))).rejects.toThrow();
  });
});
