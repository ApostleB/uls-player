import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, JobItem, ScanItem } from '$lib/types';
import { loadConfig } from '../config';
import { scanFolder } from '../scan';
import { JobFailure } from './queue';
import { RecordingNotFoundError } from '../store/recordings';
import * as recordingsStore from '../store/recordings';

// patch()만 감싼다 — 다른 export(addMany·existingSourceNames 등)는 실제
// 구현 그대로 둔다. 이 파일을 runner.test.ts에 합치지 않고 따로 두는
// 이유는 getQueue.recovery.test.ts의 파일 상단 주석과 같다: vi.mock은
// 파일 전체에 걸리므로, patch를 감싸는 이 목이 runner.test.ts의 나머지
// 15개 이상 테스트로 새어 들어가지 않게 격리한다.
vi.mock('../store/recordings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/recordings')>();
  return { ...actual, patch: vi.fn(actual.patch) };
});

import { makeRunner } from './runner';

const patchSpy = vi.mocked(recordingsStore.patch);

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const QTA_NAME = '20260711 181530-1923A106.qta';

let dir: string;
let src: string;
let cfg: AppConfig;
let scan: ScanItem[];

beforeEach(async () => {
  // runner.test.ts와 같은 패턴: vi.fn(impl)로 만든 목은 mockReset해도 그
  // impl(실제 patch)로 되돌아간다.
  patchSpy.mockReset();

  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-runner-notfound-'));
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

/** buildJobs를 거치지 않은, "복구된 작업"을 흉내내는 JobItem — pendingRecordings에
 * 아무것도 없으므로 워커가 반드시 patch() 경로를 탄다. */
function orphanJob(): JobItem {
  return {
    id: randomUUID(),
    recordingId: randomUUID(),
    sourcePath: scan[0].sourcePath,
    title: '복구된 작업',
    status: 'pending',
    formats: { mp3: 'pending', wav: 'pending' },
    error: null
  };
}

/**
 * Must Fix 7: runner.ts:194가 recordings.ts:83이 만드는 정확한 오류
 * 메시지 문자열에 결합돼 있었다(`err.message.startsWith('녹음을 찾을 수
 * 없습니다')`). 문자열 접두어 비교는 "이 사유가 아닌데 우연히 같은
 * 문구로 시작하는 오류"도 잘못 매치한다 — 예를 들어 디스크 쓰기 실패가
 * 우연히 이 문구로 시작하는 메시지를 냈다면, 그 원인이 "서버 재시작으로
 * 복구된 작업"이라는 엉뚱한 설명으로 덮어써진다.
 *
 * 아래는 그 실패 시나리오를 직접 재현한다: patch()가 RecordingNotFoundError가
 * *아닌*, 그러나 같은 문구로 시작하는 평범한 Error를 던지게 만든다.
 * 개선 전 코드(문자열 접두어 검사)는 이 오류도 "행동 가능한" 메시지로
 * 감쌌을 것이다 — 이 테스트는 그 개선 전 코드에서 반드시 실패한다
 * (뮤테이션으로 실측 확인: 아래 코드를 문자열 접두어 검사로 되돌리면
 * 이 테스트가 실패하는 것을 확인했다).
 */
describe('runner의 RecordingNotFoundError 판정 — 타입 기반, 문자열 접두어 아님', () => {
  it('RecordingNotFoundError가 아니면(우연히 같은 문구로 시작해도) 원래 오류를 그대로 전파한다', async () => {
    const worker = makeRunner(cfg);
    const job = orphanJob();

    const decoy = new Error('녹음을 찾을 수 없습니다: 사실은 디스크 쓰기 실패였다');
    expect(decoy).not.toBeInstanceOf(RecordingNotFoundError);
    patchSpy.mockRejectedValueOnce(decoy);

    let caught: unknown;
    try {
      await worker(job);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(JobFailure);
    const message = (caught as JobFailure).message;
    // 타입이 아니라 문자열이었다면 이 decoy도 매치돼 아래 문구로
    // 바뀌었을 것이다 — 그러면 안 된다는 게 이 테스트의 핵심.
    expect(message).not.toMatch(/서버 재시작으로/);
    expect(message).not.toMatch(/다시 가져오/);
    // 원래 메시지(디스크 쓰기 실패를 가장한 decoy)는 그대로 살아 있어야 한다.
    expect(message).toContain('사실은 디스크 쓰기 실패였다');
  });

  it('RecordingNotFoundError면 행동 가능한 메시지로 감싼다 (대조군)', async () => {
    const worker = makeRunner(cfg);
    const job = orphanJob();

    patchSpy.mockRejectedValueOnce(new RecordingNotFoundError(job.recordingId));

    let caught: unknown;
    try {
      await worker(job);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(JobFailure);
    const message = (caught as JobFailure).message;
    expect(message).toContain('다시 가져오');
    expect(message).not.toMatch(/^녹음을 찾을 수 없습니다:/);
  });
});
