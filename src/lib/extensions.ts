import type { Recording } from './types';

/**
 * 녹음 하나가 가진 확장자 집합 — 원본 확장자와 변환 완료된 포맷 이름의
 * 합집합이다. files의 키는 'original' 또는 포맷 이름('mp3','wav')이고,
 * 'original'만 실제 확장자를 ext 필드에 따로 갖는다(변환본은 포맷
 * 이름이 곧 확장자다).
 *
 * 원본을 .wav로 올린 녹음처럼 원본 확장자와 포맷 이름이 겹칠 수 있어
 * 중복을 걸러낸다.
 */
export function recordingExtensions(rec: Recording): string[] {
  const out: string[] = [];
  for (const [key, entry] of Object.entries(rec.files ?? {})) {
    const ext = key === 'original' ? entry?.ext : key;
    if (ext && !out.includes(ext)) out.push(ext);
  }
  return out;
}

export interface ExtensionCount {
  ext: string;
  count: number;
  /** 어느 녹음에서든 원본 확장자로 등장했는가 — 칩 정렬에 쓴다. */
  original: boolean;
}

/**
 * 칩 목록용 집계. 원본 확장자를 앞에 두는 것은 그것이 사용자가 실제로
 * 구분하려는 값이기 때문이다 — 변환 포맷은 거의 모든 녹음이 공유해
 * 뒤에 있어도 찾기 쉽다.
 */
export function extensionCounts(recs: Recording[]): ExtensionCount[] {
  const map = new Map<string, ExtensionCount>();

  for (const rec of recs) {
    const originalExt = rec.files?.original?.ext;
    for (const ext of recordingExtensions(rec)) {
      const cur = map.get(ext) ?? { ext, count: 0, original: false };
      cur.count += 1;
      if (ext === originalExt) cur.original = true;
      map.set(ext, cur);
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      Number(b.original) - Number(a.original) ||
      b.count - a.count ||
      a.ext.localeCompare(b.ext)
  );
}
