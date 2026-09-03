import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * 브라우저 업로드 경로의 E2E 커버리지. Task 19에서 실제로 Critical
 * data-loss 버그가 났던 지점이 정확히 여기다: 한 번 업로드로 여러 파일을
 * 스테이징한 뒤 그중 일부만 골라 먼저 저장하면, 개선 전 코드는
 * scheduleStagingCleanup이 스테이징 폴더 "전체"를 지웠다 — 아직 저장
 * 안 한 나머지 파일까지 함께 사라져서 두 번째 저장이 재스캔할 대상
 * 자체가 없어졌다. upload.test.ts가 이걸 단위 테스트로 이미 지키고
 * 있지만, 이 파일이 생기기 전에는 업로드 경로 자체를 실제 브라우저로
 * 끝까지(가져오기 화면 열기 → 파일 선택 → 부분 저장 → 변환 완료 → 남은
 * 파일로 재확인 → 두 번째 저장) 밟아보는 E2E가 하나도 없었다.
 *
 * DATA_DIR·MEDIA_DIR은 playwright.config.ts가 임시 디렉터리로 웹서버에
 * 넘긴다 — 개발자의 실제 data/·media/는 건드리지 않는다. 이 스펙만의
 * 로컬 소스 폴더(localSrcDir)는 Playwright 테스트 프로세스가 setInputFiles로
 * 업로드에 쓸 원본을 담아두는 곳이고, saveUploads가 만드는 서버 쪽
 * 스테이징 폴더(폼의 hidden folder 값으로 읽어낸다)와는 별개다.
 *
 * 변환 큐는 프로세스 싱글턴이라 이 파일 하나만 도는 게 아니라 같은
 * webServer를 공유하는 다른 스펙 파일(import-flow.spec.ts)의 잡까지
 * 누적해서 안고 있다(playwright.config.ts가 workers:1로 파일 간에도
 * 순차 실행을 보장하므로 "동시에 섞이는" 문제는 없지만, "이전 파일이
 * 이미 채워놓은 값"은 그대로 남는다). 그래서 진행 패널의 "완료 N / N"을
 * 고정된 절대값으로 기대하면 안 되고, 이 테스트가 시작하는 시점의
 * 기준값(baseline) 대비 상대적으로 몇 개가 늘었는지로 판정한다.
 *
 * 두 번째 저장의 완료 판정은 진행 패널(SSE)이 아니라 스테이징 폴더가
 * 실제로 지워지는지로 한다 — scheduleStagingCleanup은 SSE와 무관하게
 * 큐를 서버에서 직접 구독하므로, 이 신호는 "두 번째 저장이 실제로 끝까지
 * 처리됐다"를 SSE 재연결 타이밍과 완전히 독립적으로 증명한다(이 스위트를
 * 여러 스펙 파일과 함께 오래 돌리는 실행 환경에서는 같은 브라우저
 * 프로세스가 누적해서 열어 둔 EventSource 연결이 많아질수록 새 SSE
 * 재연결 자체가 브라우저의 출처당 연결 한도에 걸려 더뎌질 수 있다 — 이건
 * 애플리케이션 로직과 무관한 테스트 환경의 사정이라, 서버가 실제로 한
 * 일을 확인하는 이 신호가 더 안정적이다). 그 뒤 페이지를 새로 고쳐(=새
 * 마운트, 항상 안정적으로 성공하는 연결 방식) 진행 패널도 최종 상태를
 * 정확히 보여주는지 한 번 더 확인한다.
 */

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');

let localSrcDir: string;
const NAMES = ['upload-a.qta', 'upload-b.qta', 'upload-c.qta'];

