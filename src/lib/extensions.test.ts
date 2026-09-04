import { describe, it, expect } from 'vitest';
import type { Recording } from './types';
import { recordingExtensions, extensionCounts } from './extensions';

function rec(id: string, files: Recording['files']): Recording {
  return {
    id, title: 't', description: '', tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00', durationSec: 1, sourceName: 's',
    appleAutoTitle: null, files, bookmarks: [],
    createdAt: '', updatedAt: '', deletedAt: null
  };
}

const qta = rec('1', { original: { ext: 'qta', bytes: 1 }, mp3: { bytes: 1 }, wav: { bytes: 1 } });
const m4a = rec('2', { original: { ext: 'm4a', bytes: 1 }, mp3: { bytes: 1 }, wav: { bytes: 1 } });
/** 변환이 깨져 mp3가 없는 녹음. 이 필터의 실제 용도가 이것이다. */
const broken = rec('3', { original: { ext: 'qta', bytes: 1 }, wav: { bytes: 1 } });

describe('recordingExtensions', () => {
  it('원본 확장자와 변환 포맷 이름을 함께 돌려준다', () => {
    expect(recordingExtensions(qta).sort()).toEqual(['mp3', 'qta', 'wav']);
  });

  it('없는 포맷은 빠진다', () => {
    expect(recordingExtensions(broken).sort()).toEqual(['qta', 'wav']);
  });

  it('original에 ext가 없으면 그 항목만 건너뛴다', () => {
    const noExt = rec('4', { original: { bytes: 1 }, mp3: { bytes: 1 } });
    expect(recordingExtensions(noExt)).toEqual(['mp3']);
  });

  it('원본 확장자가 변환 포맷과 같아도 중복으로 세지 않는다', () => {
    const wavOriginal = rec('5', { original: { ext: 'wav', bytes: 1 }, wav: { bytes: 1 } });
    expect(recordingExtensions(wavOriginal)).toEqual(['wav']);
  });
});

describe('extensionCounts', () => {
  it('확장자별 개수를 센다', () => {
    const counts = extensionCounts([qta, m4a, broken]);
    expect(Object.fromEntries(counts.map((c) => [c.ext, c.count]))).toEqual({
      qta: 2, m4a: 1, mp3: 2, wav: 3
    });
  });

  it('원본 확장자가 변환 포맷보다 앞에 온다', () => {
    const order = extensionCounts([qta, m4a, broken]).map((c) => c.ext);
    // qta(2) m4a(1)이 원본 묶음, 그 안에서 개수 내림차순.
    // wav(3) mp3(2)가 변환 묶음 — wav가 mp3보다 많아도 원본 뒤다.
    expect(order).toEqual(['qta', 'm4a', 'wav', 'mp3']);
  });

  it('어느 녹음에서든 원본으로 쓰인 확장자는 원본 묶음에 든다', () => {
    const wavOriginal = rec('5', { original: { ext: 'wav', bytes: 1 }, wav: { bytes: 1 } });
    const counts = extensionCounts([qta, wavOriginal]);
    expect(counts.find((c) => c.ext === 'wav')?.original).toBe(true);
    expect(counts[0].ext).toBe('wav');
  });

  it('빈 목록은 빈 배열', () => {
    expect(extensionCounts([])).toEqual([]);
  });
});
