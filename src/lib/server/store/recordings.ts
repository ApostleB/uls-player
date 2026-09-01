import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, Recording, RecordingsFile } from '$lib/types';
import { readJson, updateJson } from './atomic';

const EMPTY: RecordingsFile = { version: 1, recordings: [] };

function file(cfg: AppConfig): string {
  return path.join(cfg.dataDir, 'recordings.json');
}

export function newId(): string {
  return randomUUID();
}

function nowIso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

async function all(cfg: AppConfig): Promise<Recording[]> {
  return (await readJson<RecordingsFile>(file(cfg), EMPTY)).recordings;
}

export async function listAll(cfg: AppConfig): Promise<Recording[]> {
  return (await all(cfg))
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
}

export async function getById(cfg: AppConfig, id: string): Promise<Recording | null> {
  return (await all(cfg)).find((r) => r.id === id && r.deletedAt === null) ?? null;
}

export async function addMany(cfg: AppConfig, recs: Recording[]): Promise<void> {
  await updateJson<RecordingsFile>(
    file(cfg),
    (cur) => ({ ...cur, recordings: [...cur.recordings, ...recs] }),
    EMPTY
  );
}

type Patchable = Partial<Pick<Recording, 'title' | 'description' | 'tags' | 'files' | 'bookmarks'>>;

export async function patch(cfg: AppConfig, id: string, changes: Patchable): Promise<Recording> {
  let out: Recording | null = null;
  await updateJson<RecordingsFile>(
    file(cfg),
    (cur) => {
      const i = cur.recordings.findIndex((r) => r.id === id && r.deletedAt === null);
      if (i === -1) throw new Error(`녹음을 찾을 수 없습니다: ${id}`);
      out = { ...cur.recordings[i], ...changes, updatedAt: nowIso() };
      const next = cur.recordings.slice();
      next[i] = out;
      return { ...cur, recordings: next };
    },
    EMPTY
  );
  return out!;
}

function mapIds(
  cfg: AppConfig,
  ids: string[],
  fn: (r: Recording) => Recording
): Promise<RecordingsFile> {
  const set = new Set(ids);
  return updateJson<RecordingsFile>(
    file(cfg),
    (cur) => ({
      ...cur,
      recordings: cur.recordings.map((r) => (set.has(r.id) ? fn(r) : r))
    }),
    EMPTY
  );
}

export async function addTags(cfg: AppConfig, ids: string[], tags: string[]): Promise<void> {
  await mapIds(cfg, ids, (r) => ({
    ...r,
    tags: Array.from(new Set([...r.tags, ...tags])),
    updatedAt: nowIso()
  }));
}

export async function removeTags(cfg: AppConfig, ids: string[], tags: string[]): Promise<void> {
  const drop = new Set(tags);
  await mapIds(cfg, ids, (r) => ({
    ...r,
    tags: r.tags.filter((t) => !drop.has(t)),
    updatedAt: nowIso()
  }));
}

export async function softDelete(cfg: AppConfig, ids: string[]): Promise<void> {
  const at = nowIso();
  await mapIds(cfg, ids, (r) => ({ ...r, deletedAt: at, updatedAt: at }));
}

export async function allTags(cfg: AppConfig): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const r of await listAll(cfg)) {
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko')
  );
}

/** 삭제된 항목의 원본명도 포함한다. 재스캔에서 다시 끌려오지 않게 하기 위해서다. */
export async function existingSourceNames(cfg: AppConfig): Promise<Set<string>> {
  return new Set((await all(cfg)).map((r) => r.sourceName));
}
