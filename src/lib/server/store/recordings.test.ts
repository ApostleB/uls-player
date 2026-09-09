import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, Recording } from '$lib/types';
import { loadConfig } from '../config';
import {
  newId, listAll, getById, addMany, patch, setFavorite,
  addTags, removeTags, softDelete, allTags, existingSourceNames,
  RecordingNotFoundError
} from './recordings';

let dir: string;
let cfg: AppConfig;

function rec(over: Partial<Recording> = {}): Recording {
  return {
    id: newId(),
    title: '레인',
    description: '',
    tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00',
    durationSec: 274.205,
    sourceName: '20260709 223613-AA3B4246.qta',
    appleAutoTitle: '화양동',
    files: { original: { ext: 'qta', bytes: 100 } },
    bookmarks: [],
    createdAt: '2026-08-31T20:35:00+09:00',
    updatedAt: '2026-08-31T20:35:00+09:00',
    favoritedAt: null,
    deletedAt: null,
    ...over
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-rec-'));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data'), MEDIA_DIR: path.join(dir, 'media') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** beforeEach가 이미 만들어 둔(그리고 afterEach가 치워 줄) 임시 설정을 그대로 돌려준다. */
async function tmpConfig(): Promise<AppConfig> {
  return cfg;
}

/** 녹음 하나를 저장소에 심고 그대로 돌려준다. */
async function seedOne(cfg: AppConfig): Promise<Recording> {
  const r = rec();
  await addMany(cfg, [r]);
  return r;
}

/**
 * "필드가 아직 없던 시절의 recordings.json"을 흉내 낸다.
 * recordings.ts의 all()이 읽을 때 기본값을 채우는지 검증하기 위해,
 * 저장소 함수를 거치지 않고 파일을 직접 쓴다.
 */
async function writeRecordingsFileWithout(cfg: AppConfig, field: keyof Recording): Promise<void> {
  const full: Record<string, unknown> = { ...rec() };
  delete full[field];
  await fs.mkdir(cfg.dataDir, { recursive: true });
  await fs.writeFile(
    path.join(cfg.dataDir, 'recordings.json'),
    JSON.stringify({ version: 1, recordings: [full] }),
    'utf8'
  );
}

describe('recordings store', () => {
  it('저장소가 비어 있으면 빈 배열이다', async () => {
    expect(await listAll(cfg)).toEqual([]);
    expect(await allTags(cfg)).toEqual([]);
  });

  it('제목이 같아도 서로 다른 항목으로 저장된다', async () => {
    await addMany(cfg, [rec({ title: '화양동' }), rec({ title: '화양동' })]);
    const all = await listAll(cfg);
    expect(all).toHaveLength(2);
    expect(all[0].id).not.toBe(all[1].id);
  });

  it('recordedAt 내림차순으로 준다', async () => {
    await addMany(cfg, [
      rec({ recordedAt: '2026-07-09T22:36:13+09:00', title: '먼저' }),
      rec({ recordedAt: '2026-08-30T19:54:04+09:00', title: '나중' })
    ]);
    expect((await listAll(cfg)).map((r) => r.title)).toEqual(['나중', '먼저']);
  });

  it('recordedAt 오프셋이 달라도 실제 시각 기준으로 내림차순 정렬한다', async () => {
    await addMany(cfg, [
      // 2026-07-09T20:00:00+09:00 == 2026-07-09T11:00:00Z
      rec({ recordedAt: '2026-07-09T20:00:00+09:00', title: '이르다' }),
      // 2026-07-09T10:00:00-05:00 == 2026-07-09T15:00:00Z, 실제로는 이쪽이 더 나중이다
      rec({ recordedAt: '2026-07-09T10:00:00-05:00', title: '늦다' })
    ]);
    expect((await listAll(cfg)).map((r) => r.title)).toEqual(['늦다', '이르다']);
  });

  it('recordedAt이 빈 문자열이면 맨 뒤로 가고, 날짜 있는 항목의 순서는 그대로다', async () => {
    await addMany(cfg, [
      rec({ recordedAt: '2026-07-09T22:36:13+09:00', title: '먼저' }),
      rec({ recordedAt: '', title: '날짜없음' }),
      rec({ recordedAt: '2026-08-30T19:54:04+09:00', title: '나중' })
    ]);
    expect((await listAll(cfg)).map((r) => r.title)).toEqual(['나중', '먼저', '날짜없음']);
  });

  it('patch가 updatedAt을 갱신한다', async () => {
    const r = rec();
    await addMany(cfg, [r]);
    const after = await patch(cfg, r.id, { title: '정류장', tags: ['데모'] });
    expect(after.title).toBe('정류장');
    expect(after.tags).toEqual(['데모']);
    expect(after.updatedAt).not.toBe(r.updatedAt);
  });

  it('없는 id를 patch하면 던진다', async () => {
    await expect(patch(cfg, 'nope', { title: 'x' })).rejects.toThrow(/nope/);
  });

  it('addTags는 중복을 만들지 않는다', async () => {
    const a = rec({ tags: ['데모'] });
    const b = rec({ tags: [] });
    await addMany(cfg, [a, b]);
    await addTags(cfg, [a.id, b.id], ['데모', '1절']);
    const all = await listAll(cfg);
    expect(all.find((r) => r.id === a.id)!.tags.sort()).toEqual(['1절', '데모']);
    expect(all.find((r) => r.id === b.id)!.tags.sort()).toEqual(['1절', '데모']);
  });

  it('removeTags는 지정한 태그만 뺀다', async () => {
    const a = rec({ tags: ['데모', '1절'] });
    await addMany(cfg, [a]);
    await removeTags(cfg, [a.id], ['데모']);
    expect((await getById(cfg, a.id))!.tags).toEqual(['1절']);
  });

  it('소프트 삭제된 항목은 목록과 태그 집계에서 빠진다', async () => {
    const a = rec({ tags: ['데모'] });
    const b = rec({ tags: ['데모'] });
    await addMany(cfg, [a, b]);
    await softDelete(cfg, [a.id]);
    expect(await listAll(cfg)).toHaveLength(1);
    expect(await allTags(cfg)).toEqual([{ tag: '데모', count: 1 }]);
    expect(await getById(cfg, a.id)).toBeNull();
  });

  it('태그 집계는 빈도 내림차순, 동률은 가나다순', async () => {
    await addMany(cfg, [
      rec({ tags: ['가', '나'] }),
      rec({ tags: ['나'] }),
      rec({ tags: ['다'] })
    ]);
    expect(await allTags(cfg)).toEqual([
      { tag: '나', count: 2 },
      { tag: '가', count: 1 },
      { tag: '다', count: 1 }
    ]);
  });

  it('existingSourceNames는 삭제된 것도 포함한다', async () => {
    const a = rec({ sourceName: 'a.qta' });
    await addMany(cfg, [a]);
    await softDelete(cfg, [a.id]);
    expect(await existingSourceNames(cfg)).toEqual(new Set(['a.qta']));
  });
});

describe('favoritedAt', () => {
  it('필드가 없는 기존 녹음도 읽히고 null로 채워진다', async () => {
    // 이 저장소는 스키마 마이그레이션 대신 읽을 때 기본값을 채운다.
    // recordings.json을 직접 써서 "필드가 없던 시절의 파일"을 만든다.
    const cfg = await tmpConfig();
    await writeRecordingsFileWithout(cfg, 'favoritedAt');

    const [rec] = await listAll(cfg);

    expect(rec.favoritedAt).toBe(null);
  });

  it('지정하면 서버 시각이 들어간다', async () => {
    const cfg = await tmpConfig();
    const rec = await seedOne(cfg);
    // nowIso()는 초 단위까지만 담는다(밀리초 없음). Date.now()를 그대로 비교하면
    // 같은 1초 안에서 ms 부분이 잘려나가 "과거"처럼 보여 거짓 실패가 난다 —
    // 그래서 before도 초 경계로 내림한다.
    const before = Math.floor(Date.now() / 1000) * 1000;

    const out = await setFavorite(cfg, rec.id, true);

    expect(out.favoritedAt).not.toBe(null);
    expect(Date.parse(out.favoritedAt!)).toBeGreaterThanOrEqual(before);
  });

  it('해제하면 null로 돌아간다', async () => {
    const cfg = await tmpConfig();
    const rec = await seedOne(cfg);
    await setFavorite(cfg, rec.id, true);

    const out = await setFavorite(cfg, rec.id, false);

    expect(out.favoritedAt).toBe(null);
  });

  it('디스크에도 남는다', async () => {
    // 반환값만 맞고 파일에 안 써지면 새로고침에서 사라진다.
    const cfg = await tmpConfig();
    const rec = await seedOne(cfg);
    await setFavorite(cfg, rec.id, true);

    const [reloaded] = await listAll(cfg);

    expect(reloaded.favoritedAt).not.toBe(null);
  });

  it('없는 id면 RecordingNotFoundError', async () => {
    const cfg = await tmpConfig();
    await expect(setFavorite(cfg, 'no-such-id', true)).rejects.toThrow(RecordingNotFoundError);
  });
});
