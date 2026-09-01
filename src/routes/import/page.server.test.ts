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

import { actions } from './+page.server';
import { config } from '$lib/server/config';
import * as runner from '$lib/server/jobs/runner';

const buildJobsSpy = vi.mocked(runner.buildJobs);
const getQueueSpy = vi.mocked(runner.getQueue);

// scanFolder/config는 모킹하지 않는다. 폴더 관련 테스트 세 개(빈 값·공백·
// 존재하지 않는 경로) 모두 scanFolder의 첫 줄(fs.readdir)에서 끝나거나
// 그 이전에 끝나서 cfg.dataDir을 건드리지 않으므로, 실제 싱글턴 config를
// 그대로 써도 프로젝트의 실제 data/ 디렉터리를 건드리지 않는다("유효한
// 폴더 스캔" 테스트만 예외라 격리된 tmp 폴더를 쓴다).
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

function enqueueEvent(payload: string): RequestEvent {
  const fd = new FormData();
  fd.set('payload', payload);
  return event(fd);
}

beforeEach(() => {
  buildJobsSpy.mockClear();
  getQueueSpy.mockClear();
  fakeQueue.enqueue.mockClear();
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

  it('유효한 폴더를 스캔하면 항목 배열을 돌려준다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-page-server-scan-'));
    try {
      await fs.copyFile(SPATIAL, path.join(dir, 'sample.qta'));
      const res = await actions.scan(scanEvent(dir));
      const items = (res as { items: ScanItem[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0].sourceName).toBe('sample.qta');
      expect(items[0].error).toBeNull();
      expect(items[0].duplicate).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('enqueue 액션', () => {
  it('손상된 JSON payload는 거부하고 buildJobs/큐를 건드리지 않는다', async () => {
    const res = await actions.enqueue(enqueueEvent('{이건 JSON이 아니다'));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/보낼 항목을 읽을 수 없습니다/);
    expect(buildJobsSpy).not.toHaveBeenCalled();
    expect(getQueueSpy).not.toHaveBeenCalled();
    expect(fakeQueue.enqueue).not.toHaveBeenCalled();
  });

  it('빈 배열 payload는 거부하고 buildJobs/큐를 건드리지 않는다', async () => {
    const res = await actions.enqueue(enqueueEvent('[]'));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { message: string } }).data.message).toMatch(/선택된 항목이 없습니다/);
    expect(buildJobsSpy).not.toHaveBeenCalled();
    expect(getQueueSpy).not.toHaveBeenCalled();
    expect(fakeQueue.enqueue).not.toHaveBeenCalled();
  });

  it('유효한 payload는 실제로 buildJobs를 거쳐 큐에 잡을 올린다', async () => {
    const scan: ScanItem = {
      sourcePath: '/tmp/sample.qta',
      sourceName: 'sample.qta',
      title: '레인',
      appleAutoTitle: '레인',
      recordedAt: '2026-07-11T18:15:30+09:00',
      durationSec: 12.5,
      ext: 'qta',
      bytes: 1234,
      audioStreamIndex: 0,
      duplicate: false,
      error: null
    };
    const pending = [{ scan, title: '레인', description: '', tags: ['1절'] }];
    const res = await actions.enqueue(enqueueEvent(JSON.stringify(pending)));

    expect(buildJobsSpy).toHaveBeenCalledTimes(1);
    expect(buildJobsSpy).toHaveBeenCalledWith(config, pending);
    expect(getQueueSpy).toHaveBeenCalledWith(config);
    expect(fakeQueue.enqueue).toHaveBeenCalledTimes(1);

    const jobsArg = fakeQueue.enqueue.mock.calls[0][0];
    expect(jobsArg).toHaveLength(1);
    expect(jobsArg[0].sourcePath).toBe('/tmp/sample.qta');
    expect(jobsArg[0].title).toBe('레인');
    expect(jobsArg[0].status).toBe('pending');

    expect(res).toEqual({ queued: 1 });
  });
});
