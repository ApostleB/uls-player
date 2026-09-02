import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, JobsFile } from '$lib/types';
import { loadConfig } from '$lib/server/config';
import { updateJson } from '$lib/server/store/atomic';
import { jobsFilePath } from '$lib/server/jobs/persist';
import { addMany, newId, getById } from '$lib/server/store/recordings';

// hooks.server.ts는 싱글턴 config를 그대로 임포트해서 쓴다 — 테스트에서
// 임시 디렉터리를 가리키는 격리된 cfg를 쓰게 하려면 $lib/server/config
// 자체를 갈아끼워야 한다(다른 파일들처럼 loadConfig를 직접 부르는 걸로는
// hooks.server.ts 내부의 `config` 참조를 바꿀 수 없다).
const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const QTA_NAME = '20260711 181530-1923A106.qta';

let dir: string;
let src: string;
let cfg: AppConfig;

vi.mock('$lib/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/config')>();
  return {
    ...actual,
    get config() {
      return cfg;
    }
  };
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-hooks-init-'));
  src = path.join(dir, 'src');
  await fs.mkdir(src, { recursive: true });
  await fs.copyFile(SPATIAL, path.join(src, QTA_NAME));
  cfg = loadConfig({
    DATA_DIR: path.join(dir, 'data'),
    MEDIA_DIR: path.join(dir, 'media'),
    WAVEFORM_PEAKS: '64'
  });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * Must Fix 1: getQueue(cfg)를 부르는 자리가 enqueue 액션·SSE 엔드포인트·
 * 재시도 엔드포인트뿐이었다 — 셋 다 사용자가 뭔가 누른 뒤에야 실행된다.
 * hooks.server.ts가 없던 개선 전 코드에서는 이 테스트가 애초에 import
 * 대상 파일이 없어(모듈을 찾지 못해) 실패한다.
 *
 * 아래는 "서버가 시작할 때(=init 훅이 불릴 때) 재시작 복구가 실제로
 * 동작해서 멈춰 있던 잡이 끝까지 처리된다"를 jobs.json·recordings.json에
 * 직접 상태를 심어두고 확인한다 — getQueue를 모킹해 "호출됐다"만 보는
 * 얕은 테스트로는 실제 복구가 도는지까지 보장하지 못한다.
 *
 * recordings.json에도 해당 id의 레코딩을 미리 심어두는 이유: 복구된
 * 잡은 pendingRecordings(인메모리 레지스트리)가 비어 있으므로 runner.ts가
 * patch() 경로를 탄다 — patch()는 저장소에 그 id가 이미 있어야 성공한다.
 * (recordings.json에도 없는 "완전한 고아" 잡의 경우 runner.ts가 의도적으로
 * "다시 가져오세요" 안내 메시지와 함께 failed로 남긴다 — 그건
 * runner.test.ts의 "재시작 복구 — pendingRecordings에도 저장소에도 원본이
 * 없을 때"가 이미 별도로 검증하는 다른 시나리오다. 이 테스트는 hooks가
 * getQueue 복구를 실제로 트리거하는지가 관심사이므로, 정상적으로 done까지
 * 갈 수 있는 입력을 준다.)
 */
describe('hooks.server init — 서버 시작 시 재시작 복구', () => {
  it('첫 요청 전에 jobs.json의 미완료 작업을 복구해 실제로 처리하고 recordings.json에 반영한다', async () => {
    const recordingId = newId();
    await addMany(cfg, [
      {
        id: recordingId,
        title: '재시작 전 시작된 녹음',
        description: '',
        tags: [],
        recordedAt: '2026-07-11T18:15:30+09:00',
        durationSec: 2.3,
        sourceName: QTA_NAME,
        appleAutoTitle: null,
        files: {},
        bookmarks: [],
        createdAt: '2026-08-31T00:00:00+09:00',
        updatedAt: '2026-08-31T00:00:00+09:00',
        deletedAt: null
      }
    ]);

    const pendingJob = {
      id: 'resumed-job-1',
      recordingId,
      sourcePath: path.join(src, QTA_NAME),
      title: '재시작 전 시작된 녹음',
      status: 'pending' as const,
      formats: { mp3: 'pending' as const, wav: 'pending' as const },
      error: null
    };
    await updateJson<JobsFile>(
      jobsFilePath(cfg),
      () => ({ version: 1, items: [pendingJob] }),
      { version: 1, items: [] }
    );

    const { init } = await import('./hooks.server');
    const { getQueue } = await import('$lib/server/jobs/runner');

    // 사용자가 "/"나 "/import"를 열기만 하는 것과 달리, 여기서는 다른
    // 어떤 라우트 핸들러도 getQueue를 부르지 않는다 — init 훅 자체만
    // 부른다. 이게 통과하면 "무언가를 클릭해야만 복구가 시작된다"는
    // 개선 전 버그가 없다는 뜻이다.
    await init?.();

    // getQueue 안의 loadUnfinished(cfg).then(...)은 fire-and-forget이라
    // getQueue()가 반환된 시점엔 아직 그 .then 콜백(복구된 잡을 큐에
    // enqueue하는 부분)이 안 돌았을 수 있다 — 여기서 바로 idle()을
    // 부르면 "아직 아무것도 큐에 안 들어온" 시점을 "할 일이 없다"로
    // 오인해 즉시 resolve해버린다. getQueue.recovery.test.ts와 같은
    // 패턴으로 그 마이크로태스크가 돌 시간을 준다.
    await new Promise((r) => setTimeout(r, 50));

    const queue = getQueue(cfg);
    await queue.idle();

    const item = queue.snapshot().find((j) => j.id === 'resumed-job-1');
    expect(item?.status).toBe('done');

    const rec = await getById(cfg, recordingId);
    expect(Object.keys(rec?.files ?? {}).sort()).toEqual(['mp3', 'original', 'wav']);
  });
});
