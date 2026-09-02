import type { JobItem, JobStatus } from '$lib/types';

export type Worker = (item: JobItem) => Promise<Record<string, JobStatus>>;

/**
 * 워커가 도중에 실패했지만 일부 포맷은 이미 만들어졌을 때 던지는 에러.
 * 여기 실린 formats가 없으면 큐는 실행 이전 상태를 그대로 남기게 되고,
 * 그러면 이미 성공한 포맷이 pending으로 되돌아가 재시도 때 다시 변환된다.
 * 그 재시도가 실패하면 convert의 정리 로직이 멀쩡한 파일을 지운다.
 * formats는 부분 맵이어도 된다 — 큐는 기존 formats 위에 이 값을 덮어써서 병합한다.
 */
export class JobFailure extends Error {
  constructor(
    message: string,
    readonly formats?: Record<string, JobStatus>
  ) {
    super(message);
    this.name = 'JobFailure';
  }
}

/**
 * 인메모리 변환 큐. 요청과 무관하게 돌아가고, 진행 상황은 구독자에게 흘린다.
 * 항목 하나가 실패해도 나머지는 계속 처리한다.
 */
export class JobQueue {
  private items = new Map<string, JobItem>();
  private pending: string[] = [];
  private running = 0;
  private subscribers = new Set<(items: JobItem[]) => void>();
  private idleWaiters: (() => void)[] = [];

  constructor(
    private concurrency: number,
    private worker: Worker
  ) {}

  enqueue(items: JobItem[]): void {
    for (const i of items) {
      this.items.set(i.id, { ...i, status: 'pending', error: null });
      this.pending.push(i.id);
    }
    this.emit();
    this.pump();
  }

  retryFailed(): void {
    const ids = this.snapshot()
      .filter((i) => i.status === 'failed')
      .map((i) => i.id);
    for (const id of ids) {
      const cur = this.items.get(id)!;
      const formats = { ...cur.formats };
      // 성공한 포맷은 다시 만들지 않는다
      for (const k of Object.keys(formats)) {
        if (formats[k] !== 'done') formats[k] = 'pending';
      }
      this.items.set(id, { ...cur, status: 'pending', error: null, formats });
      this.pending.push(id);
    }
    this.emit();
    this.pump();
  }

  snapshot(): JobItem[] {
    return Array.from(this.items.values()).map((i) => ({ ...i, formats: { ...i.formats } }));
  }

  subscribe(fn: (items: JobItem[]) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  idle(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.subscribers) {
      try {
        fn(snap);
      } catch {
        // 구독자 오류는 큐 상태와 무관한 구독자만의 문제다. 여기서 삼키지 않으면
        // (a) 이 구독자 이후의 다른 구독자에게 알림이 가지 않고, (b) 호출 위치가
        // runOne의 try 이전이면 running--를 도는 finally에 도달하지 못해 동시성
        // 슬롯이 영원히 새고, (c) 호출 위치가 finally 안이면 그 뒤의 pump()가
        // 실행되지 않아 대기 중인 항목이 처리되지 않고 idle() 대기자도 영원히
        // 풀리지 않는다. 로거가 없어 조용히 무시하지만, 의도된 것이다.
      }
    }
  }

  private settleIdle(): void {
    if (this.running === 0 && this.pending.length === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      this.running++;
      void this.runOne(id);
    }
    this.settleIdle();
  }

  private async runOne(id: string): Promise<void> {
    const start = this.items.get(id)!;
    this.items.set(id, { ...start, status: 'running' });
    this.emit();

    try {
      const formats = await this.worker(this.items.get(id)!);
      const failed = Object.values(formats).some((s) => s === 'failed');
      this.items.set(id, {
        ...this.items.get(id)!,
        status: failed ? 'failed' : 'done',
        formats,
        error: failed ? '일부 포맷 변환에 실패했습니다' : null
      });
    } catch (err) {
      const cur = this.items.get(id)!;
      // 워커가 부분 진행 상태를 실어 보냈으면 기존 formats 위에 그것을 병합해서
      // 남긴다(부분 맵이어도 언급되지 않은 포맷은 기존 상태를 유지). formats가
      // 없거나 JobFailure가 아니면 실행 전 상태를 그대로 남긴다. 그러지 않으면
      // 이미 성공한 포맷이 pending으로 되돌아가 재시도 때 다시 변환되고, 그
      // 재시도가 실패하면 convert의 정리 로직이 멀쩡한 파일을 지운다.
      const formats =
        err instanceof JobFailure && err.formats
          ? { ...cur.formats, ...err.formats }
          : cur.formats;
      this.items.set(id, {
        ...cur,
        status: 'failed',
        formats,
        error: (err as Error).message
      });
    } finally {
      this.running--;
      this.emit();
      this.pump();
    }
  }
}
