import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from './$types';
import type { ScanItem } from '$lib/types';

// buildJobs는 실제 구현을 그대로 쓴다 — fs 쓰기가 없는 순수 조립 함수라
// (레지스트리는 인메모리) 실제로 돌려도 안전하고, "유효한 enqueue가 실제로
// buildJobs를 거쳐 큐에 잡을 올린다"를 의미 있게 검증하려면 진짜 조립
// 로직이 필요하다. getQueue만 가짜로 바꿔서, 실제 큐(변환·ffmpeg·파일 IO를
// 일으키는 프로세스 싱글턴)를 절대 건드리지 않는다.
const fakeQueue = { enqueue: vi.fn() };

vi.mock('$lib/server/jobs/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/jobs/runner')>();
  return {
    ...actual,
    buildJobs: vi.fn(actual.buildJobs),
    getQueue: vi.fn(() => fakeQueue)
  };
});

// freeBytes만 감싼다 — 기본 동작은 실제 구현(실제 디스크를 잰다) 그대로
// 통과시키고, 디스크 여유 확인 테스트에서만 한 번 값을 바꿔치기한다.
// estimateBytes·DiskShortage는 실제 구현을 그대로 쓴다.
vi.mock('$lib/server/disk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/disk')>();
  return { ...actual, freeBytes: vi.fn(actual.freeBytes) };
});

import { actions } from './+page.server';
import { config } from '$lib/server/config';
import * as runner from '$lib/server/jobs/runner';
import * as disk from '$lib/server/disk';

const buildJobsSpy = vi.mocked(runner.buildJobs);
const getQueueSpy = vi.mocked(runner.getQueue);
const freeBytesSpy = vi.mocked(disk.freeBytes);

// scanFolder/config는 모킹하지 않는다. 폴더 관련 테스트(빈 값·공백·존재하지
// 않는 경로) 상당수가 scanFolder의 첫 줄(fs.readdir)에서 끝나거나 그
// 이전에 끝나서 cfg.dataDir을 건드리지 않으므로, 실제 싱글턴 config를
// 그대로 써도 프로젝트의 실제 data/ 디렉터리를 건드리지 않는다. enqueue는
// 이제 매번 서버에서 재스캔하므로(신뢰 경계 수정), 실제 파일이 있는 격리된
// tmp 폴더가 필요한 테스트가 늘었다 — 전부 makeFolder로 만들고 finally에서
// 지운다.
const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');

function event(fd: FormData): RequestEvent {
  return {
    request: new Request('http://localhost/import', { method: 'POST', body: fd })
  } as unknown as RequestEvent;
}

function scanEvent(folder: string): RequestEvent {
  const fd = new FormData();
  fd.set('folder', folder);
  return event(fd);
}

/** items가 문자열이면(손상된 JSON을 흉내낼 때) 그대로, 아니면 JSON.stringify해서 보낸다. */
function enqueueEvent(folder: string, items: unknown): RequestEvent {
  const fd = new FormData();
  fd.set('folder', folder);
  fd.set('items', typeof items === 'string' ? items : JSON.stringify(items));
  return event(fd);
}

async function makeFolder(names: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-page-server-enqueue-'));
  for (const n of names) {
    await fs.copyFile(SPATIAL, path.join(dir, n));
  }
  return dir;
}

beforeEach(() => {
  buildJobsSpy.mockClear();
  getQueueSpy.mockClear();
  fakeQueue.enqueue.mockClear();
  // vi.fn(impl)로 만든 목은 mockReset해도 그 impl(실제 freeBytes)로
  // 되돌아간다 — 이전 테스트가 등록해둔 mockResolvedValueOnce/
  // mockRejectedValueOnce가 소비되지 않은 채 남아 다음 테스트로 새는 것을
  // 막는다(runner.test.ts와 같은 패턴).
  freeBytesSpy.mockReset();
});