/** rows 테이블에서 제목(title) 입력값으로 행을 찾는다. 세 파일 모두
 * spatial.qta의 바이트 사본이라 파일 자체에 박힌 메타 title(예:
 * "새로운 녹음 2" — import-flow.spec.ts의 QTA_TITLE 참고)이 파일명보다
 * 우선해서(scan.ts: apple?.title || p.title || base.title) 채워진다 —
 * 그래서 처음 세 행의 제목은 서로 구분되지 않는다. 아래
 * tagRowsWithUniqueTitles가 각 행에 고유한 제목을 직접 입력해두면, 그
 * 뒤로는 이 헬퍼로 안정적으로 특정 행을 다시 찾을 수 있다(제목 입력은
 * 순전히 표시용 필드라 sourceName이나 저장 대상에는 영향을 주지 않는다). */
async function rowByTitle(page: Page, title: string) {
  const rows = page.locator('tbody tr');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const value = await row.locator('input.input').first().inputValue();
    if (value === title) return row;
  }
  throw new Error(`제목이 "${title}"인 행을 찾지 못했습니다`);
}

async function tagRowsWithUniqueTitles(page: Page, count: number): Promise<void> {
  const rows = page.locator('tbody tr');
  for (let i = 0; i < count; i++) {
    await rows.nth(i).locator('input.input').first().fill(`row-${i}`);
  }
}

/** 진행 패널(`변환 진행 — 완료 N / M`)에서 현재 done/total을 읽는다.
 * 패널 자체가 아직 없으면(잡이 하나도 없으면) {done:0, total:0}이다. */
async function readProgress(page: Page): Promise<{ done: number; total: number }> {
  const heading = page.locator('h2.h4');
  if ((await heading.count()) === 0) return { done: 0, total: 0 };
  const text = (await heading.first().textContent()) ?? '';
  const m = text.match(/완료 (\d+) \/ (\d+)/);
  return m ? { done: Number(m[1]), total: Number(m[2]) } : { done: 0, total: 0 };
}

/** 두 번 연속 같은 값이 나올 때까지 짧게 폴링해 "SSE 첫 프레임이 도착해
 * 안정된" 시점의 값을 읽는다. */
async function stableProgress(page: Page): Promise<{ done: number; total: number }> {
  let prev = { done: -1, total: -1 };
  let current = await readProgress(page);
  const deadline = Date.now() + 3000;
  while ((current.done !== prev.done || current.total !== prev.total) && Date.now() < deadline) {
    prev = current;
    await new Promise((r) => setTimeout(r, 50));
    current = await readProgress(page);
  }
  return current;
}

/** total이 정확히 expectedTotal에 도달하고, 그 시점에 실패 없이(=done도
 * 똑같이 expectedTotal) 끝났는지까지 함께 확인한다. */
async function waitForBatchDone(page: Page, expectedTotal: number, timeout = 60_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const { done, total } = await readProgress(page);
        return total === expectedTotal ? done : -1;
      },
      { timeout }
    )
    .toBe(expectedTotal);
}

