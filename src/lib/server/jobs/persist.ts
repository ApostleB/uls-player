import path from 'node:path';
import type { AppConfig, JobItem, JobsFile } from '$lib/types';
import { readJson, updateJson } from '../store/atomic';
import type { JobQueue } from './queue';

const EMPTY: JobsFile = { version: 1, items: [] };

function file(cfg: AppConfig): string {
  return path.join(cfg.dataDir, 'jobs.json');
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
 */
export function persistQueue(cfg: AppConfig, queue: JobQueue): void {
  queue.subscribe((items) => {
    void updateJson<JobsFile>(
      file(cfg),
      (cur) => {
        const byId = new Map(cur.items.map((i) => [i.id, i]));
        for (const i of items) byId.set(i.id, i);
        return { ...cur, items: Array.from(byId.values()) };
      },
      EMPTY
    );
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
