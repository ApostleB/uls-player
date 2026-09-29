import { app, BrowserWindow, dialog, shell } from 'electron';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { buildServerEnv } from '../src/lib/desktop/env';
import { findFreePort } from '../src/lib/desktop/port';
import { shutdownCommand } from '../src/lib/desktop/shutdown';

/** 서버가 응답할 때까지 기다리는 최대 시간. */
const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// 개발 중에는 실제 데이터와 섞이지 않게 별도 폴더를 쓴다.
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'uls-player-dev'));
}

/**
 * 패키지에서는 build/가 asar 밖(extraResources)에 있다. ESM 로더와 asar의
 * 조합이 알려진 문제군이라 통째로 밖에 뒀다 — 설계 문서 3절.
 */
function serverEntry(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(root, 'build', 'index.js');
}

/** 동봉한 ffmpeg 폴더. 개발 중에는 null이라 PATH의 ffmpeg를 쓴다. */
function binariesDir(): string | null {
  if (!app.isPackaged) return null;
  return path.join(process.resourcesPath, 'ffmpeg', 'win');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(): Promise<number> {
  const port = await findFreePort();
  const env = buildServerEnv({
    port,
    userDataDir: app.getPath('userData'),
    binariesDir: binariesDir(),
    base: process.env,
    platform: process.platform
  });

  // execPath를 Electron 바이너리로 두고 env의 ELECTRON_RUN_AS_NODE=1을
  // 함께 넘기면, 그 바이너리가 순수 Node로 동작한다 — node.exe를 따로
  // 동봉할 필요가 없다.
  const child = fork(serverEntry(), [], {
    execPath: process.execPath,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  child.stdout?.on('data', (c: Buffer) => process.stdout.write(`[서버] ${c}`));
  child.stderr?.on('data', (c: Buffer) => process.stderr.write(`[서버] ${c}`));
  child.on('exit', onServerExit);
  serverProcess = child;

  // e2e가 종료 정리를 검증할 때 이 pid를 읽는다(tests/electron/launch.spec.ts).
  // 진단용이기도 하다 — 문제가 생겼을 때 어느 프로세스를 봐야 하는지 알려준다.
  process.env.ULS_SERVER_PID = String(child.pid);

  return port;
}

async function waitForServer(port: number): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      // 5xx도 "떴다"로 본다 — 포트가 응답하는 것이 여기서 확인할 전부다.
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      // 아직 안 떴다.
    }
    if (Date.now() > deadline) {
      throw new Error(`서버가 ${STARTUP_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다`);
    }
    await delay(POLL_INTERVAL_MS);
  }
}

function stopServer(): void {
  const proc = serverProcess;
  if (proc === null || proc.exitCode !== null || proc.signalCode !== null) return;
  serverProcess = null;
  // 우리가 죽이는 것은 오류가 아니다 — 오류 대화상자가 뜨지 않게 뗀다.
  proc.off('exit', onServerExit);

  const cmd = shutdownCommand(process.platform, proc.pid as number);
  if (cmd.kind === 'taskkill') {
    execFile(cmd.command, cmd.args, () => {
      // 이미 죽었으면 taskkill이 실패한다. 종료 중이므로 무시한다.
    });
  } else {
    proc.kill(cmd.signal);
  }
}

function onServerExit(code: number | null, signal: NodeJS.Signals | null): void {
  serverProcess = null;
  fail('서버가 예기치 않게 종료되었습니다', `종료 코드 ${code}, 신호 ${signal}`);
}

function fail(title: string, detail: string): void {
  dialog.showErrorBox(title, detail);
  stopServer();
  app.exit(1);
}

function createWindow(port: number): void {
  const origin = `http://127.0.0.1:${port}`;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'ULS Player',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 앱 바깥으로 나가는 이동은 창이 아니라 기본 브라우저가 받는다.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(origin);
}

async function main(): Promise<void> {
  await app.whenReady();
  let port: number;
  try {
    port = await startServer();
    await waitForServer(port);
  } catch (err) {
    fail('서버를 시작하지 못했습니다', (err as Error).message);
    return;
  }
  createWindow(port);
}

// 두 인스턴스가 뜨면 각자 잡 큐를 돌려 같은 recordings.json을 서로
// 덮어쓴다 — ecosystem.config.cjs가 클러스터 모드를 금지한 것과 같은
// 손상이다. 서버에서는 pm2 설정으로, 데스크톱에서는 여기서 막는다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', stopServer);
  void main();
}
