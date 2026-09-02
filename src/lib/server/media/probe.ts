import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * ffmpeg에 디코더가 없는 코덱. 이 스트림을 -map으로 지정하면
 * "no decoder found"로 변환 전체가 실패한다.
 */
export const UNDECODABLE_CODECS = new Set(['apple_apac']);

export interface ProbeResult {
  durationSec: number;
  /** 파일 메타의 title. 애플이 위치 기반으로 자동 생성한 이름이다. */
  title: string | null;
  /** UTC ISO 문자열 그대로 */
  creationTime: string | null;
  /** 절대 스트림 인덱스. -map 0:<index>에 그대로 쓴다. */
  audioStreamIndex: number;
  codecName: string;
  channels: number;
}

interface RawStream {
  index: number;
  codec_name?: string;
  codec_type?: string;
  channels?: number;
}

interface RawProbe {
  streams?: RawStream[];
  format?: { duration?: string; tags?: Record<string, string> };
}

export async function probe(filePath: string): Promise<ProbeResult> {
  let stdout: string;
  try {
    ({ stdout } = await run('ffprobe', [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      filePath
    ]));
  } catch (err) {
    throw new Error(`ffprobe 실패: ${filePath} — ${(err as Error).message}`);
  }

  const raw = JSON.parse(stdout) as RawProbe;
  const audio = (raw.streams ?? []).filter((s) => s.codec_type === 'audio');
  if (audio.length === 0) throw new Error(`오디오 스트림이 없습니다: ${filePath}`);

  const usable = audio.find((s) => !UNDECODABLE_CODECS.has(s.codec_name ?? ''));
  if (!usable) {
    throw new Error(
      `디코딩 가능한 오디오 스트림이 없습니다: ${filePath} ` +
        `(${audio.map((s) => s.codec_name).join(', ')})`
    );
  }

  // Number('')는 0이고 Number.isFinite(0)은 true라, 빈 duration을
  // 그냥 통과시키면 0초짜리 녹음으로 조용히 취급된다 — 크래시는 안 나지만
  // 재생기가 0:00을 표시하고 파형 버킷도 어긋난다. 빈 문자열/누락을
  // 먼저 걸러낸 뒤 숫자로 바꾼다.
  const rawDuration = raw.format?.duration;
  const duration = rawDuration === undefined || rawDuration.trim() === '' ? NaN : Number(rawDuration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`길이를 읽을 수 없습니다: ${filePath} (duration=${JSON.stringify(rawDuration)})`);
  }

  const tags = raw.format?.tags ?? {};
  return {
    durationSec: duration,
    title: tags.title ?? null,
    creationTime: tags.creation_time ?? null,
    audioStreamIndex: usable.index,
    codecName: usable.codec_name ?? '',
    channels: usable.channels ?? 0
  };
}
