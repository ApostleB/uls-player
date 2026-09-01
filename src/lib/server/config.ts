import path from 'node:path';
import type { AppConfig, FormatSpec } from '$lib/types';

/** 포맷별 기본값. env는 이 위에 덮어쓰기만 한다. */
const FORMAT_DEFAULTS: Record<string, Omit<FormatSpec, 'name'>> = {
  mp3: { ext: 'mp3', codec: 'libmp3lame', bitrate: '192k', sampleRate: 44100, channels: 2 },
  wav: { ext: 'wav', codec: 'pcm_s16le', bitrate: null, sampleRate: 44100, channels: 1 }
};

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key}는 숫자여야 합니다: ${raw}`);
  return n;
}

export function loadConfig(env: Env): AppConfig {
  const names = (env.OUTPUT_FORMATS ?? 'mp3,wav')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const formats: FormatSpec[] = names.map((name) => {
    const base = FORMAT_DEFAULTS[name];
    if (!base) {
      throw new Error(
        `OUTPUT_FORMATS에 알 수 없는 포맷이 있습니다: ${name}. ` +
          `지원 포맷: ${Object.keys(FORMAT_DEFAULTS).join(', ')}`
      );
    }
    const up = name.toUpperCase();
    return {
      name,
      ext: base.ext,
      codec: env[`${up}_CODEC`] ?? base.codec,
      bitrate: env[`${up}_BITRATE`] ?? base.bitrate,
      sampleRate: base.sampleRate === null ? null : num(env, `${up}_SAMPLE_RATE`, base.sampleRate),
      channels: base.channels === null ? null : num(env, `${up}_CHANNELS`, base.channels)
    };
  });

  return {
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    mediaDir: path.resolve(env.MEDIA_DIR ?? './media'),
    formats,
    convertConcurrency: num(env, 'CONVERT_CONCURRENCY', 4),
    waveformPeaks: num(env, 'WAVEFORM_PEAKS', 2000),
    maxUploadMb: num(env, 'MAX_UPLOAD_MB', 500)
  };
}

/** 프로세스 env로 만든 싱글턴. 라우트와 잡에서 쓴다. */
export const config: AppConfig = loadConfig(process.env);
