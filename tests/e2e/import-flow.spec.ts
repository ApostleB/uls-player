import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * 스캔 → 편집 → 변환 → 목록 → 필터 → 재생을 실제 브라우저로 한 바퀴 돈다.
 *
 * Task 13~16 리뷰가 컴포넌트 테스트·curl로만 확인하고 실제 클릭·키보드
 * 입력으로는 검증하지 못한 채 미뤄둔 것들을 여기서 처음 실제로 누른다:
 * 행 클릭 → 재생기 로드, 인라인 편집의 blur 커밋, 태그 칩 토글, 파형
 * 클릭 탐색, 키보드 단축키, 포맷 전환 시 위치 유지. 시나리오가 전부
 * 이어지는 데이터(스캔에서 만든 두 녹음)에 의존하므로 파일 전체를
 * serial로 묶는다 — 앞 단계가 실패하면 뒤는 의미가 없다.
 *
 * DATA_DIR·MEDIA_DIR은 playwright.config.ts가 임시 디렉터리를 만들어
 * 웹서버에 넘긴다 — 개발자의 실제 data/·media/는 이 스위트가 절대
 * 건드리지 않는다.
 */

const FIX_DB = path.resolve('tests/fixtures/CloudRecordings.db');
const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const PLAIN = path.resolve('tests/fixtures/audio/plain.m4a');

// CloudRecordings.db 픽스처의 실제 행과 이름이 맞아떨어져야 DB 제목이
// 채워진다 (tests/fixtures/CloudRecordings.db 참고).
const QTA_NAME = '20260711 181530-1923A106.qta';
const QTA_TITLE = '새로운 녹음 2'; // DB ZCUSTOMLABEL이자 파일 자체 메타 title이기도 하다
const QTA_DURATION_SEC = 2.27666666666667; // DB ZDURATION

// 파일명은 DB의 39A2B8E8 행과 매치하도록 고른 것이다: DB 사용자 제목은
// "비와 당신"인데, 파일 자체의(Apple이 위치 기반으로 자동 생성한) 메타
// title은 "화양동 16 2"다 — 스캔이 DB 제목을 우선해야 한다는 걸 이
// 불일치로 실제로 증명할 수 있다.
const M4A_NAME = '20260725 005422-39A2B8E8.m4a';
const M4A_TITLE = '비와 당신';
const M4A_TITLE_FROM_FILE_META = '화양동 16 2';

let srcDir: string;

async function selectRecording(page: Page, title: string) {
  await page.goto('/');
  const waveform = page.waitForResponse(
    (res) => res.url().includes('/api/waveform/') && res.request().method() === 'GET'
  );
  await page.getByRole('button', { name: title, exact: true }).click();
  await waveform;
  // 방금 누른 제목 버튼에 포커스가 남아 있으면, 뒤이은 Space 단축키가
  // 재생/일시정지 토글과 그 버튼의 기본 활성화 동작(브라우저가 Space를
  // 버튼 클릭으로도 해석한다) 둘 다에 걸릴 수 있다. 포커스를 옮겨 순수하게
  // svelte:window의 키보드 핸들러만 타게 한다.
  await page.locator('h1', { hasText: 'ULS Player' }).click();
}

function rowFor(page: Page, title: string) {
  return page
    .locator('ul.space-y-1 > li')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
}

async function audioState(page: Page) {
  return page.locator('audio').evaluate((el) => {
    const a = el as HTMLAudioElement;
    return { paused: a.paused, muted: a.muted, currentTime: a.currentTime, volume: a.volume };
  });
}

function waitForPatch(page: Page) {
  // 북마크 메모 blur·삭제 모두 서버 응답을 기다리지 않고 낙관적으로 화면부터
  // 바꾼다(Player.svelte 주석 참고) — 그래서 blur()가 리턴해도 PATCH가 아직
  // 인플라이트일 수 있다. 그 상태에서 곧장 selectRecording()으로 page.goto해
  // 버리면 브라우저가 진행 중이던 fetch를 취소해, 로컬에는 반영됐지만 서버엔
  // 끝내 한 번도 안 남는(그래서 새로고침하면 사라지는) 거짓 성공을 만든다.
  // 진짜 영속 여부를 확인하려면 이 응답을 명시적으로 기다려야 한다.
  return page.waitForResponse(
    (res) => res.url().endsWith('/api/recordings') && res.request().method() === 'PATCH'
  );
}

async function seekViaWaveform(page: Page, ratio: number) {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('waveform canvas가 보이지 않습니다');
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
}

