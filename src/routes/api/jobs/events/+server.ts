import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getQueue } from '$lib/server/jobs/runner';

export const GET: RequestHandler = async () => {
  const queue = getQueue(config);
  const encoder = new TextEncoder();

  // 정리 함수를 클로저에 둬야 cancel에서 실제로 부를 수 있다.
  // controller에 매달아두면 호출되지 않아 구독과 타이머가 새어나간다.
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (items: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(items)}\n\n`));
      };
      send(queue.snapshot());

      const off = queue.subscribe(send);
      // 프록시가 유휴 연결을 끊지 않게 주기적으로 주석 프레임을 보낸다
      const beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': beat\n\n'));
        } catch {
          cleanup();
        }
      }, 15000);

      cleanup = () => {
        off();
        clearInterval(beat);
      };
    },
    cancel() {
      cleanup();
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
};
