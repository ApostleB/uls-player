import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config';
import { freeBytes, estimateBytes } from './disk';

describe('freeBytes', () => {
  it('임시 디렉터리의 여유 공간을 양수로 준다', async () => {
    expect(await freeBytes(os.tmpdir())).toBeGreaterThan(0);
  });

  it('아직 없는 경로는 존재하는 상위로 올라가서 잰다', async () => {
    // media/ 는 첫 변환 전까지 없다. 그래도 여유를 잴 수 있어야 한다.
    expect(await freeBytes(path.join(os.tmpdir(), 'not-created-yet', 'deeper'))).toBeGreaterThan(0);
  });
});

describe('estimateBytes', () => {
  it('원본 복사분을 포함한다', () => {
    const cfg = loadConfig({ OUTPUT_FORMATS: '' });
    // 포맷이 없으면 원본 복사분만 필요하다
    expect(estimateBytes(cfg, [1000, 2000])).toBe(3000);
  });

  it('mp3는 원본보다 작게, wav는 크게 잡는다', () => {
    const cfg = loadConfig({ OUTPUT_FORMATS: 'mp3,wav' });
    const only = loadConfig({ OUTPUT_FORMATS: 'mp3' });
    expect(estimateBytes(cfg, [1000])).toBeGreaterThan(estimateBytes(only, [1000]));
  });

  it('빈 목록은 0이다', () => {
    expect(estimateBytes(loadConfig({}), [])).toBe(0);
  });
});
