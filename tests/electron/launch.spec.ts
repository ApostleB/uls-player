import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let dataDir: string;
let mediaDir: string;

/** 그 pid의 프로세스가 아직 살아 있는가. 신호 0은 존재 확인용이다. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test.beforeEach(async () => {
  // 개발자가 쌓아둔 실제 라이브러리를 건드리지 않는다. 동시에 이 경로는
  // "환경변수가 셸의 기본값을 이긴다"는 규칙이 실제로 도는지도 보여준다.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uls-electron-data-'));
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uls-electron-media-'));
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, DATA_DIR: dataDir, MEDIA_DIR: mediaDir }
  });
});

test.afterEach(async () => {
  await app.close().catch(() => {
    // 테스트가 이미 닫았을 수 있다.
  });
  for (const dir of [dataDir, mediaDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('창이 뜨고 메인 화면이 보인다', async () => {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'ULS Player' })).toBeVisible();
  await expect(page.getByRole('link', { name: '녹음 목록' })).toBeVisible();
});

test('앱을 닫으면 서버 프로세스가 남지 않는다', async () => {
  // firstWindow()는 창이 만들어지면 바로 끝난다 — 이제 창이 서버 fork보다
  // 먼저 생기므로, 이 시점에 fork가 끝났다는 보장이 없다. heading이 보일
  // 때까지 기다리면 서버가 응답했다는 뜻이고, 그러려면 fork가 이미 끝나
  // 있어야 한다.
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'ULS Player' })).toBeVisible();
  const pid = Number(await app.evaluate(() => process.env.ULS_SERVER_PID));
  expect(pid).toBeGreaterThan(0);
  expect(isAlive(pid)).toBe(true);

  await app.close();

  // 종료 정리를 지우면 서버가 계속 살아 있어 이 단언이 깨진다.
  await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);
});
