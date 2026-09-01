import { spawn } from 'node:child_process';

/** 피크 계산용 디코딩 샘플레이트. 파형 표시에는 이 정도면 충분하다. */
const PEAK_SAMPLE_RATE = 8000;

/**
 * 스트리밍 중 1차 축소에 쓰는 미니버킷 크기(샘플 수). 8kHz 기준 64샘플 = 8ms.
 * 최종 peaks(기본 2000)개 구간에 비해 훨씬 촘촘해서 정밀도 손실 없이
 * 중간 배열 크기를 sampleCount/64로 묶어 둔다.
 */
const MINI_BUCKET = 64;

/**
 * 8kHz 모노 PCM을 파이프로 받아 구간별 최대 진폭만 남긴다.
 * 중간 PCM은 디스크에 쓰지 않는다.
 *
 * 2단계 축소: 스트리밍 중에는 MINI_BUCKET(64)샘플마다 최대값 하나만 남기고
 * (미니버킷 최대는 청크 경계를 넘어 이어진다), close 시점에 그 미니버킷
 * 최대값들을 다시 peaks개 구간으로 묶는다. 최대의 최대는 전체 구간의
 * 최대와 같으므로 피크 값 자체는 그대로 보존되고, 중간 배열은
 * sampleCount 전체가 아니라 sampleCount/64만큼만 메모리에 남는다.
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

    // 1차 축소 결과: 미니버킷별 최대 진폭. 전체 샘플을 그대로 들고 있지 않는다.
    const miniMaxima: number[] = [];
    let miniMax = 0;
    let miniCount = 0;
    let sampleCount = 0;

    let leftover: Buffer = Buffer.alloc(0);
    let stderr = '';

    ff.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    ff.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i)) / 32768;
        if (v > miniMax) miniMax = v;
        miniCount++;
        sampleCount++;
        if (miniCount === MINI_BUCKET) {
          miniMaxima.push(miniMax);
          miniMax = 0;
          miniCount = 0;
        }
      }
      leftover = buf.subarray(usable);
    });

    ff.on('error', reject);

    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`파형 생성 실패: ${stderr.trim() || `ffmpeg exit ${code}`}`));
        return;
      }
      // 마지막 미니버킷이 MINI_BUCKET개를 채우지 못했어도 버리지 않고 반영한다.
      if (miniCount > 0) {
        miniMaxima.push(miniMax);
      }
      if (sampleCount === 0) {
        reject(new Error('파형 생성 실패: 샘플이 없습니다'));
        return;
      }

      // 미니버킷 최대값들을 peaks개 구간으로 나눠 각 구간의 최대값을 남긴다
      const out = new Array<number>(peaks);
      const per = miniMaxima.length / peaks;
      for (let i = 0; i < peaks; i++) {
        const start = Math.floor(i * per);
        const end = Math.max(start + 1, Math.floor((i + 1) * per));
        let m = 0;
        for (let j = start; j < end && j < miniMaxima.length; j++) {
          if (miniMaxima[j] > m) m = miniMaxima[j];
        }
        out[i] = m;
      }
      resolve(out);
    });
  });
}
