import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, JobItem } from '$lib/types';
import { loadConfig } from '../config';
import { JobQueue } from './queue';
import { persistQueue, loadUnfinished } from './persist';

function item(id: string): JobItem {
  return {
    id, recordingId: `rec-${id}`, sourcePath: `/tmp/${id}.qta`, title: id,
    status: 'pending', formats: { mp3: 'pending' }, error: null
  };
}

/**
 * persistQueue의 구독 콜백은 큐가 바뀔 때마다 jobs.json을 비동기로 다시
 * 쓴다(fire-and-forget). q.idle()이 끝나도 마지막 updateJson 쓰기가 디스크에
 * 반영되기까지는 한 틱 더 걸린다. 브리프 원안은 고정 50ms sleep으로 이
 * 틈을 메웠는데, 전체 스위트를 함께 돌리면(파일 I/O가 몰려 시스템이
 * 바빠지면) 50ms 안에 쓰기가 끝나지 않아 간헐적으로 실패하는 게 실측으로
 * 확인됐다 — 이 프로젝트가 이미 한 번 "고정 sleep 제거"로 정리한 것과 같은
 * 종류의 결함이다. 조건이 실제로 성립할 때까지 짧은 간격으로 다시 읽는
 * 방식으로 바꿔 타이밍에 기대지 않게 한다.
 */
