import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestHandler } from './$types';

// 큐 자체(구독/스냅샷)를 스텁으로 갈아끼워서, 스트림의 생명주기 관리
// (start에서 구독, cancel에서 정리)만 독립적으로 검증한다. 큐 내부 동작은
// jobs/queue.test.ts에서 이미 다룬다.
//
// SSE 스트림 전체(하트비트 타이밍, 실제 네트워크 연결 종료 등)를 브라우저 없이
// 온전히 재현하는 건 브리틀해질 뿐이라 시도하지 않는다. 대신 "탭을 닫으면
// cancel()이 불려서 cleanup(구독 해지 + 하트비트 타이머 해제)이 실행되는가"만
// 결정론적으로 확인한다 — 브리핑이 지목한, 실제로 새는 부분이다.
const unsub = vi.fn();
const fakeQueue = {
  snapshot: vi.fn(() => []),
  subscribe: vi.fn(() => unsub)
};

vi.mock('$lib/server/jobs/runner', () => ({
  getQueue: vi.fn(() => fakeQueue)
}));

import { GET } from './+server';

beforeEach(() => {
  unsub.mockClear();
  fakeQueue.snapshot.mockClear();
  fakeQueue.subscribe.mockClear();
});

function event() {
  return {} as unknown as Parameters<RequestHandler>[0];
}

describe('GET /api/jobs/events', () => {
  it('시작하자마자 큐를 구독하고 스냅샷을 첫 프레임으로 보낸다', async () => {
    const res = await GET(event());

    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(fakeQueue.subscribe).toHaveBeenCalledTimes(1);

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe('data: []\n\n');

    await reader.cancel();
  });

  it('스트림이 취소되면(탭 닫힘 등) 큐 구독을 해지하고 하트비트 타이머를 정리한다', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const res = await GET(event());

    // 취소 전에는 아직 구독 해지도, 타이머 정리도 일어나지 않았다
    expect(unsub).not.toHaveBeenCalled();

    await res.body!.cancel();

    // cleanup은 클로저 변수라 cancel에서 실제로 호출될 수 있어야 한다 —
    // controller에 매달아뒀다면(브리프가 경고한 실수) 이 두 단언 중 최소
    // 하나는 실패한다.
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  });

  it('취소하지 않으면 구독은 해지되지 않는다 (대조군)', async () => {
    const res = await GET(event());
    // 취소를 호출하지 않았으므로 unsub은 불리지 않아야 한다
    expect(unsub).not.toHaveBeenCalled();
    // 15초 하트비트 타이머가 프로세스에 계속 살아있지 않도록 검증 후 정리한다
    await res.body!.cancel();
  });
});
