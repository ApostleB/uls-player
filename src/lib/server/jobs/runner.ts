import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AppConfig, FileEntry, JobItem, JobStatus, Recording, ScanItem
} from '$lib/types';
import { mediaFilePath } from '$lib/media';
import { convert } from '../media/convert';
import { probe } from '../media/probe';
import { generatePeaks } from '../media/waveform';
import { savePeaks } from '../store/waveforms';
import { addMany, newId, patch, RecordingNotFoundError } from '../store/recordings';
import { JobQueue, JobFailure, type Worker } from './queue';
import { pendingRecordings } from './registry';
import { persistQueue, loadUnfinished, jobsFilePath } from './persist';
import { sweepStaleStaging, rescheduleStagingCleanup } from '../upload';

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
    const originalPath = mediaFilePath(cfg.mediaDir, job.recordingId, 'original', ext);

    await fs.mkdir(path.dirname(originalPath), { recursive: true });

    // 원본은 보관용 사본이다 — 재시도한다고 다시 복사해서 얻을 게 없다.
    // fs.copyFile은 대상을 O_TRUNC로 열므로, 이미 검증된 원본이 있는데
    // 다시 복사하다가 소스가 끊기면(외장 디스크·iCloud 등) 그 원본을
    // 잘라먹고 못 채운 채로 남긴다. 대상이 있고 비어 있지 않으면 그대로 둔다.
    // 한계: size > 0만으로는 "완전한 원본"과 "복사 도중 끊겨서 일부만
    // 써진, 그래도 0바이트는 아닌 파일"을 구분하지 못한다. 후자라면 그
    // 불완전한 파일이 이후의 모든 재시도에서 계속 "멀쩡하다"고 신뢰된다.
    // 크기 기반 판정 방식 자체의 한계이고, 해시 검증 등 더 강한 확인이
    // 없는 한 남아 있다.
    let originalIntact = false;
    try {
      originalIntact = (await fs.stat(originalPath)).size > 0;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // 없으면(ENOENT) 복사해야 한다. 그 외 오류는 원본 상태를 확신할 수
      // 없다는 뜻이니 그대로 던진다 — 여기서 삼키고 복사를 강행하면
      // 멀쩡했을 수도 있는 원본을 잘라먹을 위험이 있다.
    }
    if (!originalIntact) {
      await fs.copyFile(job.sourcePath, originalPath);
    }

    const meta = await probe(originalPath);

    const files: Record<string, FileEntry> = {
      original: { ext, bytes: (await fs.stat(originalPath)).size }
    };
    const result: Record<string, JobStatus> = {};
    const formatErrors: string[] = [];

    for (const spec of cfg.formats) {
      const out = mediaFilePath(cfg.mediaDir, job.recordingId, spec.name, spec.ext);

      if (job.formats[spec.name] === 'done') {
        try {
          files[spec.name] = { bytes: (await fs.stat(out)).size };
          result[spec.name] = 'done';
          continue;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            // ENOENT가 아닌 오류(EACCES·EIO·EMFILE 등)는 파일이 멀쩡한데
            // stat 자체가 안 되는 상황일 수 있다 — 여기서 삼키고 재변환을
            // 시도하면, 그 재변환도 같은 원인으로 실패할 가능성이 높고
            // convert의 정리 로직이 멀쩡한 파일을 지울 수 있다.
            //
            // 그냥 던지면 큐가 실행 이전 상태로 되돌리는데, cfg.formats
            // 순서상 이 포맷보다 먼저 처리된 포맷이 이번 실행에서 막
            // 새로 변환됐을 수 있다(result에 담겨 있다) — 그 상태가
            // pending으로 되돌아가면 다음 재시도가 방금 멀쩡하게 만든
            // 파일을 다시 변환하다, 같은 원인으로 또 실패하면 convert의
            // 정리 로직이 그 파일을 지운다. Finding 1이 막으려던 것과
            // 같은 사고가 다른 경로로 벌어지는 셈이라, 지금까지 모은
            // result를 실어 보내 이미 done인 포맷을 지킨다.
            throw new JobFailure((err as Error).message, result);
          }
          // 파일이 사라졌을 때만(ENOENT) done 표시를 믿지 않고 다시 만든다.
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
        try {
          await patch(cfg, job.recordingId, { files });
        } catch (err) {
          // pendingRecordings에도 없고 저장소에도 없다 — 정상 재시도라면
          // 이전 실행에서 이미 addMany로 저장소에 들어가 있어 patch가
          // 성공한다. 그런데도 여기서 "찾을 수 없다"는 patch()의 원래
          // 오류는 서버 재시작으로 복구된 작업(pendingRecordings가
          // 인메모리라 프로세스가 죽으면 비고, 죽기 전 저장소 기록도
          // 못 했던 경우)일 때만 나온다 — 사용자 입장에선 uuid 하나만
          // 찍힌 채 "녹음을 찾을 수 없습니다"만 봐서는 뭘 해야 할지 알
          // 수 없다. patch()가 정확히 이 사유로 던졌을 때만(다른 원인,
          // 예를 들어 디스크 쓰기 실패까지 이 메시지로 덮어써 원인을
          // 숨기면 안 된다) 대응 방법(다시 가져오기)이 담긴 메시지로
          // 바꿔서 던진다. 문자열 접두어가 아니라 타입으로 판정한다 —
          // recordings.ts의 RecordingNotFoundError 주석 참고.
          if (err instanceof RecordingNotFoundError) {
            throw new Error(
              '변환은 끝났지만 원본 녹음 정보를 찾을 수 없습니다(서버 재시작으로 ' +
                '복구된 작업일 수 있습니다). 폴더를 다시 가져오세요.',
              { cause: err }
            );
          }
          throw err;
        }
      }
    } catch (err) {
      // 포맷별 변환 오류(formatErrors)가 있는데 여기서도 던지면, 이전에는
      // formatErrors가 통째로 사라지고 이 catch의 메시지만 남았다. 두 원인이
      // 다 남도록 합친다.
      const message = formatErrors.length
        ? [...formatErrors, (err as Error).message].join('\n')
        : (err as Error).message;
      throw new JobFailure(message, result);
    }

    if (formatErrors.length) {
      throw new JobFailure(formatErrors.join('\n'), result);
    }

    return result;
  };
}

