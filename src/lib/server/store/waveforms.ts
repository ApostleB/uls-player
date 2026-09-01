import path from 'node:path';
import type { AppConfig } from '$lib/types';
import { readJson, updateJson } from './atomic';

function file(cfg: AppConfig, id: string): string {
  return path.join(cfg.dataDir, 'waveforms', `${id}.json`);
}

export async function savePeaks(cfg: AppConfig, id: string, peaks: number[]): Promise<void> {
  await updateJson<number[]>(file(cfg, id), () => peaks, []);
}

export async function loadPeaks(cfg: AppConfig, id: string): Promise<number[] | null> {
  const sentinel: number[] | null = null;
  return readJson<number[] | null>(file(cfg, id), sentinel);
}
