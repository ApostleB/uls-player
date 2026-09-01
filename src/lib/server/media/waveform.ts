import { spawn } from 'node:child_process';

/** 피크 계산용 디코딩 샘플레이트. 파형 표시에는 이 정도면 충분하다. */
const PEAK_SAMPLE_RATE = 8000;

/**
 * 8kHz 모노 PCM을 파이프로 받아 구간별 최대 진폭만 남긴다.
 * 중간 PCM은 디스크에 쓰지 않는다.
 */
export function generatePeaks(
  input: string,
  streamIndex: number,
  peaks: number
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-v', 'error',
      '-i', input,
      '-map', `0:${streamIndex}`,
      '-ac', '1',
      '-ar', String(PEAK_SAMPLE_RATE),
      '-f', 's16le',
      '-'
    ]);

    const maxima: number[] = [];
    let leftover: Buffer = Buffer.alloc(0);
    let stderr = '';

    ff.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    ff.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        maxima.push(Math.abs(buf.readInt16LE(i)) / 32768);
      }
      leftover = buf.subarray(usable);
    });

    ff.on('error', reject);

    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`파형 생성 실패: ${stderr.trim() || `ffmpeg exit ${code}`}`));
        return;
      }
      if (maxima.length === 0) {
        reject(new Error('파형 생성 실패: 샘플이 없습니다'));
        return;
      }

      // 전체 샘플을 peaks개 구간으로 나눠 각 구간의 최대 진폭을 남긴다
      const out = new Array<number>(peaks);
      const per = maxima.length / peaks;
      for (let i = 0; i < peaks; i++) {
        const start = Math.floor(i * per);
        const end = Math.max(start + 1, Math.floor((i + 1) * per));
        let m = 0;
        for (let j = start; j < end && j < maxima.length; j++) {
          if (maxima[j] > m) m = maxima[j];
        }
        out[i] = m;
      }
      resolve(out);
    });
  });
}
