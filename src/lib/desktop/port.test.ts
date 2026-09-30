import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { findFreePort } from './port';

/** 그 포트를 실제로 열어 보고 바로 닫는다. 열리면 정말 비어 있던 것이다. */
function bindOnce(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()));
  });
}

describe('빈 포트 고르기', () => {
  it('0이 아닌 포트 번호를 준다', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
  });

  it('돌려준 포트를 곧바로 바인딩할 수 있다 — 즉 잡고 있지 않다', async () => {
    const port = await findFreePort();
    await expect(bindOnce(port)).resolves.toBeUndefined();
  });

  it('연달아 불러도 매번 바인딩 가능한 포트를 준다', async () => {
    for (let i = 0; i < 3; i++) {
      const port = await findFreePort();
      await expect(bindOnce(port)).resolves.toBeUndefined();
    }
  });
});
