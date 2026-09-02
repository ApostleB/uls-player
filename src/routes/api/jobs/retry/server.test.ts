import { describe, it, expect, vi } from 'vitest';
import type { RequestHandler } from './$types';

// 브리프에는 지나가듯 언급만 됐지만 Task 13 UI가 실제로 호출하는 엔드포인트다.
// getQueue(config).retryFailed()로 위임하고 { ok: true }를 주는지만 확인한다
// — retryFailed 자체의 동작은 jobs/queue.test.ts에서 이미 검증됐다.
const retryFailed = vi.fn();
const fakeQueue = { retryFailed };

vi.mock('$lib/server/jobs/runner', () => ({
  getQueue: vi.fn(() => fakeQueue)
}));

import { POST } from './+server';
import { getQueue } from '$lib/server/jobs/runner';
import { config } from '$lib/server/config';

function event() {
  return {} as unknown as Parameters<RequestHandler>[0];
}

describe('POST /api/jobs/retry', () => {
  it('getQueue(config).retryFailed()를 호출하고 { ok: true }를 준다', async () => {
    const res = await POST(event());

    expect(getQueue).toHaveBeenCalledWith(config);
    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
