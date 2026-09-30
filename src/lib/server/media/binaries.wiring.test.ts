import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

const execFileMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock, spawn: spawnMock }));

/** env를 바꾼 상태로 모듈을 새로 평가한다(binaries.ts가 import 시점에 읽으므로). */
async function loadWith<T>(specifier: string, env: Record<string, string>): Promise<T> {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return (await import(specifier)) as T;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** stdout/stderr를 가진 최소한의 가짜 자식. 바로 error를 내보내 끝낸다. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => child.emit('error', new Error('테스트용 즉시 실패')));
  return child;
}

beforeEach(() => {
  execFileMock.mockReset();
  spawnMock.mockReset();
});

describe('호출부가 동봉 바이너리 경로를 쓴다', () => {
  it('convert는 FFMPEG_PATH로 지정한 실행 파일을 부른다', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: unknown) => {
      (cb as (e: null, r: { stdout: string; stderr: string }) => void)(null, {
        stdout: '',
        stderr: ''
      });
    });
    const { convert } = await loadWith<typeof import('./convert')>('./convert', {
      FFMPEG_PATH: '/opt/bundled/ffmpeg'
    });
    await convert(
      path.join(os.tmpdir(), 'in.m4a'),
      path.join(os.tmpdir(), 'out.mp3'),
      0,
      { name: 'mp3', ext: 'mp3', codec: 'libmp3lame', bitrate: '192k', sampleRate: 44100, channels: 2, compressionLevel: null }
    );
    expect(execFileMock.mock.calls[0][0]).toBe('/opt/bundled/ffmpeg');
  });

  it('probe는 FFPROBE_PATH로 지정한 실행 파일을 부른다', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: unknown) => {
      (cb as (e: Error) => void)(new Error('테스트용 즉시 실패'));
    });
    const { probe } = await loadWith<typeof import('./probe')>('./probe', {
      FFPROBE_PATH: '/opt/bundled/ffprobe'
    });
    await expect(probe('/tmp/in.m4a')).rejects.toThrow('ffprobe 실패');
    expect(execFileMock.mock.calls[0][0]).toBe('/opt/bundled/ffprobe');
  });

  it('generatePeaks는 FFMPEG_PATH로 지정한 실행 파일을 부른다', async () => {
    spawnMock.mockImplementation(() => fakeChild());
    const { generatePeaks } = await loadWith<typeof import('./waveform')>('./waveform', {
      FFMPEG_PATH: '/opt/bundled/ffmpeg'
    });
    await expect(generatePeaks('/tmp/in.m4a', 0, 100)).rejects.toThrow('테스트용 즉시 실패');
    expect(spawnMock.mock.calls[0][0]).toBe('/opt/bundled/ffmpeg');
  });
});
