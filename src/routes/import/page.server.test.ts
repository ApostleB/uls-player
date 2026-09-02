import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from './$types';
import type { JobItem, ScanItem } from '$lib/types';

// buildJobs는 실제 구현을 그대로 쓴다 — fs 쓰기가 없는 순수 조립 함수라
// (레지스트리는 인메모리) 실제로 돌려도 안전하고, "유효한 enqueue가 실제로
// buildJobs를 거쳐 큐에 잡을 올린다"를 의미 있게 검증하려면 진짜 조립
// 로직이 필요하다. getQueue만 가짜로 바꿔서, 실제 큐(변환·ffmpeg·파일 IO를
// 일으키는 프로세스 싱글턴)를 절대 건드리지 않는다.
// snapshot()은 Must Fix 2(진행 중인 잡과의 중복 방지)가 in-flight
// sourceName을 알아내려고 부른다 — 기본값은 빈 배열이라 대부분의 테스트는
// snapshot을 신경 쓸 필요가 없고, in-flight 관련 테스트만 mockReturnValueOnce로
// 채운다.
const fakeQueue = {
  enqueue: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  snapshot: vi.fn((): JobItem[] => [])
};

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

async function fileFrom(p: string, name: string): Promise<File> {
  return new File([await fs.readFile(p)], name);
}

/**
 * files로 실제 FormData를 만든다. contentLength를 안 주면 실제 바이트
 * 크기를 재서 content-length 헤더에 채운다 — 실제 브라우저의 네이티브
 * 멀티파트 POST가 항상 보내는 것과 같다. (로컬 Request 생성자는 undici가
 * 이걸 자동으로 채워주지 않는다 — node -e로 직접 확인했다: FormData
 * body를 준 Request가 별도 헤더 없이 만들어지면 content-length가 아예
 * 없다.) 그래서 기본 통과 케이스를 만드는 테스트조차 이 측정 없이는
 * "Content-Length 없음" 411 검사에 걸린다.
 *
 * contentLength에 문자열을 주면 실제 크기와 무관하게 그 값을 강제한다
 * (집계 한도 초과 재현용, undici가 명시적으로 준 헤더는 body로부터
 * 재계산하지 않고 그대로 존중한다는 것도 확인했다). null을 주면 헤더
 * 자체를 아예 안 보낸다(헤더 누락 케이스 재현용).
 */
async function uploadEvent(files: File[], contentLength?: string | null): Promise<RequestEvent> {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);

  let length: string | undefined;
  if (contentLength === null) {
    length = undefined;
  } else if (contentLength !== undefined) {
    length = contentLength;
  } else {
    const probe = new Request('http://localhost/probe', { method: 'POST', body: fd });
    length = String((await probe.arrayBuffer()).byteLength);
  }

  const headers = length !== undefined ? { 'content-length': length } : undefined;
  return {
    request: new Request('http://localhost/import', { method: 'POST', body: fd, headers })
  } as unknown as RequestEvent;
}

