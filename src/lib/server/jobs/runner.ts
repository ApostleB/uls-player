import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AppConfig, FileEntry, JobItem, JobStatus, Recording, ScanItem
} from '$lib/types';
import { convert } from '../media/convert';
import { probe } from '../media/probe';
import { generatePeaks } from '../media/waveform';
import { savePeaks } from '../store/waveforms';
import { addMany, newId, patch } from '../store/recordings';
import { JobQueue, JobFailure, type Worker } from './queue';
import { pendingRecordings } from './registry';

export interface PendingItem {
  scan: ScanItem;
  title: string;
  description: string;
  tags: string[];
}

function nowIso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

/** 스캔 결과와 사용자 입력을 합쳐 녹음 항목과 변환 작업을 만든다. */
export function buildJobs(
  cfg: AppConfig,
  pending: PendingItem[]
): { jobs: JobItem[]; recordings: Recording[] } {
  const jobs: JobItem[] = [];
  const recordings: Recording[] = [];
  const at = nowIso();

  for (const p of pending) {
    const id = newId();
    recordings.push({
      id,
      title: p.title,
      description: p.description,
      tags: p.tags,
      recordedAt: p.scan.recordedAt,
      durationSec: p.scan.durationSec,
      sourceName: p.scan.sourceName,
      appleAutoTitle: p.scan.appleAutoTitle,
      files: {},
      bookmarks: [],
      createdAt: at,
      updatedAt: at,
      deletedAt: null
    });

    const formats: Record<string, JobStatus> = {};
    for (const f of cfg.formats) formats[f.name] = 'pending';

    jobs.push({
      id,
      recordingId: id,
      sourcePath: p.scan.sourcePath,
      title: p.title,
      status: 'pending',
      formats,
      error: null
    });
  }

  // 변환이 끝난 뒤 저장소에 넣을 수 있도록 레지스트리에 맡겨둔다
  pendingRecordings.put(recordings);
  return { jobs, recordings };
}

/**
 * 항목 하나의 파이프라인.
 * 원본 복사 → 포맷별 변환 → 파형 → 저장소 기록.
 *
 * 원본 복사가 실패하면 이후 단계가 의미 없으므로 전체를 실패로 던진다.
 * 개별 포맷 실패는 그 포맷만 failed로 남기고 나머지를 계속한다.
 */
export function makeRunner(cfg: AppConfig): Worker {
  return async (job: JobItem) => {
    const ext = path.extname(job.sourcePath).slice(1);
    const originalPath = path.join(cfg.mediaDir, 'original', `${job.recordingId}.${ext}`);

    await fs.mkdir(path.dirname(originalPath), { recursive: true });
    await fs.copyFile(job.sourcePath, originalPath);

    const meta = await probe(originalPath);

    const files: Record<string, FileEntry> = {
      original: { ext, bytes: (await fs.stat(originalPath)).size }
    };
    const result: Record<string, JobStatus> = {};
    const formatErrors: string[] = [];

    for (const spec of cfg.formats) {
      const out = path.join(cfg.mediaDir, spec.name, `${job.recordingId}.${spec.ext}`);

      if (job.formats[spec.name] === 'done') {
        try {
          files[spec.name] = { bytes: (await fs.stat(out)).size };
          result[spec.name] = 'done';
          continue;
        } catch {
          // 파일이 사라졌으면 done 표시를 믿지 않고 다시 만든다
        }
      }

      try {
        await convert(originalPath, out, meta.audioStreamIndex, spec);
        files[spec.name] = { bytes: (await fs.stat(out)).size };
        result[spec.name] = 'done';
      } catch (err) {
        result[spec.name] = 'failed';
        formatErrors.push(`${spec.name}: ${(err as Error).message}`);
      }
    }

    // 여기서부터 던지는 오류는 이미 만들어진 포맷 정보를 실어 보내야 한다.
    // 그러지 않으면 큐가 실행 이전 상태(전부 pending)를 남기고, 재시도가
    // 멀쩡한 파일을 다시 변환하다 실패하면 convert가 그 파일을 지운다.
    try {
      const peaks = await generatePeaks(originalPath, meta.audioStreamIndex, cfg.waveformPeaks);
      await savePeaks(cfg, job.recordingId, peaks);

      // 저장소 기록은 파이프라인이 여기까지 온 뒤에만 한다.
      // 앞에서 던지면 목록에 반쪽짜리 항목이 남지 않는다.
      // 최초 실행은 추가, 재시도는 patch — take()가 성공한 뒤에만 드롭해서
      // 쓰기 도중 던지면 레지스트리에 레코딩이 남아 다음 재시도가 쓸 수 있다.
      const rec = pendingRecordings.take(job.recordingId);
      if (rec) {
        await addMany(cfg, [{ ...rec, files }]);
        pendingRecordings.drop(job.recordingId);
      } else {
        await patch(cfg, job.recordingId, { files });
      }
    } catch (err) {
      throw new JobFailure((err as Error).message, result);
    }

    if (formatErrors.length) {
      throw new JobFailure(formatErrors.join('\n'), result);
    }

    return result;
  };
}

let queue: JobQueue | null = null;

/** 프로세스당 하나. 라우트가 요청마다 새 큐를 만들지 않도록 한다. */
export function getQueue(cfg: AppConfig): JobQueue {
  if (!queue) queue = new JobQueue(cfg.convertConcurrency, makeRunner(cfg));
  return queue;
}