describe('scan 액션', () => {
  it('빈 문자열 폴더 경로는 거부한다', async () => {
    const res = await actions.scan(scanEvent(''));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/폴더 경로를 입력하세요/);
  });

  it('공백만 있는 폴더 경로는 거부한다 (trim 확인)', async () => {
    const res = await actions.scan(scanEvent('   '));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/폴더 경로를 입력하세요/);
  });

  it('존재하지 않는 폴더는 예외를 던지지 않고 400 실패로 감싼다', async () => {
    const missing = path.join(os.tmpdir(), `uls-page-server-missing-${randomUUID()}`);
    // await가 reject하면(=예외가 그대로 샜다면) 이 테스트 자체가 실패한다 —
    // "던지지 않는다"를 별도 try/catch 없이 자연스럽게 검증한다.
    const res = await actions.scan(scanEvent(missing));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/폴더를 읽을 수 없습니다/);
  });

  it('유효한 폴더를 스캔하면 항목 배열과 스캔한 폴더 경로를 돌려준다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-page-server-scan-'));
    try {
      await fs.copyFile(SPATIAL, path.join(dir, 'sample.qta'));
      const res = await actions.scan(scanEvent(dir));
      const out = res as { items: ScanItem[]; folder: string };
      expect(out.items).toHaveLength(1);
      expect(out.items[0].sourceName).toBe('sample.qta');
      expect(out.items[0].error).toBeNull();
      expect(out.items[0].duplicate).toBe(false);
      // enqueue가 나중에 이 folder로 재스캔하므로, scan이 실제로 읽은
      // 경로를 그대로 돌려주는지가 중요하다.
      expect(out.folder).toBe(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('enqueue 액션 — 입력 검증', () => {
  it('폴더 경로가 없으면 거부한다', async () => {
    const res = await actions.enqueue(
      enqueueEvent('', [{ sourceName: 'x', title: 'x', description: '', tags: [] }])
    );
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/폴더 경로가 없습니다/);
    expect(buildJobsSpy).not.toHaveBeenCalled();
    expect(getQueueSpy).not.toHaveBeenCalled();
  });

  it('손상된 JSON items는 거부하고 buildJobs/큐를 건드리지 않는다', async () => {
    const res = await actions.enqueue(enqueueEvent('아무폴더', '{이건 JSON이 아니다'));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/보낼 항목을 읽을 수 없습니다/);
    expect(buildJobsSpy).not.toHaveBeenCalled();
    expect(getQueueSpy).not.toHaveBeenCalled();
    expect(fakeQueue.enqueue).not.toHaveBeenCalled();
  });

  it('items가 배열이 아니면 400이고 buildJobs/큐를 건드리지 않는다', async () => {
    const res = await actions.enqueue(
      enqueueEvent('아무폴더', { sourceName: 'x', title: 'x', description: '', tags: [] })
    );
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/형식이 올바르지 않습니다/);
    expect(buildJobsSpy).not.toHaveBeenCalled();
    expect(getQueueSpy).not.toHaveBeenCalled();
  });

  it('items 배열 원소가 필요한 필드를 갖추지 못하면 400이다', async () => {
    const res = await actions.enqueue(enqueueEvent('아무폴더', [{ sourceName: 'x' }]));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/형식이 올바르지 않습니다/);
    expect(buildJobsSpy).not.toHaveBeenCalled();
  });

  it('빈 배열 items는 거부하고 buildJobs/큐를 건드리지 않는다', async () => {
    const res = await actions.enqueue(enqueueEvent('아무폴더', []));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/선택된 항목이 없습니다/);
    expect(buildJobsSpy).not.toHaveBeenCalled();
    expect(getQueueSpy).not.toHaveBeenCalled();
    expect(fakeQueue.enqueue).not.toHaveBeenCalled();
  });

  it('저장 시점에 폴더를 다시 읽을 수 없으면(그 사이 삭제 등) 깨끗하게 실패한다', async () => {
    const dir = await makeFolder(['sample.qta']);
    await fs.rm(dir, { recursive: true, force: true }); // 스캔 이후 폴더가 사라진 상황을 흉내낸다
    const items = [{ sourceName: 'sample.qta', title: 'A', description: '', tags: [] }];
    const res = await actions.enqueue(enqueueEvent(dir, items));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/폴더를 다시 읽을 수 없습니다/);
    expect(buildJobsSpy).not.toHaveBeenCalled();
    expect(getQueueSpy).not.toHaveBeenCalled();
  });
});

