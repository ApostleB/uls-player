import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { probe } from './probe';
import { generatePeaks } from './waveform';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const PLAIN = path.resolve('tests/fixtures/audio/plain.m4a');

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

  // 스트리밍 중 미니버킷(64샘플)으로 1차 축소해도 "최대의 최대 = 전체 최대"이므로
  // 피크 값 자체는 단일 단계로 계산했을 때와 정확히 같아야 한다.
  // 이 값(0.035430908203125)은 리팩터링 전 단일 단계 구현으로 미리 측정해 둔 값이다.
  it('미니버킷 1차 축소를 거쳐도 최댓값이 그대로다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const peaks = await generatePeaks(SPATIAL, audioStreamIndex, 200);
    expect(Math.max(...peaks)).toBe(0.035430908203125);
  });

  // plain.m4a는 8kHz 기준 약 10,070샘플로 미니버킷 크기(64)의 배수가 아니다.
  // close 시점에 남은 부분 미니버킷을 버리지 않고 flush하는 경로를 검증한다.
  it('샘플 수가 미니버킷 크기의 배수가 아니어도 끝까지 반영한다', async () => {
    const { audioStreamIndex } = await probe(PLAIN);
    const peaks = await generatePeaks(PLAIN, audioStreamIndex, 50);
    expect(peaks).toHaveLength(50);
    expect(Math.max(...peaks)).toBeGreaterThan(0);
  });
});
