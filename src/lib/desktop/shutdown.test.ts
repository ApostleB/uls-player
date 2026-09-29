import { describe, it, expect } from 'vitest';
import { shutdownCommand } from './shutdown';

describe('서버 프로세스 종료 명령', () => {
  it('Windows에서는 자식 트리까지 함께 죽인다', () => {
    const cmd = shutdownCommand('win32', 4321);
    expect(cmd).toEqual({
      kind: 'taskkill',
      command: 'taskkill',
      args: ['/PID', '4321', '/T', '/F']
    });
  });

  it('Windows 인자에 /T가 반드시 들어간다 — 없으면 ffmpeg가 고아로 남는다', () => {
    const cmd = shutdownCommand('win32', 1);
    expect(cmd.kind === 'taskkill' && cmd.args).toContain('/T');
  });

  it('macOS에서는 SIGTERM을 보낸다', () => {
    expect(shutdownCommand('darwin', 4321)).toEqual({ kind: 'signal', signal: 'SIGTERM' });
  });

  it('Linux에서는 SIGTERM을 보낸다', () => {
    expect(shutdownCommand('linux', 4321)).toEqual({ kind: 'signal', signal: 'SIGTERM' });
  });
});
