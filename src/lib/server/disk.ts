import { statfs } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '$lib/types';

export class DiskShortage extends Error {
  constructor(
    readonly needBytes: number,
    readonly freeBytes: number
  ) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
    super(`디스크 여유가 부족합니다. 필요 약 ${gb(needBytes)}GB, 남은 공간 ${gb(freeBytes)}GB`);
    this.name = 'DiskShortage';
  }
}

/**
 * 여유 공간을 잰다. 경로가 아직 없으면 존재하는 가장 가까운 상위로 올라간다.
 * media/ 는 첫 변환 전까지 없을 수 있다.
 */
export async function freeBytes(dirPath: string): Promise<number> {
  let p = path.resolve(dirPath);
  for (;;) {
    try {
      const s = await statfs(p);
      return Number(s.bavail) * Number(s.bsize);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = path.dirname(p);
      if (parent === p) throw err;
      p = parent;
    }
  }
}

/**
 * 포맷별 대략적인 크기 배수. 원본 대비 비율이며 안전하게 넉넉히 잡는다.
 * 측정값: 19.8MB qta → mp3 6.3MB(0.32배), wav 44.1k/mono 23MB(1.16배).
 */
const SIZE_RATIO: Record<string, number> = { mp3: 0.5, wav: 1.5 };

/** 원본 복사분 + 포맷별 예상 크기의 합. */
export function estimateBytes(cfg: AppConfig, sourceBytes: number[]): number {
  const total = sourceBytes.reduce((a, b) => a + b, 0);
  const multiplier = cfg.formats.reduce((acc, f) => acc + (SIZE_RATIO[f.name] ?? 1), 1);
  return Math.round(total * multiplier);
}
