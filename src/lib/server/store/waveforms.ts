import path from 'node:path';
import type { AppConfig } from '$lib/types';
import { readJson, updateJson } from './atomic';

function file(cfg: AppConfig, id: string): string {
  const dir = path.join(cfg.dataDir, 'waveforms');
  const resolved = path.join(dir, `${id}.json`);

  // path.join이 '..' 세그먼트를 정규화하므로, id가 경로를 이탈하려 하면
  // resolved가 dir 바깥으로 나간다. 라우트 단에서 id 형태를 미리 걸러내지만
  // (예: waveform 라우트의 UUID 검사), 그 검사를 우회했거나 앞으로 이 함수를
  // 직접 호출할 다른 경로가 잊어버렸을 경우를 대비한 방어선이다. 조용히
  // null을 반환하면 침범이 있었다는 사실 자체가 감춰지므로 던진다.
  const rel = path.relative(dir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`waveforms 디렉터리를 벗어나는 id입니다: ${id}`);
  }
  return resolved;
}

export async function savePeaks(cfg: AppConfig, id: string, peaks: number[]): Promise<void> {
  await updateJson<number[]>(file(cfg, id), () => peaks, []);
}

export async function loadPeaks(cfg: AppConfig, id: string): Promise<number[] | null> {
  const sentinel: number[] | null = null;
  return readJson<number[] | null>(file(cfg, id), sentinel);
}
