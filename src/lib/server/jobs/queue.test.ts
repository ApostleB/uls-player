import { describe, it, expect, vi } from 'vitest';
import type { JobItem, JobStatus } from '$lib/types';
import { JobQueue, JobFailure } from './queue';

function item(id: string): JobItem {
  return {
    id, recordingId: `rec-${id}`, sourcePath: `/tmp/${id}.qta`, title: id,
    status: 'pending', formats: { mp3: 'pending', wav: 'pending' }, error: null
  };
}

const ok: Record<string, JobStatus> = { mp3: 'done', wav: 'done' };

describe('JobQueue', () => {
  it('모든 항목을 처리한다', async () => {
    const seen: string[] = [];
    const q = new JobQueue(2, async (i) => {
      seen.push(i.id);
      return ok;
    });
    q.enqueue([item('a'), item('b'), item('c')]);
    await q.idle();
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
    expect(q.snapshot().every((i) => i.status === 'done')).toBe(true);
  });

  it('동시 실행 수를 넘지 않는다', async () => {
    let running = 0;
    let peak = 0;
    const q = new JobQueue(2, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return ok;
    });
    q.enqueue([item('a'), item('b'), item('c'), item('d'), item('e')]);
    await q.idle();
    expect(peak).toBe(2);
  });

  it('한 항목이 실패해도 나머지는 계속된다', async () => {
    const q = new JobQueue(1, async (i) => {
      if (i.id === 'b') throw new Error('boom');
      return ok;
    });
    q.enqueue([item('a'), item('b'), item('c')]);
    await q.idle();
    const s = q.snapshot();
    expect(s.find((i) => i.id === 'b')!.status).toBe('failed');
    expect(s.find((i) => i.id === 'b')!.error).toContain('boom');
    expect(s.filter((i) => i.status === 'done')).toHaveLength(2);
  });

  it('포맷별 부분 실패를 기록한다', async () => {
    const q = new JobQueue(1, async () => ({ mp3: 'done', wav: 'failed' }));
    q.enqueue([item('a')]);
    await q.idle();
    const a = q.snapshot()[0];
    expect(a.formats).toEqual({ mp3: 'done', wav: 'failed' });
    expect(a.status).toBe('failed');
  });

  it('retryFailed는 실패한 것만 다시 돌린다', async () => {
    let attempt = 0;
    const q = new JobQueue(1, async (i) => {
      attempt++;
      if (i.id === 'b' && attempt <= 2) throw new Error('일시 실패');
      return ok;
    });
    q.enqueue([item('a'), item('b')]);
    await q.idle();
    expect(q.snapshot().find((i) => i.id === 'b')!.status).toBe('failed');

    q.retryFailed();
    await q.idle();
    expect(q.snapshot().every((i) => i.status === 'done')).toBe(true);
  });

  it('구독자에게 변경을 알린다', async () => {
    const fn = vi.fn();
    const q = new JobQueue(1, async () => ok);
    const off = q.subscribe(fn);
    q.enqueue([item('a')]);
    await q.idle();
    expect(fn).toHaveBeenCalled();
    off();
    const before = fn.mock.calls.length;
    q.enqueue([item('b')]);
    await q.idle();
    expect(fn.mock.calls.length).toBe(before);
  });

  it('비어 있을 때 idle은 즉시 끝난다', async () => {
    const q = new JobQueue(2, async () => ok);
    await expect(q.idle()).resolves.toBeUndefined();
  });

  it('워커가 JobFailure에 부분 진행을 실어 던지면 그 상태를 남긴다', async () => {
    const q = new JobQueue(1, async () => {
      throw new JobFailure('파형 생성 실패', { mp3: 'done', wav: 'done' });
    });
    q.enqueue([item('a')]);
    await q.idle();

    const a = q.snapshot()[0];
    expect(a.status).toBe('failed');
    // 실행 이전 상태(전부 pending)로 되돌아가면 안 된다
    expect(a.formats).toEqual({ mp3: 'done', wav: 'done' });
  });

  it('부분 진행이 남으면 재시도가 이미 만든 포맷을 다시 만들지 않는다', async () => {
    let seen: Record<string, JobStatus> | null = null;
    let calls = 0;
    const q = new JobQueue(1, async (i) => {
      calls++;
      if (calls === 1) throw new JobFailure('파형 생성 실패', { mp3: 'done', wav: 'done' });
      seen = i.formats;
      return ok;
    });

    q.enqueue([item('a')]);
    await q.idle();
    q.retryFailed();
    await q.idle();

    // 재시도 워커가 받은 formats에 done이 보존돼야 러너가 convert를 건너뛴다
    expect(seen).toEqual({ mp3: 'done', wav: 'done' });
    expect(q.snapshot()[0].status).toBe('done');
  });
});
