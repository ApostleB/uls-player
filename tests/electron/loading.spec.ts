import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let dataDir: string;
let mediaDir: string;

test.beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uls-loading-data-'));
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uls-loading-media-'));
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, DATA_DIR: dataDir, MEDIA_DIR: mediaDir }
  });
});

test.afterEach(async () => {
  await app.close().catch(() => {
    // 이미 닫혔을 수 있다.
  });
  for (const dir of [dataDir, mediaDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('로딩 화면을 먼저 띄우고, 서버가 뜨면 앱으로 넘어간다', async () => {
  const page = await app.firstWindow();
  // heading은 앱 화면에만 있다 — 로딩 화면은 heading을 쓰지 않는다.
  await expect(page.getByRole('heading', { name: 'ULS Player' })).toBeVisible();

  // 앱이 뜬 뒤, 이 창이 거쳐 온 주소를 본다. 창을 서버 뒤로 되돌리면
  // 첫 주소가 곧바로 앱 주소가 되어 첫 단언이 깨진다. 시점에 기대지 않고
  // 기록을 보므로 서버가 아무리 빨리 떠도 흔들리지 않는다.
  const urls = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.navigationHistory.getAllEntries().map((e) => e.url)
  );
  expect(urls[0]).toMatch(/^data:text\/html/);
  expect(urls[urls.length - 1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
});
