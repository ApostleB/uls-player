import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FormatSpec } from '$lib/types';

const run = promisify(execFile);

/**
 * 지정한 절대 스트림 인덱스 하나만 뽑아 spec대로 인코딩한다.
 *
 * streamIndex는 ffprobe가 준 절대 인덱스여야 한다. `-map 0:a:0` 같은
 * 오디오 상대 인덱스를 쓰면 어느 트랙이 잡혔는지 알 수 없다.
 */
export async function convert(
  input: string,
  output: string,
  streamIndex: number,
  spec: FormatSpec
): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true });

  // null("이 포맷은 이 옵션을 안 쓴다")과 0을 구분한다. 진리값으로
  // 검사하면 0이 null과 같이 취급돼 -ar/-ac가 조용히 빠지는데, env로
  // 0을 넣는 건 명백한 설정 실수이므로 조용히 무시하는 대신 거부한다.
  const args = ['-y', '-v', 'error', '-i', input, '-map', `0:${streamIndex}`, '-c:a', spec.codec];

  if (spec.bitrate !== null) {
    if (spec.bitrate.trim() === '') throw new Error(`${spec.name}: bitrate가 비어 있습니다`);
    args.push('-b:a', spec.bitrate);
  }
  if (spec.sampleRate !== null) {
    if (spec.sampleRate <= 0) {
      throw new Error(`${spec.name}: sampleRate는 0보다 커야 합니다 (${spec.sampleRate})`);
    }
    args.push('-ar', String(spec.sampleRate));
  }
  if (spec.channels !== null) {
    if (spec.channels <= 0) {
      throw new Error(`${spec.name}: channels는 0보다 커야 합니다 (${spec.channels})`);
    }
    args.push('-ac', String(spec.channels));
  }

  args.push(output);

  try {
    await run('ffmpeg', args);
  } catch (err) {
    // ffmpeg가 실패하면 잘린 출력이 남을 수 있다. 재시도가 깨끗하도록 지운다.
    await fs.rm(output, { force: true });
    const e = err as { stderr?: string; message: string };
    throw new Error(`변환 실패 (${spec.name}): ${(e.stderr ?? e.message).trim()}`);
  }
}
