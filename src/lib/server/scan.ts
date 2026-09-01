import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, ScanItem } from '$lib/types';
import { probe } from './media/probe';
import { findDbPath, readTitleMap, type AppleEntry } from './apple/cloudRecordings';
import { existingSourceNames, compareByRecordedAtDesc } from './store/recordings';

export const AUDIO_EXTENSIONS = new Set([
  '.qta', '.m4a', '.mp3', '.wav', '.aac', '.caf', '.aiff', '.aif', '.flac', '.ogg', '.opus'
]);

/** UTC ISO를 로컬 오프셋 표기로 바꾼다. */
function toLocalIso(utcIso: string): string {
  const d = new Date(utcIso);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

async function inspect(
  filePath: string,
  name: string,
  apple: AppleEntry | undefined,
  duplicate: boolean
): Promise<ScanItem> {
  const bytes = (await fs.stat(filePath)).size;
  const ext = path.extname(name).slice(1);
  const base: ScanItem = {
    sourcePath: filePath,
    sourceName: name,
    title: path.basename(name, path.extname(name)),
    appleAutoTitle: null,
    recordedAt: '',
    durationSec: 0,
    ext,
    bytes,
    audioStreamIndex: 0,
    duplicate,
    error: null
  };

  try {
    const p = await probe(filePath);
    // 제목 우선순위: DB 사용자 제목 → 파일 메타 title → 파일명
    const title = apple?.title || p.title || base.title;
    const recordedAt =
      apple?.recordedAt || (p.creationTime ? toLocalIso(p.creationTime) : '');

    return {
      ...base,
      title,
      appleAutoTitle: p.title,
      recordedAt,
      durationSec: apple?.durationSec || p.durationSec,
      audioStreamIndex: p.audioStreamIndex
    };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

export async function scanFolder(cfg: AppConfig, folder: string): Promise<ScanItem[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && AUDIO_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name);

  const dbPath = await findDbPath(folder);
  const apple = dbPath ? await readTitleMap(dbPath) : new Map<string, AppleEntry>();
  const known = await existingSourceNames(cfg);

  const items = await Promise.all(
    names.map((n) => inspect(path.join(folder, n), n, apple.get(n), known.has(n)))
  );

  // 문자열 비교가 아니라 실제 시각으로 정렬한다. recordedAt에 오프셋이
  // 붙어 있어 사전식으로 비교하면 타임존이 섞였을 때 순서가 뒤집힌다.
  // 날짜를 못 읽은 항목(recordedAt === '')은 뒤로 간다.
  return items.sort(compareByRecordedAtDesc);
}
