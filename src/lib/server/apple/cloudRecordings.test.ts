import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findDbPath, readTitleMap } from './cloudRecordings';

const FIXTURE = path.resolve('tests/fixtures/CloudRecordings.db');

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-apple-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readTitleMap', () => {
  it('파일명을 키로 항목을 준다', async () => {
    const map = await readTitleMap(FIXTURE);
    expect(map.size).toBe(4);
    expect(map.has('20260711 181530-1923A106.qta')).toBe(true);
  });

  it('사용자가 지정한 제목을 준다 (파일 메타의 위치 이름이 아니다)', async () => {
    const map = await readTitleMap(FIXTURE);
    // 이 파일의 format_tags.title은 '화양동 13'이지만 사용자가 붙인 제목은 다르다
    expect(map.get('20260725 005422-39A2B8E8.m4a')!.title).toBe('비와 당신');
    expect(map.get('20260830 194216-6C5B2224.m4a')!.title).toBe('울든 꽃에 물을주듯');
  });

  it('ZDATE를 오프셋 포함 ISO로 변환한다', async () => {
    const map = await readTitleMap(FIXTURE);
    const e = map.get('20260711 181530-1923A106.qta')!;
    expect(e.recordedAt).toMatch(/^2026-07-11T18:15:30[+-]\d{2}:\d{2}$/);
  });

  it('길이를 준다', async () => {
    const map = await readTitleMap(FIXTURE);
    expect(map.get('20260711 181530-1923A106.qta')!.durationSec).toBeCloseTo(2.277, 2);
  });

  it('원본 DB를 수정하지 않는다', async () => {
    const before = await fs.readFile(FIXTURE);
    await readTitleMap(FIXTURE);
    expect(await fs.readFile(FIXTURE)).toEqual(before);
  });

  it('DB가 아닌 파일이면 던진다', async () => {
    const bad = path.join(dir, 'nope.db');
    await fs.writeFile(bad, 'not a database');
    await expect(readTitleMap(bad)).rejects.toThrow();
  });
});

describe('findDbPath', () => {
  it('폴더에서 CloudRecordings.db를 찾는다', async () => {
    await fs.copyFile(FIXTURE, path.join(dir, 'CloudRecordings.db'));
    expect(await findDbPath(dir)).toBe(path.join(dir, 'CloudRecordings.db'));
  });

  it('없으면 null을 준다', async () => {
    expect(await findDbPath(dir)).toBeNull();
  });
});
