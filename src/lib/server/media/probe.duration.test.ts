import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * duration이 비었거나 0인 경우를 실제 오디오 파일로는 만들 수 없다 —
 * ffprobe가 정상 파일에서 그런 값을 내놓지 않기 때문이다. 그래서 이
 * 케이스만 child_process를 모킹해 별도 파일로 둔다(모듈 단위 모킹이
 * probe.test.ts의 실제 픽스처 테스트까지 오염시키지 않도록 분리).
 *
 * 왜 중요한가: Number('')는 0이고 Number.isFinite(0)은 true라, 빈
 * duration을 그냥 통과시키면 0초짜리 녹음으로 조용히 저장된다. 크래시는
 * 안 나지만 재생기가 0:00을 표시하고 파형 버킷 매핑도 어긋난다.
 */

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}));

const { probe } = await import('./probe');

/** promisify(execFile)이 기대하는 콜백 규약으로 stdout을 돌려준다. */
function respondWith(json: unknown): void {
  execFileMock.mockImplementation((_cmd: string, _args: string[], cb: unknown) => {
    (cb as (e: Error | null, r: { stdout: string; stderr: string }) => void)(null, {
      stdout: JSON.stringify(json),
      stderr: ''
    });
  });
}

const AAC_STREAM = { index: 0, codec_name: 'aac', codec_type: 'audio', channels: 2 };

beforeEach(() => {
  execFileMock.mockReset();
});

describe('probe — duration 유효성', () => {
  it('duration이 빈 문자열이면 던진다 (0초로 조용히 통과하지 않는다)', async () => {
    respondWith({ streams: [AAC_STREAM], format: { duration: '' } });
    await expect(probe('/fake/a.m4a')).rejects.toThrow(/길이를 읽을 수 없습니다/);
  });

  it('duration 필드 자체가 없으면 던진다', async () => {
    respondWith({ streams: [AAC_STREAM], format: {} });
    await expect(probe('/fake/a.m4a')).rejects.toThrow(/길이를 읽을 수 없습니다/);
  });

  it('duration이 "0"이면 던진다', async () => {
    respondWith({ streams: [AAC_STREAM], format: { duration: '0' } });
    await expect(probe('/fake/a.m4a')).rejects.toThrow(/길이를 읽을 수 없습니다/);
  });

  it('duration이 숫자가 아니면 던진다', async () => {
    respondWith({ streams: [AAC_STREAM], format: { duration: 'N/A' } });
    await expect(probe('/fake/a.m4a')).rejects.toThrow(/길이를 읽을 수 없습니다/);
  });

  it('오류 메시지에 실제로 읽은 값을 담아 진단할 수 있게 한다', async () => {
    respondWith({ streams: [AAC_STREAM], format: { duration: '' } });
    await expect(probe('/fake/a.m4a')).rejects.toThrow(/duration=""/);
  });

  it('정상 duration은 그대로 통과한다', async () => {
    respondWith({ streams: [AAC_STREAM], format: { duration: '2.2767' } });
    const r = await probe('/fake/a.m4a');
    expect(r.durationSec).toBeCloseTo(2.2767, 4);
  });
});
