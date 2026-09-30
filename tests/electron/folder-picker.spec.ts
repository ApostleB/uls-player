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

test('취소하면 null을 돌려주고 이미 고른 경로를 덮어쓰지 않는다', async () => {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'ULS Player' })).toBeVisible();
  await page.goto(page.url().replace(/\/$/, '') + '/import');

  // 먼저 성공적으로 하나 고른다 — 취소가 "덮어쓰지 않는다"를 확인하려면
  // 덮어써질 값이 먼저 있어야 한다.
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, pickedDir);
  await page.getByRole('button', { name: '찾아보기' }).click();
  await expect(page.getByLabel('스캔할 서버 폴더 경로')).toHaveValue(pickedDir);

  // 이제 취소.
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });

  // main의 취소 분기를 지우면 undefined가 와서 이 단언이 깨진다.
  const returned = await page.evaluate(() => window.ulsDesktop!.pickFolder());
  expect(returned).toBeNull();

  // 그리고 먼저 고른 값이 그대로 남아 있어야 한다.
  await expect(page.getByLabel('스캔할 서버 폴더 경로')).toHaveValue(pickedDir);
});

test('데스크톱에서는 업로드 칸을 그리지 않는다 — 스캔이 디스크에서 직접 읽는다', async () => {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'ULS Player' })).toBeVisible();
  await page.goto(page.url().replace(/\/$/, '') + '/import');

  // 찾아보기 버튼이 보여야 데스크톱 판정(onMount)이 끝난 것이다. 그 전에
  // 업로드 칸이 없는지 보면, 페이지가 아직 안 그려져서 "없음"으로 통과해
  // 버린다.
  await expect(page.getByRole('button', { name: '찾아보기' })).toBeVisible();

  // 업로드는 요청 전체를 메모리에 올린 뒤에야 처리한다. 데스크톱에서
  // 음성 메모 폴더(313개, 약 3GB)를 넣으면 "Failed to allocate memory"로
  // 죽는다 — 실제로 겪었다.
  await expect(page.getByText('끌어다 놓거나')).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});
