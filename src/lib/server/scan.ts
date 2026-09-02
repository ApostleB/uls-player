import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, ScanItem } from '$lib/types';
import { probe } from './media/probe';
import { findDbPath, readTitleMap, type AppleEntry } from './apple/cloudRecordings';
import { existingSourceNames, compareByRecordedAtDesc } from './store/recordings';

export const AUDIO_EXTENSIONS = new Set([
  '.qta', '.m4a', '.mp3', '.wav', '.aac', '.caf', '.aiff', '.aif', '.flac', '.ogg', '.opus'
]);

/**
 * 코어 몇 개만 바쁘게 유지하고 몰려드는 것은 피하려는 값이다. 스캔은
 * 메타데이터만 읽으므로 변환 동시성(CONVERT_CONCURRENCY)과 맞출 필요는 없다.
 */
const SCAN_CONCURRENCY = 8;

/**
 * 동시 실행 개수만 제한하고 입력 순서는 그대로 지킨다. 완료 순서가
 * 뒤섞여도 결과는 항상 원래 인덱스 자리에 들어가므로, 최종 정렬만이
 * 출력 순서를 결정한다. mapper는 실패해도 reject하지 않는다는 전제다
 * (inspect가 그렇다) — 여기서 개별 실패를 따로 잡지 않는 이유다.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
  const ext = path.extname(name).slice(1);
  const base: ScanItem = {
    sourcePath: filePath,
    sourceName: name,
    title: path.basename(name, path.extname(name)),
    appleAutoTitle: null,
    recordedAt: '',
    durationSec: 0,
    ext,
    // stat이 실패하면 크기를 알 수 없다 — 0으로 명시한다.
    bytes: 0,
    audioStreamIndex: 0,
    duplicate,
    error: null
  };

  // stat도 probe와 함께 이 블록 안에서 실패해야 한다. readdir과 stat
  // 사이에 파일이 사라지는 일(iCloud/Finder 동기화 중이면 실제로 일어난다)이
  // probe 실패와 마찬가지로 이 파일 하나만 error로 남기고 나머지는
  // 계속 처리되게 하려면 여기서부터 감싸야 한다.
  try {
    const bytes = (await fs.stat(filePath)).size;
    const p = await probe(filePath);
    // 제목 우선순위: DB 사용자 제목 → 파일 메타 title → 파일명
    const title = apple?.title || p.title || base.title;
    const recordedAt =
      apple?.recordedAt || (p.creationTime ? toLocalIso(p.creationTime) : '');

    return {
      ...base,
      bytes,
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

  const items = await mapWithConcurrency(names, SCAN_CONCURRENCY, (n) =>
    inspect(path.join(folder, n), n, apple.get(n), known.has(n))
  );

  // 문자열 비교가 아니라 실제 시각으로 정렬한다. recordedAt에 오프셋이
  // 붙어 있어 사전식으로 비교하면 타임존이 섞였을 때 순서가 뒤집힌다.
  // 날짜를 못 읽은 항목(recordedAt === '')은 뒤로 간다.
  return items.sort(compareByRecordedAtDesc);
}