let queue: JobQueue | null = null;

/**
 * 프로세스당 하나. 처음 만들 때 jobs.json의 미완료 작업을 이어받는다.
 *
 * 복구된 작업은 pendingRecordings에 원본 녹음 항목이 없으므로 변환만 다시 하고
 * 저장소 기록은 건너뛴다. 프로세스가 죽기 전 이미 기록됐거나, 기록 전이라면
 * 사용자가 다시 가져오면 된다.
 */
export function getQueue(cfg: AppConfig): JobQueue {
  if (!queue) {
    queue = new JobQueue(cfg.convertConcurrency, makeRunner(cfg));
    persistQueue(cfg, queue);
    // jobs.json이 손상됐거나(JSON 파싱 실패) 권한 문제 등 ENOENT가 아닌
    // 사유로 못 읽히면 readJson이 그대로 던진다. 여기서 .catch 없이
    // 두면 처리되지 않은 거부가 되어, 재시작 뒤 이 지연 프로미스가
    // 해소되는 시점(사실상 첫 요청 직후)에 프로세스가 죽는다 — 그것도
    // "복구를 아예 시도하지 않는 것"보다 나쁘다: 복구를 못 했을 뿐 새
    // 변환은 받을 수 있어야 하는데, 서버 자체가 못 뜨고 오류 메시지도
    // 무엇을 지워야 할지 알려주지 않는다(어떤 파일이 문제인지도 모른
    // 채 재시작 루프에 빠질 수 있다). 실패하면 복구를 포기하고 빈
    // 채로 계속 진행하되, 어느 파일이 문제인지는 콘솔에 남긴다.
    void loadUnfinished(cfg).then(
      (items) => {
        if (!items.length) return;
        queue!.enqueue(items);
        // 복구된 잡의 스테이징 정리 구독도 되살린다. 이게 없으면 잡이
        // 이번 프로세스에서 무사히 done이 돼도 파일이 남아, 정리가 다음
        // 재시작의 sweepStaleStaging까지 밀린다.
        rescheduleStagingCleanup(queue!, items);
      },
      (err) => {
        console.error(
          `jobs.json을 읽을 수 없어 이전 작업을 복구하지 못했습니다: ${jobsFilePath(cfg)}`,
          err
        );
      }
    );

    // 재시작 사이에 놓친 업로드 스테이징 정리를 시작 시점에 만회한다.
    // 복구되는 잡의 정리 구독은 위 rescheduleStagingCleanup이 되살리므로,
    // 여기 남는 몫은 그 경로로 닿지 않는 것들이다 — 저장 전에 버려진 업로드
    // 폴더, 그리고 잡이 영구히 failed로 남아 done을 못 보는 경우. 실패를
    // 던지지 않는(내부에서 콘솔로만 처리하는) 함수라 .catch 없이 둔다.
    void sweepStaleStaging(cfg);
  }
  return queue;
}
