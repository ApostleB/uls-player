import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { probe } from './probe';
import { generatePeaks } from './waveform';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const PLAIN = path.resolve('tests/fixtures/audio/plain.m4a');

/**
 * 16비트 모노 PCM WAV를 만든다 (44바이트 표준 헤더 + 데이터).
 * ffmpeg 합성 문법 없이도 결정적인 테스트 입력을 만들 수 있다.
 */
function buildMonoWav(samples: Int16Array, sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  buf.writeUInt16LE(1, 20); // AudioFormat = PCM
  buf.writeUInt16LE(1, 22); // NumChannels = mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * bytesPerSample, 28); // ByteRate
  buf.writeUInt16LE(bytesPerSample, 32); // BlockAlign
  buf.writeUInt16LE(16, 34); // BitsPerSample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buf;
}

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
  // close 시점에 남은 부분 미니버킷을 버리지 않고 flush하는 경로는 타지만,
  // 이 assertion만으로는 flush가 실제로 값을 반영하는지 확인할 수 없다
  // (길이는 out을 peaks 길이로 미리 채우므로 항상 참이고, 파일 어딘가에만
  // 무음이 아닌 구간이 있어도 max>0은 참이 된다 — 아래 전용 테스트가 이를 보강한다).
  it('샘플 수가 미니버킷 크기의 배수가 아니어도 끝까지 반영한다', async () => {
    const { audioStreamIndex } = await probe(PLAIN);
    const peaks = await generatePeaks(PLAIN, audioStreamIndex, 50);
    expect(peaks).toHaveLength(50);
    expect(Math.max(...peaks)).toBeGreaterThan(0);
  });

  // 위 테스트는 flush 코드를 지워도 통과한다 (길이는 사전 할당, 최댓값은
  // 파일 어디에 있어도 조건을 만족). 신호를 말단 부분 미니버킷에만 몰아넣은
  // 합성 WAV로 flush가 실제로 값을 반영하는지 직접 검증한다.
  it('말단 부분 미니버킷(64 미만)의 신호도 버려지지 않는다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-wave-flush-'));
    try {
      const sampleRate = 8000;
      const totalSamples = 8040; // 64 * 125 + 40 → 40개짜리 부분 미니버킷 존재
      const tailSamples = 40;
      const tailAmplitude = 30000;

      const samples = new Int16Array(totalSamples); // 기본값 0 (무음)
      for (let i = totalSamples - tailSamples; i < totalSamples; i++) {
        samples[i] = tailAmplitude;
      }

      const wavPath = path.join(dir, 'tail.wav');
      await fs.writeFile(wavPath, buildMonoWav(samples, sampleRate));

      const peaks = await generatePeaks(wavPath, 0, 10);
      const expected = tailAmplitude / 32768; // ≈ 0.9155

      // flush가 없으면 말단 40샘플이 통째로 사라지고 나머지는 전부 0이라 max는 0이 된다.
      expect(Math.max(...peaks)).toBeCloseTo(expected, 3);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
