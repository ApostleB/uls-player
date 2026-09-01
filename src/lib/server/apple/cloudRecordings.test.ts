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
    // 실제 소스 파일(~/Dev/SIDE_PROJECT/_voice_sample, 저장소에는 없음)을 ffprobe로
    // 직접 확인한 값:
    //   20260725 005422-39A2B8E8.m4a: format_tags.title = '화양동 13', ZENCRYPTEDTITLE = '비와 당신'
    //   20260830 194216-6C5B2224.m4a: format_tags.title = '화양동 57', ZENCRYPTEDTITLE = '울든 꽃에 물을주듯'
    // 즉 파일 메타의 title은 애플이 위치 기반으로 자동 생성한 이름이고,
    // 아래에서 기대하는 값은 사용자가 실제로 입력한 제목이다.
    const map = await readTitleMap(FIXTURE);
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

  it('-wal/-shm이 없는 DB(체크포인트된 상태)도 정상 읽힌다', async () => {
    // FIXTURE 자체가 이 모양이다: -wal/-shm 없이 본체만 있다. 이 사이드카 복사에서
    // ENOENT는 "정상적으로 없음"으로 취급되어 넘어가야 하고, 나머지 테스트들도
    // 전부 이 경로를 타지만 여기서 명시적으로 재확인한다.
    const dbFile = path.join(dir, 'CloudRecordings.db');
    await fs.copyFile(FIXTURE, dbFile);
    const walExists = await fs
      .access(dbFile + '-wal')
      .then(() => true)
      .catch(() => false);
    expect(walExists).toBe(false);

    const map = await readTitleMap(dbFile);
    expect(map.size).toBe(4);
  });

  it('사이드카 복사가 ENOENT가 아닌 오류로 실패하면 던진다', async () => {
    const dbFile = path.join(dir, 'CloudRecordings.db');
    await fs.copyFile(FIXTURE, dbFile);
    // -wal 자리에 파일 대신 디렉터리를 두면 copyFile이 ENOENT가 아닌 오류로
    // 실패한다(이 환경에서는 ENOTSUP). readTitleMap은 이런 오류를 삼키지 않고
    // 그대로 던져야 한다 — 삼키면 최신 제목이 빠진 채 조용히 넘어가게 된다.
    await fs.mkdir(dbFile + '-wal');
    await expect(readTitleMap(dbFile)).rejects.toThrow();
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