describe('enqueue 액션 — 신뢰 경계 (서버 재스캔)', () => {
  it('클라이언트가 보낸 sourcePath는 무시하고 서버가 다시 스캔한 경로를 쓴다', async () => {
    const dir = await makeFolder(['sample.qta']);
    try {
      const items = [
        {
          sourceName: 'sample.qta',
          title: '제목',
          description: '',
          tags: [],
          // ClientItem 타입에는 없는 필드지만, 요청 바디는 클라이언트가
          // 직접 조작해서 뭐든 실어보낼 수 있다 — 서버가 이 필드를
          // 절대 읽지 않는지를 검증한다(임의 경로를 media/original로
          // 복사시키는 걸 여기서 막는다).
          sourcePath: '/etc/passwd'
        }
      ];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);
      const jobsArg = fakeQueue.enqueue.mock.calls[0][0];
      expect(jobsArg).toHaveLength(1);
      expect(jobsArg[0].sourcePath).toBe(path.join(dir, 'sample.qta'));
      expect(jobsArg[0].sourcePath).not.toBe('/etc/passwd');
      expect(res).toEqual({ queued: 1, skipped: 0 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('재스캔 결과에 없는 sourceName은 건너뛰고 skipped로 보고한다', async () => {
    const dir = await makeFolder(['sample.qta']);
    try {
      const items = [
        { sourceName: 'sample.qta', title: 'A', description: '', tags: [] },
        // ghost.qta는 폴더에 실제로 없다 — 스캔 이후 지워지거나 이름이
        // 바뀐 상황을 흉내낸다.
        { sourceName: 'ghost.qta', title: 'B', description: '', tags: [] }
      ];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);
      const jobsArg = fakeQueue.enqueue.mock.calls[0][0];
      expect(jobsArg).toHaveLength(1);
      expect(jobsArg[0].title).toBe('A');
      expect(res).toEqual({ queued: 1, skipped: 1 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('전부 건너뛰면 조용히 0개를 올리지 않고 깨끗하게 실패한다', async () => {
    const dir = await makeFolder(['sample.qta']);
    try {
      const items = [{ sourceName: 'ghost.qta', title: 'B', description: '', tags: [] }];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(res).toMatchObject({ status: 400 });
      expect((res as { data: { message: string } }).data.message).toMatch(
        /가져올 수 있는 항목이 없습니다/
      );
      expect(buildJobsSpy).not.toHaveBeenCalled();
      expect(getQueueSpy).not.toHaveBeenCalled();
      expect(fakeQueue.enqueue).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('유효한 요청은 재스캔한 서버 데이터로 실제로 buildJobs를 거쳐 큐에 잡을 올린다', async () => {
    const dir = await makeFolder(['sample.qta']);
    try {
      const items = [{ sourceName: 'sample.qta', title: '레인', description: '데모', tags: ['1절'] }];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(buildJobsSpy).toHaveBeenCalledTimes(1);
      const [[cfgArg, pendingArg]] = buildJobsSpy.mock.calls;
      expect(cfgArg).toBe(config);
      expect(pendingArg).toHaveLength(1);
      expect(pendingArg[0].scan.sourceName).toBe('sample.qta');
      expect(pendingArg[0].scan.sourcePath).toBe(path.join(dir, 'sample.qta'));
      expect(pendingArg[0].title).toBe('레인');
      expect(pendingArg[0].description).toBe('데모');
      expect(pendingArg[0].tags).toEqual(['1절']);

      expect(getQueueSpy).toHaveBeenCalledWith(config);
      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);
      const jobsArg = fakeQueue.enqueue.mock.calls[0][0];
      expect(jobsArg).toHaveLength(1);
      expect(jobsArg[0].sourcePath).toBe(path.join(dir, 'sample.qta'));
      expect(jobsArg[0].title).toBe('레인');
      expect(jobsArg[0].status).toBe('pending');

      expect(res).toEqual({ queued: 1, skipped: 0 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('enqueue 액션 — 디스크 여유 확인', () => {
  it('예상 용량이 여유 공간보다 크면 507로 거부하고 buildJobs/큐를 건드리지 않는다', async () => {
    const dir = await makeFolder(['sample.qta']);
    try {
      // 실제 sourceBytes가 얼마든 여유가 0이면 반드시 부족하다고 판정된다.
      freeBytesSpy.mockResolvedValueOnce(0);
      const items = [{ sourceName: 'sample.qta', title: 'A', description: '', tags: [] }];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(res).toMatchObject({ status: 507 });
      expect((res as { data: { message: string } }).data.message).toMatch(
        /디스크 여유가 부족합니다/
      );
      expect(buildJobsSpy).not.toHaveBeenCalled();
      expect(getQueueSpy).not.toHaveBeenCalled();
      expect(fakeQueue.enqueue).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('여유 공간이 충분하면 평소대로 진행한다', async () => {
    const dir = await makeFolder(['sample.qta']);
    try {
      freeBytesSpy.mockResolvedValueOnce(Number.MAX_SAFE_INTEGER);
      const items = [{ sourceName: 'sample.qta', title: 'A', description: '', tags: [] }];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(res).toEqual({ queued: 1, skipped: 0 });
      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('여유 공간을 잴 수 없으면(측정 실패) 막지 않고 그대로 진행한다', async () => {
    const dir = await makeFolder(['sample.qta']);
    try {
      freeBytesSpy.mockRejectedValueOnce(new Error('statfs 실패'));
      const items = [{ sourceName: 'sample.qta', title: 'A', description: '', tags: [] }];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      // 측정이 안 됐다고 507로 막으면 안 된다 — 정상적으로 큐에 올라간다.
      expect(res).toEqual({ queued: 1, skipped: 0 });
      expect(getQueueSpy).toHaveBeenCalledWith(config);
      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