async function waitForJobsFile(
  cfg: AppConfig,
  predicate: (raw: { items: JobItem[] }) => boolean,
  timeoutMs = 3000
): Promise<{ items: JobItem[] }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const raw = JSON.parse(
        await fs.readFile(path.join(cfg.dataDir, 'jobs.json'), 'utf8')
      ) as { items: JobItem[] };
      if (predicate(raw)) return raw;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // 아직 첫 쓰기 전이면 파일이 없다 — 계속 기다린다.
    }
    if (Date.now() > deadline) {
      throw new Error('jobs.json이 기대한 상태에 도달하지 못했습니다(시간 초과)');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

let dir: string;
let cfg: AppConfig;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-persist-'));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data') });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('persistQueue', () => {
  it('큐 상태를 jobs.json에 남긴다', async () => {
    const q = new JobQueue(1, async () => ({ mp3: 'done' }));
    persistQueue(cfg, q);
    q.enqueue([item('a')]);
    await q.idle();

    const raw = await waitForJobsFile(cfg, (r) => r.items[0]?.status === 'done');
    expect(raw.items).toHaveLength(1);
    expect(raw.items[0].status).toBe('done');
  });

  // 위 테스트는 항목 하나만 다룬다. persistQueue의 구독 콜백은 큐가 바뀔
  // 때마다(각 항목의 running 전이, 완료 전이 등) 매번 updateJson을 부르므로,
  // 동시에 여러 항목이 겹쳐서 끝나면 그만큼 겹쳐서 updateJson 호출이
  // 몰린다. atomic.ts의 경로별 체인이 그 자체로는 유실을 막아준다는 건
  // atomic.test.ts가 이미 확인했지만, persistQueue가 그 체인을 실제로
  // 타는지(예: 매번 다른 파일 경로를 계산한다거나, mutate가 cur.items가
  // 아니라 클로저의 stale한 items를 쓰는 실수가 있었다면 최종 상태가
  // 어긋난다)는 여기서 직접 확인해야 의미가 있다.
  it('여러 항목이 겹쳐서 완료돼도 jobs.json이 최종 스냅샷과 어긋나지 않는다', async () => {
    const delays: Record<string, number> = { a: 30, b: 5, c: 20, d: 0, e: 15 };
    const q = new JobQueue(5, async (i) => {
      await new Promise((r) => setTimeout(r, delays[i.id] ?? 0));
      return { mp3: 'done' };
    });
    persistQueue(cfg, q);
    q.enqueue(['a', 'b', 'c', 'd', 'e'].map(item));
    await q.idle();

    const raw = await waitForJobsFile(
      cfg,
      (r) => r.items.length === 5 && r.items.every((i) => i.status === 'done')
    );
    expect(raw.items).toHaveLength(5);
    expect(raw.items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(raw.items.every((i) => i.status === 'done')).toBe(true);
  });

  /**
   * 실제 서버로 재시작 시나리오를 재현하다가 발견한 결함: 재시작한 프로세스의
   * 새 JobQueue는 loadUnfinished가 돌려준(=이전에 pending/running이었던)
   * 항목만 들고 시작하고, 이미 done으로 끝나 있던 항목은 이 큐의 메모리에
   * 아예 없다. persistQueue의 구독 콜백이 queue.subscribe가 주는 items로
   * jobs.json의 items를 통째로 교체하면, 재시작 직후 이 새 큐가 처음 emit할
   * 때 disk에 있던 done 이력이 전부 지워진다 — "재시작 → 미완료 작업 복구"를
   * 만드는 코드가 완료된 작업의 기록을 지우는 역설이 된다.
   */
  it('재시작으로 새로 만든 큐가 이전에 done으로 남아있던 항목의 기록을 지우지 않는다', async () => {
    // 이전 프로세스가 남긴 jobs.json: done 2개 + 중단된 running 1개.
    await fs.mkdir(cfg.dataDir, { recursive: true });
    await fs.writeFile(
      path.join(cfg.dataDir, 'jobs.json'),
      JSON.stringify({
        version: 1,
        items: [
          { ...item('old-done-1'), status: 'done' },
          { ...item('old-done-2'), status: 'done' },
          { ...item('was-running'), status: 'running' }
        ]
      })
    );

    // getQueue의 실제 배선과 같은 모양: 재시작한 프로세스는 새 큐를 만들고,
    // loadUnfinished가 돌려준(=was-running만 pending으로 되돌린) 항목만
    // 올린다. done이었던 두 항목은 이 새 큐에 전혀 알려지지 않는다.
    const unfinished = await loadUnfinished(cfg);
    expect(unfinished.map((i) => i.id)).toEqual(['was-running']);

    const q = new JobQueue(1, async () => ({ mp3: 'done' }));
    persistQueue(cfg, q);
    q.enqueue(unfinished);
    await q.idle();

    const raw = await waitForJobsFile(
      cfg,
      (r) => r.items.find((i) => i.id === 'was-running')?.status === 'done'
    );
    // 이전에 done이었던 두 항목이 여전히 남아 있어야 한다.
    expect(raw.items.map((i) => i.id).sort()).toEqual([
      'old-done-1',
      'old-done-2',
      'was-running'
    ]);
    expect(raw.items.find((i) => i.id === 'old-done-1')!.status).toBe('done');
    expect(raw.items.find((i) => i.id === 'old-done-2')!.status).toBe('done');
    expect(raw.items.find((i) => i.id === 'was-running')!.status).toBe('done');
  });
});

describe('loadUnfinished', () => {
  it('파일이 없으면 빈 배열이다', async () => {
    expect(await loadUnfinished(cfg)).toEqual([]);
  });

  it('완료된 작업은 빼고 미완료만 준다', async () => {
    await fs.mkdir(cfg.dataDir, { recursive: true });
    await fs.writeFile(
      path.join(cfg.dataDir, 'jobs.json'),
      JSON.stringify({
        version: 1,
        items: [
          { ...item('done'), status: 'done' },
          { ...item('failed'), status: 'failed' },
          { ...item('running'), status: 'running' },
          item('pending')
        ]
      })
    );
    const left = await loadUnfinished(cfg);
    expect(left.map((i) => i.id).sort()).toEqual(['pending', 'running']);
    // 중단된 running은 pending으로 되돌려 다시 돌게 한다
    expect(left.every((i) => i.status === 'pending')).toBe(true);
  });
});
