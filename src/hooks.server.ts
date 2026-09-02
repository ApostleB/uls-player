import type { ServerInit } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { getQueue } from '$lib/server/jobs/runner';

/**
 * 이 파일이 비어 보인다고 지우면 안 된다 — 존재 자체가 수정 사항이다.
 *
 * getQueue(cfg)는 프로세스당 딱 한 번, 처음 호출될 때만 jobs.json의
 * 미완료 작업을 복구하고(loadUnfinished) 방치된 업로드 스테이징을
 * 정리한다(sweepStaleStaging) — runner.ts의 getQueue 주석 참고. 그런데
 * 그동안 getQueue를 실제로 부르는 자리는 enqueue 액션 / SSE 엔드포인트 /
 * 재시도 엔드포인트, 이 셋뿐이었다. 셋 다 "사용자가 뭔가를 누른 뒤에만"
 * 실행된다 — 그래서 서버가 배치 도중 재시작되면, 사용자가 "/"나
 * "/import"만 열어서는(아무 것도 클릭하지 않으면) 복구가 영영 시작되지
 * 않고 남은 작업이 무한정 멈춰 있었다. 새 배치를 저장해야 그제서야
 * (부수효과로) 복구가 돈다 — 스펙의 에러 처리표("서버 재시작 → jobs.json의
 * 미완료 작업을 시작 시 복구")를 어기는 상태였다.
 *
 * init 훅은 서버가 첫 요청에 응답하기 전에 정확히 한 번 실행된다
 * (https://svelte.dev/docs/kit/hooks#init) — 그러니 여기서 getQueue를
 * 불러두면 사용자가 무엇을 클릭하는지와 무관하게 복구가 항상 시작
 * 시점에 돈다. 큐 자체를 쓸 일이 없으므로 반환값은 버린다.
 */
export const init: ServerInit = () => {
  getQueue(config);
};
