import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { probe } from './probe';
import { generatePeaks } from './waveform';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');

describe('generatePeaks', () => {
  it('요청한 개수만큼 준다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    expect(await generatePeaks(SPATIAL, audioStreamIndex, 100)).toHaveLength(100);
    expect(await generatePeaks(SPATIAL, audioStreamIndex, 7)).toHaveLength(7);
  });

  it('모든 값이 0과 1 사이다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const peaks = await generatePeaks(SPATIAL, audioStreamIndex, 200);
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('무음이 아니다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const peaks = await generatePeaks(SPATIAL, audioStreamIndex, 200);
    expect(Math.max(...peaks)).toBeGreaterThan(0.01);
  });

  it('디코딩 불가 스트림을 지정하면 던진다', async () => {
    await expect(generatePeaks(SPATIAL, 1, 100)).rejects.toThrow();
  });
});