test.describe.serial('스캔부터 재생까지', () => {
  test.beforeAll(async () => {
    srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-e2e-src-'));
    await fs.copyFile(SPATIAL, path.join(srcDir, QTA_NAME));
    await fs.copyFile(PLAIN, path.join(srcDir, M4A_NAME));
    await fs.copyFile(FIX_DB, path.join(srcDir, 'CloudRecordings.db'));
  });

  test.afterAll(async () => {
    // 소스 폴더(스캔 대상)만 지운다 — DATA_DIR·MEDIA_DIR은 playwright.config.ts가
    // 프로세스 종료 시 정리하고, 개발자의 실제 data/·media/는 애초에 건드리지 않는다.
    await fs.rm(srcDir, { recursive: true, force: true });
  });

  test('가져오기 스캔: DB 사용자 제목이 파일 메타데이터보다 우선한다', async ({ page }) => {
    await page.goto('/import');
    await page.getByPlaceholder('/Volumes/Storage/voice').fill(srcDir);
    await page.getByRole('button', { name: '스캔' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(2);

    // recordedAt 내림차순 정렬: m4a(2026-07-25)가 qta(2026-07-11)보다 앞선다.
    const rows = page.locator('tbody tr');
    // 제목·설명·태그 입력은 <input>에 type 속성을 안 붙이므로(기본값
    // text) [type="text"] 어트리뷰트 선택자로는 못 찾는다 — 행 안의
    // textbox 역할 순서(제목·설명·태그)로 짚는다.
    const row0Title = rows.nth(0).getByRole('textbox').nth(0);
    const row1Title = rows.nth(1).getByRole('textbox').nth(0);

    // 화면에 채워진 값이 파일 메타 title("화양동 16 2")이 아니라 DB 제목인지가
    // 이 assertion의 핵심이다 — 둘이 다른 값이라 우연히 통과할 수 없다.
    await expect(row0Title).toHaveValue(M4A_TITLE);
    await expect(row0Title).not.toHaveValue(M4A_TITLE_FROM_FILE_META);
    await expect(row1Title).toHaveValue(QTA_TITLE);

    await expect(rows.nth(0).locator('td').last()).toHaveText('m4a');
    await expect(rows.nth(1).locator('td').last()).toHaveText('qta');
  });

  test('설명·태그를 입력하고 저장하면 두 파일 모두 변환이 끝난다', async ({ page }) => {
    await page.goto('/import');
    await page.getByPlaceholder('/Volumes/Storage/voice').fill(srcDir);
    await page.getByRole('button', { name: '스캔' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);

    const rows = page.locator('tbody tr');
    // 둘 다 기본으로 선택돼 있어야 한다(중복도 에러도 아니므로).
    await expect(rows.nth(0).locator('input[type="checkbox"]')).toBeChecked();
    await expect(rows.nth(1).locator('input[type="checkbox"]')).toBeChecked();

    await rows.nth(0).getByRole('textbox').nth(1).fill('첫 녹음 설명');
    await rows.nth(1).getByPlaceholder('태그 입력 후 Enter').fill('데모');
    await rows.nth(1).getByPlaceholder('태그 입력 후 Enter').press('Enter');

    await page.getByRole('button', { name: /2개 저장 및 변환/ }).click();

    // 실패가 하나라도 섞이면 "완료 2 / 2"에 영영 도달하지 못하므로, 이
    // expect 하나가 성공/실패 여부까지 함께 검증한다. ffmpeg 실작업이라
    // 넉넉한 타임아웃을 둔다.
    await expect(page.getByText(/완료 2 \/ 2/)).toBeVisible({ timeout: 60_000 });
  });

  test('목록에 변환된 두 녹음과 세 포맷 배지가 보인다', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();

    // 각 녹음이 원본·mp3·wav 셋 다 갖고 있는지: 배지 개수로 확인한다.
    await expect(page.locator('li .badge', { hasText: 'mp3' })).toHaveCount(2);
    await expect(page.locator('li .badge', { hasText: 'wav' })).toHaveCount(2);
    await expect(page.locator('li .badge', { hasText: 'm4a' })).toHaveCount(1);
    await expect(page.locator('li .badge', { hasText: 'qta' })).toHaveCount(1);
  });

  test('검색·태그 필터로 좁혀지고, 없는 조건이면 안내 문구가 뜬다', async ({ page }) => {
    await page.goto('/');

    await page.getByPlaceholder('제목 검색').fill('당신');
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);
    await page.getByPlaceholder('제목 검색').fill('');

    // '데모' 태그는 qta 녹음에만 붙었다. FilterBar의 태그 칩만 짚어야 한다 —
    // getByRole('button', {name: /^데모/})는 목록 행의 태그 표시 버튼("데모"
    // 그대로)에도 걸려 strict mode에서 두 개가 잡힌다. FilterBar 칩만
    // class="chip"을 직접 들고 있다(행 쪽은 안쪽 span에만 chip이 있다).
    const demoFilterChip = page.locator('button.chip', { hasText: '데모' });
    await demoFilterChip.click();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toHaveCount(0);
    await demoFilterChip.click(); // 태그 필터 해제

    await page.getByPlaceholder('제목 검색').fill('존재하지않는제목');
    await expect(page.getByText('조건에 맞는 녹음이 없습니다')).toBeVisible();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: '초기화' }).click();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
  });

  test('설명 인라인 편집이 blur로 저장되고 새로고침 후에도 남는다', async ({ page }) => {
    await page.goto('/');
    const row = rowFor(page, QTA_TITLE);

    await expect(row.getByRole('button', { name: '설명 없음' })).toBeVisible();
    await row.getByRole('button', { name: '설명 없음' }).dblclick();
    await row.getByLabel('설명 수정').fill('e2e 설명 수정');
    await row.getByLabel('설명 수정').blur();

    await expect(row.getByRole('button', { name: 'e2e 설명 수정' })).toBeVisible();

    await page.reload();
    await expect(rowFor(page, QTA_TITLE).getByRole('button', { name: 'e2e 설명 수정' })).toBeVisible();
  });

  test('태그 인라인 편집이 완료 버튼으로 저장되고 새로고침 후에도 남는다', async ({ page }) => {
    await page.goto('/');
    const row = rowFor(page, M4A_TITLE);

    await expect(row.getByText('태그 없음')).toBeVisible();
    await row.getByText('태그 없음').dblclick();
    await row.getByPlaceholder('태그 입력 후 Enter').fill('중요');
    await row.getByPlaceholder('태그 입력 후 Enter').press('Enter');
    await row.getByRole('button', { name: '완료' }).click();

    await expect(row.locator('.chip', { hasText: '중요' })).toBeVisible();

    await page.reload();
    await expect(rowFor(page, M4A_TITLE).locator('.chip', { hasText: '중요' })).toBeVisible();
  });

  test('일괄 태그 추가·제거가 선택된 여러 행에 적용된다', async ({ page }) => {
    await page.goto('/');

    await rowFor(page, M4A_TITLE).locator('input[type="checkbox"]').check();
    await rowFor(page, QTA_TITLE).locator('input[type="checkbox"]').check();
    await expect(page.getByText('2개 선택됨')).toBeVisible();

    await page.getByPlaceholder('태그 입력 후 Enter').fill('보관');
    await page.getByPlaceholder('태그 입력 후 Enter').press('Enter');
    await page.getByRole('button', { name: '태그 추가' }).click();

    await expect(page.locator('li .chip', { hasText: '보관' })).toHaveCount(2);

    // 추가 성공 후에도 선택은 그대로 남아 있어야 곧바로 제거를 이어갈 수 있다.
    await expect(page.getByText('2개 선택됨')).toBeVisible();

    await page.getByPlaceholder('태그 입력 후 Enter').fill('보관');
    await page.getByPlaceholder('태그 입력 후 Enter').press('Enter');
    await page.getByRole('button', { name: '태그 제거' }).click();

    await expect(page.locator('li .chip', { hasText: '보관' })).toHaveCount(0);

    await page.getByRole('button', { name: '선택 해제' }).click();
    await expect(page.getByText('2개 선택됨')).toHaveCount(0);
  });

  test('필터에 안 보이는 선택 행이 있으면 힌트가 표시된다', async ({ page }) => {
    await page.goto('/');

    await rowFor(page, M4A_TITLE).locator('input[type="checkbox"]').check();
    await page.getByPlaceholder('제목 검색').fill('새로운'); // qta 제목만 남긴다

    await expect(page.getByText('1개 선택됨')).toBeVisible();
    await expect(page.getByText(/현재 필터에 없는 1개 포함/)).toBeVisible();

    await page.getByRole('button', { name: '초기화' }).click();
    await expect(page.getByText(/현재 필터에 없는/)).toHaveCount(0);

    await page.getByRole('button', { name: '선택 해제' }).click();
  });

  test('행을 클릭하면 재생기가 뜨고 포맷 버튼 세 개가 보인다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);

    await expect(page.locator('audio')).toBeAttached();
    await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
    await expect(page.getByRole('slider', { name: '재생 위치' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'qta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'mp3', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'wav', exact: true })).toBeVisible();
  });

  test('입력 필드에 포커스가 있으면 재생 단축키가 무시된다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);

    const search = page.getByPlaceholder('제목 검색');
    await search.click();
    await page.keyboard.press('Space');

    // Space가 재생을 토글하지 않고, 대신 평범하게 입력 필드에 공백 한 글자로 들어간다.
    await expect(search).toHaveValue(' ');
    await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
    expect((await audioState(page)).paused).toBe(true);
  });

  test('스페이스로 재생/일시정지, M으로 음소거를 전환한다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);

    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: '일시정지' })).toBeVisible();
    expect((await audioState(page)).paused).toBe(false);

    // 실제로 시간이 흐르는지(진짜 소리가 나는지는 확인할 수 없지만, 재생
    // 위치가 진행되는 건 재생 중이라는 관찰 가능한 대리 지표다).
    await page.waitForTimeout(600);
    expect((await audioState(page)).currentTime).toBeGreaterThan(0.05);

    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
    expect((await audioState(page)).paused).toBe(true);

    await page.keyboard.press('m');
    expect((await audioState(page)).muted).toBe(true);
    await expect(page.getByRole('button', { name: '음소거 해제' })).toBeVisible();

    await page.keyboard.press('m');
    expect((await audioState(page)).muted).toBe(false);
    await expect(page.getByRole('button', { name: '음소거' })).toBeVisible();
  });

  test('방향키로 재생 위치와 볼륨을 조절한다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);

    // +5초: 2.28초짜리 클립이라 재생 끝까지 클램프된다.
    await page.keyboard.press('ArrowRight');
    expect((await audioState(page)).currentTime).toBeGreaterThan(1.9);

    // -10초(Shift): 0으로 클램프된다.
    await page.keyboard.press('Shift+ArrowLeft');
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);

    // +10초(Shift): 다시 끝까지.
    await page.keyboard.press('Shift+ArrowRight');
    expect((await audioState(page)).currentTime).toBeGreaterThan(1.9);

    // -5초: 다시 0으로.
    await page.keyboard.press('ArrowLeft');
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);

    expect((await audioState(page)).volume).toBeCloseTo(1, 2);
    await page.keyboard.press('ArrowDown');
    expect((await audioState(page)).volume).toBeCloseTo(0.95, 2);
    await page.keyboard.press('ArrowDown');
    expect((await audioState(page)).volume).toBeCloseTo(0.9, 2);
    await page.keyboard.press('ArrowUp');
    expect((await audioState(page)).volume).toBeCloseTo(0.95, 2);
  });

  test('파형을 클릭하면 그 위치로 재생 위치가 이동한다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);

    await seekViaWaveform(page, 0.5);

    const mid = QTA_DURATION_SEC / 2;
    const { currentTime } = await audioState(page);
    expect(currentTime).toBeGreaterThan(mid - 0.4);
    expect(currentTime).toBeLessThan(mid + 0.4);
  });

  test('포맷을 전환해도 재생 위치가 유지된다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);
    await seekViaWaveform(page, 0.5);
    const before = (await audioState(page)).currentTime;
    expect(before).toBeGreaterThan(0.5); // 실제로 앞으로 이동했어야 이후 비교가 의미 있다

    await page.getByRole('button', { name: 'wav', exact: true }).click();
    await expect(page.getByRole('button', { name: 'wav', exact: true })).toHaveClass(/preset-filled/);

    await expect
      .poll(async () => (await audioState(page)).currentTime, { timeout: 5_000 })
      .toBeGreaterThan(before - 0.3);
    const after = (await audioState(page)).currentTime;
    expect(after).toBeLessThan(before + 0.3);
  });

  test('B로 북마크를 추가하고, 메모 편집과 삭제가 서버에 반영된다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);
    await expect(page.getByRole('button', { name: '북마크 삭제' })).toHaveCount(0);

    await page.keyboard.press('b');
    await expect(page.getByRole('button', { name: '북마크 삭제' })).toHaveCount(1);

    await page.getByPlaceholder('메모').fill('테스트 메모');
    const notePatch = waitForPatch(page);
    await page.getByPlaceholder('메모').blur();
    await notePatch;
    await expect(page.getByPlaceholder('메모')).toHaveValue('테스트 메모');
    // PATCH가 실패해도 낙관적 갱신 때문에 입력칸은 그대로 보일 수 있으니,
    // 에러 카드가 안 떴는지로 실제 저장 성공 여부를 별도로 확인한다.
    await expect(page.locator('aside.preset-tonal-error')).toHaveCount(0);

    await selectRecording(page, QTA_TITLE); // 새로고침(재탐색)해서 서버에 실제로 남았는지 확인
    await expect(page.getByPlaceholder('메모')).toHaveValue('테스트 메모');

    const deletePatch = waitForPatch(page);
    await page.getByRole('button', { name: '북마크 삭제' }).click();
    await deletePatch;
    await expect(page.getByRole('button', { name: '북마크 삭제' })).toHaveCount(0);

    await selectRecording(page, QTA_TITLE);
    await expect(page.getByRole('button', { name: '북마크 삭제' })).toHaveCount(0);
    await expect(page.getByPlaceholder('메모')).toHaveCount(0);
  });
});
