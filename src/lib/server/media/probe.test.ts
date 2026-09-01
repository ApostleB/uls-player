import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { probe, UNDECODABLE_CODECS } from './probe';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const PLAIN = path.resolve('tests/fixtures/audio/plain.m4a');

describe('probe', () => {
  it('공간 음향 qta에서 apple_apac이 아닌 스트림을 고른다', async () => {
    const r = await probe(SPATIAL);
    // 이 파일은 [0]aac 2ch + [1]apple_apac 4ch 구성이다
    expect(r.audioStreamIndex).toBe(0);
    expect(r.codecName).toBe('aac');
    expect(r.channels).toBe(2);
  });

  it('절대 인덱스가 apple_apac을 가리키지 않는다', async () => {
    const r = await probe(SPATIAL);
    expect(UNDECODABLE_CODECS.has(r.codecName)).toBe(false);
  });

  it('길이를 준다', async () => {
    expect((await probe(SPATIAL)).durationSec).toBeCloseTo(2.2767, 3);
    expect((await probe(PLAIN)).durationSec).toBeCloseTo(1.2587, 3);
  });

  it('파일 메타의 title을 준다 (애플 자동 생성 이름)', async () => {
    expect((await probe(SPATIAL)).title).toBe('새로운 녹음 2');
    expect((await probe(PLAIN)).title).toBe('화양동 16 2');
  });

  it('creation_time을 UTC ISO로 준다', async () => {
    expect((await probe(SPATIAL)).creationTime).toBe('2026-07-11T09:15:30.000000Z');
  });

  it('단일 스트림 m4a도 처리한다', async () => {
    const r = await probe(PLAIN);
    expect(r.audioStreamIndex).toBe(0);
    expect(r.channels).toBe(1);
  });

  it('없는 파일이면 던진다', async () => {
    await expect(probe('/nope/nope.m4a')).rejects.toThrow();
  });

  it('오디오가 아닌 파일이면 던진다', async () => {
    await expect(probe(path.resolve('package.json'))).rejects.toThrow();
  });
});