test.describe('업로드 경로 — 부분 저장 뒤에도 남은 파일이 살아남고 두 번째 저장이 성공한다', () => {
  test.beforeAll(async () => {
    localSrcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-e2e-upload-src-'));
    for (const name of NAMES) {
      await fs.copyFile(SPATIAL, path.join(localSrcDir, name));
    }
  });

  test.afterAll(async () => {
    await fs.rm(localSrcDir, { recursive: true, force: true });
  });

  test('세 파일을 올리고 두 개만 저장한 뒤, 남은 한 개로 두 번째 저장을 성공시킨다', async ({ page }) => {
    await page.goto('/import');
    // Must Fix 3: 마운트되자마자 SSE가 열려 큐의 현재 스냅샷을 그대로
    // 보여준다 — 이 baseline도 사실 그 동작 자체를 이용해서 잰다.
    const baseline = await stableProgress(page);

    await page.setInputFiles(
      'input[type="file"]',
      NAMES.map((n) => path.join(localSrcDir, n))
    );

    await expect(page.locator('tbody tr')).toHaveCount(3);

    // 서버가 saveUploads로 실제 만든 스테이징 폴더 경로 — enqueue가
    // 재스캔할 때 쓰는 값과 같다(+page.svelte의 hidden input). 스캔 폼의
    // 눈에 보이는 folder 입력창과 이름이 같으므로 hidden 쪽으로 좁힌다.
    const stagingFolder = await page.locator('input[type="hidden"][name="folder"]').inputValue();
    expect(path.dirname(stagingFolder)).toBe(os.tmpdir());

    const originalNames = (await fs.readdir(stagingFolder)).sort();
    expect(originalNames).toEqual(NAMES);

    await tagRowsWithUniqueTitles(page, 3);

    // 세 개 중 row-2만 이번 저장에서 뺀다 — 나머지 둘만 부분 배치로
    // 먼저 저장하는 흐름을 재현한다. 어느 물리 파일이 row-2에 해당하는지는
    // (readdir 순서가 보장되지 않으므로) 알 수 없고, 이 테스트의 목적상
    // 알 필요도 없다 — "정확히 하나만 남는다"만 확인하면 충분하다.
    const rowHeldBack = await rowByTitle(page, 'row-2');
    await rowHeldBack.locator('input[type="checkbox"]').uncheck();

    await page.getByRole('button', { name: /2개 저장 및 변환/ }).click();
    await waitForBatchDone(page, baseline.total + 2);

    // 실제로 Critical 버그가 있었던 지점: 저장 안 한 파일이 물리적으로
    // 아직 디스크에 있어야 한다(폴더 전체가 삭제되지 않았어야 한다) —
    // cleanupJobFile은 done이 된 잡의 파일만 지우고 폴더를 다시 읽어보는
    // 흐름이라 완전히 동기적이지 않다(fire-and-forget), 그래서 안정적으로
    // 확인될 때까지 폴링한다.
    let remaining: string[] = [];
    await expect
      .poll(
        async () => {
          remaining = await fs.readdir(stagingFolder).catch(() => []);
          return remaining.length;
        },
        { timeout: 10_000 }
      )
      .toBe(1);
    expect(originalNames).toContain(remaining[0]);

    // 화면에도 row-2 행이 그대로 남아 있어야 한다 — enqueue 성공 응답은
    // items를 안 실어 보내므로 rows가 갱신되지 않는다는 게 +page.svelte
    // 주석의 전제다.
    await expect(rowByTitle(page, 'row-2')).resolves.toBeTruthy();

    // 두 번째 저장: 이미 저장한 두 행은 해제하고 row-2만 골라 다시
    // 제출한다. 개선 전 버그였다면 폴더 자체가 사라져 있어 이 재스캔이
    // "폴더를 다시 읽을 수 없습니다"로 실패했을 것이다.
    await page.getByRole('button', { name: '전체 해제' }).click();
    const rowHeldBack2 = await rowByTitle(page, 'row-2');
    await rowHeldBack2.locator('input[type="checkbox"]').check();

    await page.getByRole('button', { name: /1개 저장 및 변환/ }).click();

    // "두 번째 저장이 성공한다"의 1차 증거: 마지막 파일까지 처리되면
    // scheduleStagingCleanup이 스테이징 폴더 자체를 지운다. 이건
    // 서버에서 큐를 직접 구독해 일어나는 일이라(위 파일 주석 참고) 이
    // 페이지의 SSE 연결 상태와 무관하게 성립한다.
    await expect
      .poll(
        async () =>
          fs.access(stagingFolder).then(
            () => true,
            () => false
          ),
        { timeout: 60_000 }
      )
      .toBe(false);

    // 2차 증거: 목록 화면(SSE를 전혀 쓰지 않는 일반 load)에 row-2가 실제
    // 녹음으로 등록돼 보인다 — 제목을 "row-2"로 직접 바꿔뒀으므로
    // (itemsPayload가 이 title을 그대로 저장한다) 그 이름으로 찾는다.
    await page.goto('/recordings');
    await expect(page.getByRole('button', { name: 'row-2', exact: true })).toBeVisible();
  });
});
