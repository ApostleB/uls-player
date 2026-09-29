import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let dataDir: string;
let mediaDir: string;
let pickedDir: string;

test.beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uls-picker-data-'));
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uls-picker-media-'));
  pickedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uls-picker-target-'));
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, DATA_DIR: dataDir, MEDIA_DIR: mediaDir }
  });
});

test.afterEach(async () => {
  await app.close().catch(() => {
    // 이미 닫혔을 수 있다.
  });
  for (const dir of [dataDir, mediaDir, pickedDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('찾아보기로 고른 폴더가 경로 칸에 들어간다', async () => {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'ULS Player' })).toBeVisible();

  // 네이티브 대화상자는 자동화할 수 없다. main 쪽에서 미리 답을 정해 둔다.
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, pickedDir);

  await page.goto(page.url().replace(/\/$/, '') + '/import');
  await page.getByRole('button', { name: '찾아보기' }).click();

  await expect(page.getByLabel('스캔할 서버 폴더 경로')).toHaveValue(pickedDir);
});

test('취소하면 경로 칸이 비어 있는 채로 남는다', async () => {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'ULS Player' })).toBeVisible();

  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });

  await page.goto(page.url().replace(/\/$/, '') + '/import');
  await page.getByRole('button', { name: '찾아보기' }).click();

  await expect(page.getByLabel('스캔할 서버 폴더 경로')).toHaveValue('');
});
