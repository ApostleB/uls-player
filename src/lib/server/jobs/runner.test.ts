import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, ScanItem } from '$lib/types';
import { loadConfig } from '../config';
import { listAll } from '../store/recordings';
import { loadPeaks } from '../store/waveforms';
import { scanFolder } from '../scan';
import { JobQueue, JobFailure } from './queue';
import { buildJobs, makeRunner } from './runner';
import * as waveformModule from '../media/waveform';
import * as convertModule from '../media/convert';

// 실제 구현을 감싸는 스파이. 기본 동작은 실제 ffmpeg 호출 그대로 통과시키고,
// 개별 테스트에서만 mockImplementationOnce로 한 번 실패를 주입한다(자동으로
// 다음 호출부터 실제 구현으로 복귀하므로 다른 테스트에 영향이 없다).
// convert는 호출 횟수를 세기 위해 감싼다.
vi.mock('../media/waveform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../media/waveform')>();
  return { ...actual, generatePeaks: vi.fn(actual.generatePeaks) };
});
vi.mock('../media/convert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../media/convert')>();
  return { ...actual, convert: vi.fn(actual.convert) };
});

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const QTA_NAME = '20260711 181530-1923A106.qta';

let dir: string;
let src: string;
let cfg: AppConfig;
let scan: ScanItem[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-runner-'));
  src = path.join(dir, 'src');
  await fs.mkdir(src, { recursive: true });
  await fs.copyFile(SPATIAL, path.join(src, QTA_NAME));
  cfg = loadConfig({
    DATA_DIR: path.join(dir, 'data'),
    MEDIA_DIR: path.join(dir, 'media'),
    WAVEFORM_PEAKS: '64'
  });
  scan = await scanFolder(cfg, src);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('buildJobs', () => {
  it('입력한 제목·설명·태그를 녹음 항목에 담는다', () => {
    const { recordings, jobs } = buildJobs(cfg, [
      { scan: scan[0], title: '레인', description: '데모', tags: ['1절'] }
    ]);
    expect(recordings[0].title).toBe('레인');
    expect(recordings[0].description).toBe('데모');
    expect(recordings[0].tags).toEqual(['1절']);
    expect(recordings[0].sourceName).toBe(QTA_NAME);
    expect(jobs[0].recordingId).toBe(recordings[0].id);
  });

  it('설정된 포맷을 pending으로 초기화한다', () => {
    const { jobs } = buildJobs(cfg, [{ scan: scan[0], title: 't', description: '', tags: [] }]);
    expect(jobs[0].formats).toEqual({ mp3: 'pending', wav: 'pending' });
  });
});

describe('makeRunner', () => {
  it('원본을 복사하고 모든 포맷을 만들고 파형을 저장한다', async () => {
    const { recordings, jobs } = buildJobs(cfg, [
      { scan: scan[0], title: '레인', description: '', tags: ['데모'] }
    ]);
    const q = new JobQueue(2, makeRunner(cfg));
    q.enqueue(jobs);
    await q.idle();

    expect(q.snapshot()[0].status).toBe('done');

    const id = recordings[0].id;
    expect((await fs.stat(path.join(cfg.mediaDir, 'original', `${id}.qta`))).size).toBeGreaterThan(0);
    expect((await fs.stat(path.join(cfg.mediaDir, 'mp3', `${id}.mp3`))).size).toBeGreaterThan(0);
    expect((await fs.stat(path.join(cfg.mediaDir, 'wav', `${id}.wav`))).size).toBeGreaterThan(0);

    const peaks = await loadPeaks(cfg, id);
    expect(peaks).toHaveLength(64);

    const stored = await listAll(cfg);
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('레인');
    expect(Object.keys(stored[0].files).sort()).toEqual(['mp3', 'original', 'wav']);
    expect(stored[0].files.mp3.bytes).toBeGreaterThan(0);
  });

  it('원본이 사라지면 실패로 기록하고 저장소를 오염시키지 않는다', async () => {
    const { jobs } = buildJobs(cfg, [{ scan: scan[0], title: 't', description: '', tags: [] }]);
    await fs.rm(jobs[0].sourcePath);

    const q = new JobQueue(1, makeRunner(cfg));
    q.enqueue(jobs);
    await q.idle();

    expect(q.snapshot()[0].status).toBe('failed');
    expect(await listAll(cfg)).toEqual([]);
  });
});

/**
 * 브리프의 위 4개 테스트는 남겨두되(약하지만 무해하고, happy path는 통합
 * 테스트로서 실제 가치가 있다), 다음 세 성질은 어떤 것도 직접 지키지
 * 않았다 — 뮤테이션으로 실측 확인함(task-11-report.md 참고):
 *   1) 저장소 기록이 파형 생성 뒤에 온다는 것: "저장소를 오염시키지 않는다"는
 *      원본 삭제로 실패를 유도해서, 파형 단계가 실패하는 경로 자체를 타지 않는다.
 *   2) done 포맷을 건너뛰는 것: 브리프 4개 테스트 중 job을 두 번 돌리는 것이 없다.
 *   3) JobFailure로 부분 진행 상태를 실어 던지는 것: 파형 단계가 실패하는
 *      시나리오 자체가 없다.
 * 아래 세 테스트가 그 자리를 각각 채운다.
 */
describe('재시도 안전성 (부분 진행 보존)', () => {
  it('파형 생성이 실패하면 저장소에 기록하지 않는다', async () => {
    const { jobs } = buildJobs(cfg, [{ scan: scan[0], title: 't', description: '', tags: [] }]);
    const worker = makeRunner(cfg);

    vi.mocked(waveformModule.generatePeaks).mockImplementationOnce(async () => {
      throw new Error('강제 파형 실패');
    });

    await expect(worker(jobs[0])).rejects.toThrow();
    // 변환은 이미 다 끝난 뒤 파형에서만 실패했다 — 저장소 기록이 정말
    // "마지막"이라면 이 시점에 저장소는 비어 있어야 한다.
    expect(await listAll(cfg)).toEqual([]);
  });

  it('이미 done인 포맷은 재변환하지 않는다', async () => {
    const { jobs } = buildJobs(cfg, [{ scan: scan[0], title: 't', description: '', tags: [] }]);
    const worker = makeRunner(cfg);

    const before = vi.mocked(convertModule.convert).mock.calls.length;
    const result = await worker(jobs[0]);
    const afterFirstRun = vi.mocked(convertModule.convert).mock.calls.length;
    expect(afterFirstRun - before).toBe(2); // mp3 + wav

    // 재시도 시뮬레이션: formats가 이미 done인 채로 같은 job을 다시 돌린다
    // (JobQueue.retryFailed가 실패한 포맷만 pending으로 되돌리고 나머지는
    // done으로 남긴 채 재실행하는 것과 같은 입력 모양이다).
    const retryJob = { ...jobs[0], formats: result };
    await worker(retryJob);
    const afterRetry = vi.mocked(convertModule.convert).mock.calls.length;

    // done으로 이미 표시된 포맷은 다시 변환하면 안 된다 — 호출 횟수가 늘면 안 된다.
    expect(afterRetry - afterFirstRun).toBe(0);
  });

  it('파형 생성이 실패하면 JobFailure로 완료된 포맷 상태를 함께 던진다', async () => {
    const { jobs } = buildJobs(cfg, [{ scan: scan[0], title: 't', description: '', tags: [] }]);
    const worker = makeRunner(cfg);

    vi.mocked(waveformModule.generatePeaks).mockImplementationOnce(async () => {
      throw new Error('강제 파형 실패');
    });

    let caught: unknown;
    try {
      await worker(jobs[0]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(JobFailure);
    // 변환 자체는 mp3·wav 둘 다 성공했다 — 그 상태가 실려 있어야
    // 재시도가 멀쩡한 파일을 다시 변환하다 지우는 일이 없다.
    expect((caught as JobFailure).formats).toEqual({ mp3: 'done', wav: 'done' });
  });
});
