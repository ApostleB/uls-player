import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface AppleEntry {
  title: string;
  recordedAt: string;
  durationSec: number;
}

const DB_NAME = 'CloudRecordings.db';
/** Core Data 기준 시각(2001-01-01)과 unix epoch의 차이 */
const CORE_DATA_EPOCH = 978_307_200;

export async function findDbPath(folder: string): Promise<string | null> {
  const p = path.join(folder, DB_NAME);
  try {
    await fs.access(p);
    return p;
  } catch {
    return null;
  }
}

function toIsoWithOffset(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

/**
 * CloudRecordings.db에서 파일명 → 제목·녹음시각·길이 맵을 만든다.
 *
 * 제목은 ZENCRYPTEDTITLE에서 온다. 컬럼명과 달리 평문이며, 사용자가 지정한
 * 제목이 여기 들어간다. 파일 메타데이터의 title은 애플이 위치 기반으로
 * 자동 생성한 이름이라 사용자 제목과 다르다.
 *
 * DB는 WAL 모드다. -wal/-shm이 함께 있어야 최신 내용이 보이므로 셋을 임시
 * 위치로 복사한 뒤 읽는다. 원본은 손대지 않는다.
 */
export async function readTitleMap(dbPath: string): Promise<Map<string, AppleEntry>> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-cloudrec-'));
  const copy = path.join(tmp, DB_NAME);
  try {
    await fs.copyFile(dbPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      try {
        await fs.copyFile(dbPath + suffix, copy + suffix);
      } catch {
        // 없으면 넘어간다. 체크포인트가 끝난 DB에는 없다.
      }
    }

    const db = new Database(copy, { readonly: true });
    try {
      const rows = db
        .prepare(
          `SELECT ZPATH AS p, ZENCRYPTEDTITLE AS t, ZDATE AS d, ZDURATION AS dur
             FROM ZCLOUDRECORDING
            WHERE ZPATH IS NOT NULL`
        )
        .all() as { p: string; t: string | null; d: number | null; dur: number | null }[];

      const map = new Map<string, AppleEntry>();
      for (const r of rows) {
        map.set(r.p, {
          title: r.t ?? '',
          recordedAt: r.d === null ? '' : toIsoWithOffset(r.d + CORE_DATA_EPOCH),
          durationSec: r.dur ?? 0
        });
      }
      return map;
    } finally {
      db.close();
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
