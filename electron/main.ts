import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServerEnv } from '../src/lib/desktop/env';
import { findFreePort } from '../src/lib/desktop/port';
import { shutdownCommand } from '../src/lib/desktop/shutdown';

/** 서버가 응답할 때까지 기다리는 최대 시간. */
const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;

/**
 * 자식 stderr의 마지막 조각을 담아 두는 링 버퍼.
 *
 * 패키징된 Windows GUI 앱에는 콘솔이 없어 process.stderr가 아무 곳으로도
 * 이어지지 않는 핸들이다 — child.stderr를 거기로 그대로 흘려보내는 것은
 * 로그를 만드는 게 아니라 버리는 것과 같다. 그 결과 사용자가 실패 대화상자에서
 * 보는 건 "종료 코드 1, 신호 null"뿐이라, 동봉 ffmpeg·네이티브 prebuild·
 * taskkill처럼 macOS에서 검증할 수 없는 표면에서 뭔가 깨져도 원인을 알
 * 방법이 없다. 최근 내용만 메모리에 들고 있다가 fail()의 detail에 붙여
 * 대화상자 자체에 실어 보낸다 — 사용자가 스크린샷만 찍어 보내도 원인 파악이
 * 가능해진다.
 */
const STDERR_TAIL_LIMIT = 2000; // 대략 마지막 2KB. 원인 파악에 필요한 몇 줄이면 충분하다.
let stderrTail = '';

function appendStderrTail(chunk: string): void {
  stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_LIMIT);
}

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

/**
 * 동봉한 ffmpeg 폴더. 개발 중에는 null이라 PATH의 ffmpeg를 쓴다.
 *
 * process.platform으로 폴더를 고른다 — env.test.ts가 이미 'darwin' 같은
 * 플랫폼 이름 폴더를 전제하고 있고(binaryDir + .exe 접미사 분기), 여기가
 * 'win'으로 고정돼 있으면 그 계약과 어긋난다. electron-builder.yml의
 * extraResources도 로컬 소스 폴더명(ffmpeg/win)과 무관하게 패키지 안
 * 배치 경로를 ffmpeg/win32로 맞춰 뒀다.
 *
 * existsSync로 실제 존재를 확인하는 이유: 설계가 열어둔 미래의 mac 빌드처럼
 * 그 플랫폼용 폴더를 아직 동봉하지 않은 경우, 확인 없이 경로만 만들면
 * FFMPEG_PATH가 "존재하지 않는 절대경로"가 된다 — 이건 PATH 폴백보다
 * 나쁘다. env.ts의 unset() 폴백은 FFMPEG_PATH가 "설정 안 됨"일 때만
 * 동작하므로, 없는 경로를 굳이 만들어 넣으면 그 폴백 자체가 무력화된다.
 */
function binariesDir(): string | null {
  if (!app.isPackaged) return null;
  const dir = path.join(process.resourcesPath, 'ffmpeg', process.platform);
  return existsSync(dir) ? dir : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * url이 우리 서버(origin) 안쪽인지 판단한다.
 *
 * `url.startsWith(origin)`은 구분자가 없어 포트 접두사까지 통과시킨다 —
 * origin이 http://127.0.0.1:5000이면 http://127.0.0.1:50001/...도 "내부"로
 * 잘못 판정된다. URL을 파싱해 origin을 정확히 비교해야 이 앱이 지는 유일한
 * 보안 경계(외부 탐색·새 창을 기본 브라우저로 돌리는 것)가 실제로 선다.
 */
function isInternal(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    // 파싱조차 안 되는 것은 우리 것이 아니다.
    return false;
  }
}

async function startServer(): Promise<number> {
  const port = await findFreePort();
  const env = buildServerEnv({
    port,
    userDataDir: app.getPath('userData'),
    binariesDir: binariesDir(),
    base: process.env,
    platform: process.platform,
    cpuCount: os.availableParallelism()
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
  child.stderr?.on('data', (c: Buffer) => {
    const text = c.toString();
    // 개발 중(콘솔이 있는 상태)에는 그대로도 보이지만, 패키징된 앱에서는
    // 이 write가 사실상 /dev/null이다 — 그래서 링 버퍼에도 반드시 남긴다.
    process.stderr.write(`[서버] ${text}`);
    appendStderrTail(text);
  });
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
      // 마감 검사(아래 deadline 비교)는 fetch가 돌아온 뒤에야 돈다 — fetch
      // 자체에 타임아웃을 안 주면, 포트는 열렸는데 응답을 못 주는 서버(초기화
      // 도중 블로킹 등)를 만났을 때 undici 기본 헤더 타임아웃(300초)까지 이
      // 한 번의 호출이 매달린다. 그동안 창도 오류 대화상자도 뜨지 않는다 —
      // "15초 기동 대기"와 "흰 화면 방치 금지"를 둘 다 깨는 셈이라, 시도 하나
      // 당 타임아웃을 폴링 간격 수준으로 짧게 준다.
      // 5xx도 "떴다"로 본다 — 포트가 응답하는 것이 여기서 확인할 전부이므로
      // 본문을 받을 필요가 없는 HEAD로 요청한다.
      await fetch(`http://127.0.0.1:${port}/`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(1_000)
      });
      return;
    } catch {
      // 아직 안 떴다(연결 거부) 또는 이번 시도가 타임아웃났다 — 둘 다 재시도.
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
    execFile(cmd.command, cmd.args, (err, _stdout, stderr) => {
      // 빈 콜백으로 두면 "이미 죽어서 실패"(정상)와 "taskkill이 없거나
      // 권한이 거부돼 실패"(비정상)를 구분할 방법이 아예 사라진다. 후자가
      // 조용히 넘어가면 서버 프로세스도, 그 자식 ffmpeg도 살아남는다 —
      // 이 함수 전체가 막으려는 바로 그 "Windows 고아 ffmpeg" 상태다.
      // 두 경우를 정교하게 가르기보다(taskkill의 실패 메시지가 로캘마다
      // 다르다) 실패하면 일단 로그로 남긴다 — 조용히 넘기지 않는 것 자체가
      // 목적이다. 앱이 종료 중이라 대화상자로 띄울 곳이 없으므로 링
      // 버퍼에라도 남겨, 다음에 fail()이 불리면(또는 사용자가 아직 켜져
      // 있는 앱을 관찰할 때) 흔적이 남게 한다.
      if (err) {
        const msg = `[taskkill] 실패(pid=${proc.pid}): ${err.message}${stderr ? `\n${stderr}` : ''}`;
        process.stderr.write(`${msg}\n`);
        appendStderrTail(msg);
      }
    });
  } else {
    proc.kill(cmd.signal);
  }
}

function onServerExit(code: number | null, signal: NodeJS.Signals | null): void {
  serverProcess = null;
  const tail = stderrTail.trim();
  const detail =
    `종료 코드 ${code}, 신호 ${signal}` +
    (tail ? `\n\n최근 서버 로그:\n${tail}` : '\n\n(서버가 stderr에 아무것도 남기지 않았습니다)');
  fail('서버가 예기치 않게 종료되었습니다', detail);
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 컴파일 결과가 dist-electron/electron/ 안에 나란히 놓인다.
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 앱 바깥으로 나가는 이동은 창이 아니라 기본 브라우저가 받는다.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInternal(url, origin)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternal(url, origin)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(origin);
}

async function main(): Promise<void> {
  await app.whenReady();
  ipcMain.handle('uls:pick-folder', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
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
