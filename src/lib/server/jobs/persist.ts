import path from 'node:path';
import type { AppConfig, JobItem, JobsFile } from '$lib/types';
import { readJson, updateJson } from '../store/atomic';
import type { JobQueue } from './queue';

const EMPTY: JobsFile = { version: 1, items: [] };

function file(cfg: AppConfig): string {
  return path.join(cfg.dataDir, 'jobs.json');
}

/** runner.ts 등 다른 모듈이 jobs.json 경로를 하드코딩하지 않고 재사용할 수 있게 한다. */
export function jobsFilePath(cfg: AppConfig): string {
  return file(cfg);
}

/**
 * jobs.json에 남겨둘 done 항목 개수의 상한.
 *
 * merge-by-id(아래)는 재시작 후 done 이력이 지워지는 버그는 고쳤지만,
 * 그 자체로는 성장을 막는 장치가 없다 — 버그가 있던 전체 교체 버전은
 * "재시작마다 done을 잃는다"는 사고로 우연히 크기가 눌려 있었을 뿐이다.
 * 실제 라이브러리가 252개 안팎이니 그보다 넉넉히 위로 잡아 한 번의 전체
 * 가져오기 도중에는 잘리지 않게 하면서도, 여러 달에 걸쳐 무한정 쌓이는
 * 건 막는다. pending·running·failed는 이 상한과 무관하게 항상 남긴다 —
 * failed를 지우면 사용자가 재시도할 방법이 사라진다.
 */
const MAX_DONE_HISTORY = 500;

/**
 * done 항목이 상한을 넘으면 배열에 남은 순서상 앞쪽(오래된 쪽)부터 잘라낸다.
 * JobItem에는 완료 시각이 없어 "최근"을 정확히 잴 수 없다 — 배열 순서(대체로
 * jobs.json에 처음 실린 순서, 즉 enqueue 순서)를 근사치로 쓴다. 완벽하진
 * 않지만 무한정 자라는 것보다 낫다. pending·running·failed는 순서와 무관하게
 * 하나도 건드리지 않는다.
 */
function prune(items: JobItem[]): JobItem[] {
  const doneIds = items.filter((i) => i.status === 'done').map((i) => i.id);
  if (doneIds.length <= MAX_DONE_HISTORY) return items;
  const drop = new Set(doneIds.slice(0, doneIds.length - MAX_DONE_HISTORY));
  return items.filter((i) => !drop.has(i.id));
}

/**
 * 큐가 바뀔 때마다 jobs.json에 스냅샷을 남긴다.
 *
 * queue.subscribe가 주는 items는 "이 큐 인스턴스가 프로세스 안에서 아는
 * 전부"일 뿐, jobs.json에 있는 전부가 아니다 — 재시작 직후의 큐는
 * loadUnfinished가 돌려준 pending/running 항목만 들고 시작하고, 이미
 * done으로 끝나 있던 항목은(getQueue가 일부러 다시 올리지 않으므로) 이
 * 프로세스의 큐 메모리에 없다. 그런데도 그대로 덮어쓰면(cur를 무시하고
 * items로 통째로 교체하면) 재시작할 때마다 disk의 done 이력이 지워진다 —
 * "재시작 → 미완료 작업 복구"를 만드는 바로 그 코드가 완료된 작업의
 * 기록을 지우는 셈이다. id로 병합해서, 이번에 받은 items는 갱신/추가하되
 * 큐가 모르는(이 프로세스에서 다시 올리지 않은) 기존 항목은 그대로 둔다.
 *
 * updateJson의 반환 Promise를 일부러 await하지 않고(fire-and-forget) 던져
 * 두되, 반드시 .catch로 받는다 — 이 코드베이스에서 await도 .catch도 없는
 * 유일한 updateJson 호출이 되면 안 된다. 쓰기가 실패하면(디스크 부족 등)
 * 처리되지 않은 거부(unhandled rejection)가 되어 Node 기본 핸들러가
 * 프로세스를 통째로 죽인다 — 이 태스크가 "디스크 압박에도 살아남게"
 * 만들려는 바로 그 상황에서, 진행 상황을 기록하려던 코드가 오히려
 * 배치 전체를 죽이는 역설이 된다. 큐의 인메모리 상태는 이 실패와 무관하게
 * 여전히 정확하고(변환 자체는 계속 진행 중이다), 다음 큐 변경이 오면
 * updateJson이 처음부터 다시 시도한다(atomic.ts의 경로별 체인은 실패해도
 * 스스로 리셋된다) — 그러니 삼켜도 안전하다.
 *
 * 다만 emit()의 구독자 오류(위 주석 참고)와 달리 이건 "저장이 안 되고
 * 있다"는 신호라 완전히 조용히 넘기면 안 된다 — 그러면 사용자도 운영자도
 * "진행 상황이 저장되고 있다"고 착각한 채로 있다가, 재시작 시점에야(또는
 * 영영) 알아차리게 된다. 이 프로젝트엔 로거·헬스체크·UI 알림 채널이
 * 없으므로(emit()의 주석과 같은 제약) 지금 쓸 수 있는 신호는 콘솔뿐이다.
 * UI 배지나 헬스체크 엔드포인트로 노출하는 건 이 태스크 범위를 벗어난다고
 * 보고 콘솔 기록으로 결정했다 — 적어도 서버 로그를 보는 사람에게는 파일
 * 경로와 원인이 남는다.
 */
export function persistQueue(cfg: AppConfig, queue: JobQueue): void {
  queue.subscribe((items) => {
    void updateJson<JobsFile>(
      file(cfg),
      (cur) => {
        const byId = new Map(cur.items.map((i) => [i.id, i]));
        for (const i of items) byId.set(i.id, i);
        return { ...cur, items: prune(Array.from(byId.values())) };
      },
      EMPTY
    ).catch((err) => {
      console.error(`jobs.json 쓰기 실패 — 진행 상황이 저장되지 않고 있습니다: ${file(cfg)}`, err);
    });
  });
}

/**
 * 재시작 시 이어서 돌릴 작업.
 * 중단된 running은 pending으로 되돌린다. failed는 사용자가 재시도를 눌러야 한다.
 */
export async function loadUnfinished(cfg: AppConfig): Promise<JobItem[]> {
  const { items } = await readJson<JobsFile>(file(cfg), EMPTY);
  return items
    .filter((i) => i.status === 'pending' || i.status === 'running')
    .map((i) => ({ ...i, status: 'pending' as const }));
}

/**
 * 상태와 무관하게 jobs.json에 있는 잡을 전부 돌려준다.
 *
 * loadUnfinished는 done·failed를 걸러내므로 그 용도로는 못 쓴다 — upload.ts의
 * sweepStaleStaging이 "아직 필요할 수 있는"(=done이 아닌) 잡의 sourcePath를
 * 골라 시작 시점 정리 스윕에서 보호할 폴더를 정하는 데 쓴다. failed도
 * 포함해야 한다: 실패한 잡은 사용자가 재시도하면 sourcePath를 다시 읽을 수
 * 있다(원본 복사 자체가 실패한 경우).
 */
export async function loadAllJobs(cfg: AppConfig): Promise<JobItem[]> {
  const { items } = await readJson<JobsFile>(file(cfg), EMPTY);
  return items;
}
