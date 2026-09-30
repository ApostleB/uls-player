import net from 'node:net';

/**
 * OS에게 빈 TCP 포트를 하나 물어본다. 포트 0으로 바인딩하면 커널이
 * 사용 중이 아닌 번호를 골라 주므로, 그 번호를 읽고 바로 닫는다.
 *
 * 닫은 뒤 서버가 실제로 바인딩하기까지 짧은 경합 구간이 남는다. 그래도
 * 고정 포트보다 낫다: 고정 포트는 "누가 이미 쓰고 있으면 항상 실패"지만
 * 이쪽은 "그 찰나에 다른 프로그램이 같은 번호를 가져가면 실패"라 훨씬
 * 드물다. 실패하면 main의 기동 대기가 시간 초과로 걸러낸다.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('빈 포트를 알아내지 못했습니다')));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}
