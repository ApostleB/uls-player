export type ShutdownCommand =
  | { kind: 'taskkill'; command: 'taskkill'; args: string[] }
  | { kind: 'signal'; signal: NodeJS.Signals };

/**
 * 서버 자식 프로세스를 어떻게 죽일지 고른다.
 *
 * Windows에는 유닉스 같은 프로세스 그룹이 없어, 부모만 죽이면 서버가
 * spawn한 ffmpeg가 살아남는다 — 앱을 닫아도 변환이 계속 돌며 media/에
 * 파일을 쓴다. 사용자에게는 보이지 않는 채로. taskkill의 /T가 자식
 * 트리까지 함께 죽인다.
 */
export function shutdownCommand(platform: NodeJS.Platform, pid: number): ShutdownCommand {
  if (platform === 'win32') {
    return { kind: 'taskkill', command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
  }
  return { kind: 'signal', signal: 'SIGTERM' };
}