beforeEach(() => {
  buildJobsSpy.mockClear();
  getQueueSpy.mockClear();
  fakeQueue.enqueue.mockClear();
  fakeQueue.subscribe.mockClear();
  fakeQueue.snapshot.mockClear();
  fakeQueue.snapshot.mockReturnValue([]);
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

describe('upload 액션', () => {
  it('성공하면 항목 배열과 실제로 저장한 폴더 경로를 함께 돌려준다', async () => {
    const file = await fileFrom(SPATIAL, 'sample.qta');
    const res = await actions.upload(await uploadEvent([file]));
    const out = res as { items: ScanItem[]; folder: string };
    try {
      expect(out.items).toHaveLength(1);
      expect(out.items[0].sourceName).toBe('sample.qta');
      expect(out.items[0].error).toBeNull();
      // saveUploads가 os.tmpdir() 아래 uls-upload-*로 실제로 만든 폴더를
      // 그대로 돌려주는지 확인한다 — enqueue가 재스캔할 때 쓸 값이다.
      expect(path.dirname(out.folder)).toBe(os.tmpdir());
      expect(path.basename(out.folder)).toMatch(/^uls-upload-/);
    } finally {
      await fs.rm(out.folder, { recursive: true, force: true });
    }
  });

  // 이 테스트가 지키는 버그: upload 액션이 응답에 folder를 안 실으면
  // (Task 19 브리프 원본 코드가 실제로 그랬다) +page.svelte의 $effect가
  // 이전 folder 값(최초 진입이면 빈 문자열)을 그대로 들고 있어, 뒤이은
  // enqueue가 방금 업로드로 만든 폴더가 아니라 엉뚱한 곳을 재스캔하게
  // 된다. upload가 돌려준 folder를 곧장 enqueue에 넘겨서, 그 폴더가
  // 실제로 유효한 재스캔 대상인지(=sourceName이 그대로 맞아떨어지는지)를
  // 검증한다.
  it('upload가 돌려준 folder를 그대로 enqueue에 넘기면 재스캔에서 sourceName이 맞아떨어진다', async () => {
    const file = await fileFrom(SPATIAL, 'sample.qta');
    const up = (await actions.upload(await uploadEvent([file]))) as { items: ScanItem[]; folder: string };
    try {
      const res = await actions.enqueue(
        enqueueEvent(up.folder, [
          { sourceName: 'sample.qta', title: '제목', description: '', tags: [] }
        ])
      );
      expect(res).toMatchObject({ queued: 1, skipped: 0 });
      expect(buildJobsSpy).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(up.folder, { recursive: true, force: true });
    }
  });

  it('Content-Length 헤더가 없으면 formData를 읽기 전에 411로 거부한다', async () => {
    // 1차 리뷰의 curl PoC가 실제로 이 헤더 없이 액션을 직접 두드릴 수
    // 있음을 보였다 — 브라우저의 네이티브 멀티파트 POST는 이 헤더를
    // 항상 보내므로, 정상적인 사용자에게는 비용 없는 요구다.
    const file = await fileFrom(SPATIAL, 'sample.qta');
    const res = await actions.upload(await uploadEvent([file], null));
    expect(res).toMatchObject({ status: 411 });
    expect((res as { data: { message: string } }).data.message).toMatch(/Content-Length/);
  });

  it('Content-Length가 요청 전체 한도를 넘으면 formData를 읽기 전에 413으로 거부한다', async () => {
    const file = await fileFrom(SPATIAL, 'sample.qta');
    const oversized = String(config.maxUploadTotalMb * 1024 * 1024 + 1);
    const res = await actions.upload(await uploadEvent([file], oversized));
    expect(res).toMatchObject({ status: 413 });
    const message = (res as { data: { message: string } }).data.message;
    // 두 한도(파일당·요청 전체)를 메시지에 함께 밝힌다 — 사용자가 어느
    // 쪽 설정을 조정해야 하는지 알 수 있어야 한다.
    expect(message).toContain(String(config.maxUploadMb));
    expect(message).toContain(String(config.maxUploadTotalMb));
  });

  it('개별 파일이 파일당 한도를 넘으면 413으로 거부한다', async () => {
    const original = config.maxUploadMb;
    config.maxUploadMb = 0.001; // spatial.qta(약 180KB)가 이 한도를 넘도록
    try {
      const file = await fileFrom(SPATIAL, 'sample.qta');
      const res = await actions.upload(await uploadEvent([file]));
      expect(res).toMatchObject({ status: 413 });
      expect((res as { data: { message: string } }).data.message).toMatch(/업로드 한도/);
    } finally {
      config.maxUploadMb = original;
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
  it('예상 용량이 여유 공간보다 크면 507로 거부하고 buildJobs/큐에는 잡을 올리지 않는다', async () => {
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
      // Must Fix 2 이후로는 getQueue가 여기서도 불린다 — pending을 확정하기
      // 전에(디스크 예상치를 정확히 재려면) 진행 중인 sourceName을 큐의
      // snapshot()으로 먼저 걸러내야 하기 때문이다(위 in-flight 중복 방지
      // 테스트 참고). 그래도 실제로 잡을 만들거나 큐에 올리는 일은
      // 없어야 한다는 불변식은 그대로다.
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

/**
 * Must Fix 2(CRITICAL): existingSourceNames는 recordings.json만 읽는데,
 * 그 파일은 파이프라인 맨 끝에서만 갱신된다(runner.ts). 그래서 변환이
 * 도는 동안(수 분) 저장 버튼을 두 번 누르면 재스캔은 매번 duplicate:false를
 * 돌려주고, 개선 전 코드는 그걸 그대로 믿어 같은 항목을 또 큐에 올리고
 * 원본을 다시 복사했다. 큐의 snapshot()에 있는(=이미 알려진) sourceName은
 * failed가 아닌 한 다시 올리지 않아야 한다.
 */
describe('enqueue 액션 — 진행 중인(in-flight) 잡과의 중복 방지', () => {
  function inFlightJob(sourcePath: string, status: 'pending' | 'running' | 'done' | 'failed') {
    return {
      id: randomUUID(),
      recordingId: randomUUID(),
      sourcePath,
      title: '이미 큐에 있음',
      status,
      formats: { mp3: status, wav: status },
      error: status === 'failed' ? '이전 실패' : null
    };
  }

  it('이미 진행 중인(running) sourceName은 건너뛰고 skipped로 세며, 나머지는 정상적으로 큐에 올린다', async () => {
    const dir = await makeFolder(['sample.qta', 'sample2.qta']);
    try {
      fakeQueue.snapshot.mockReturnValueOnce([
        inFlightJob(path.join(dir, 'sample.qta'), 'running')
      ]);
      const items = [
        { sourceName: 'sample.qta', title: 'A', description: '', tags: [] },
        { sourceName: 'sample2.qta', title: 'B', description: '', tags: [] }
      ];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(res).toEqual({ queued: 1, skipped: 1 });
      expect(buildJobsSpy).toHaveBeenCalledTimes(1);
      const [[, pendingArg]] = buildJobsSpy.mock.calls;
      expect(pendingArg).toHaveLength(1);
      expect(pendingArg[0].scan.sourceName).toBe('sample2.qta');
      const jobsArg = fakeQueue.enqueue.mock.calls[0][0];
      expect(jobsArg).toHaveLength(1);
      expect(jobsArg[0].sourcePath).toBe(path.join(dir, 'sample2.qta'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('done 상태인 in-flight 잡의 sourceName도 건너뛴다(recordings.json 반영 전 좁은 창)', async () => {
    const dir = await makeFolder(['sample.qta']);
    try {
      fakeQueue.snapshot.mockReturnValueOnce([
        inFlightJob(path.join(dir, 'sample.qta'), 'done')
      ]);
      const items = [{ sourceName: 'sample.qta', title: 'A', description: '', tags: [] }];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(res).toMatchObject({ status: 400 });
      expect((res as { data: { message: string } }).data.message).toMatch(
        /가져올 수 있는 항목이 없습니다/
      );
      expect(buildJobsSpy).not.toHaveBeenCalled();
      expect(fakeQueue.enqueue).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('failed 상태인 in-flight 잡의 sourceName은 막지 않는다 — 사용자가 다시 올려 새로 시도할 수 있어야 한다', async () => {
    const dir = await makeFolder(['sample.qta']);
    try {
      fakeQueue.snapshot.mockReturnValueOnce([
        inFlightJob(path.join(dir, 'sample.qta'), 'failed')
      ]);
      const items = [{ sourceName: 'sample.qta', title: 'A', description: '', tags: [] }];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(res).toEqual({ queued: 1, skipped: 0 });
      expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('모든 후보가 in-flight면 buildJobs/enqueue를 건드리지 않고 깨끗하게 실패한다', async () => {
    const dir = await makeFolder(['sample.qta', 'sample2.qta']);
    try {
      fakeQueue.snapshot.mockReturnValueOnce([
        inFlightJob(path.join(dir, 'sample.qta'), 'pending'),
        inFlightJob(path.join(dir, 'sample2.qta'), 'running')
      ]);
      const items = [
        { sourceName: 'sample.qta', title: 'A', description: '', tags: [] },
        { sourceName: 'sample2.qta', title: 'B', description: '', tags: [] }
      ];
      const res = await actions.enqueue(enqueueEvent(dir, items));

      expect(res).toMatchObject({ status: 400 });
      expect(buildJobsSpy).not.toHaveBeenCalled();
      expect(fakeQueue.enqueue).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
