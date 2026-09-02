import type { Recording } from '$lib/types';

/**
 * 변환이 끝나기를 기다리는 녹음 항목. 러너가 성공하면 꺼내서 저장소에 넣는다.
 * 실패하면 남아 있다가 재시도 때 다시 쓰인다.
 */
class PendingRecordings {
  private map = new Map<string, Recording>();

  put(recs: Recording[]): void {
    for (const r of recs) this.map.set(r.id, r);
  }

  take(id: string): Recording | undefined {
    return this.map.get(id);
  }

  drop(id: string): void {
    this.map.delete(id);
  }
}

export const pendingRecordings = new PendingRecordings();
