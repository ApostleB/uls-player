import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, Recording } from '$lib/types';
import { loadConfig } from '../config';
import {
  newId, listAll, getById, addMany, patch,
  addTags, removeTags, softDelete, allTags, existingSourceNames
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
