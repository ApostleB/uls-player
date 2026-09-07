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
  await page.goto('/recordings');
  const waveform = page.waitForResponse(
    (res) => res.url().includes('/api/waveform/') && res.request().method() === 'GET'
  );
  await page.getByRole('button', { name: title, exact: true }).click();
  await waveform;
  // 방금 누른 제목 버튼에 포커스가 남아 있으면, 뒤이은 Space 단축키가
  // 재생/일시정지 토글과 그 버튼의 기본 활성화 동작(브라우저가 Space를
  // 버튼 클릭으로도 해석한다) 둘 다에 걸릴 수 있다. 포커스를 옮겨 순수하게
  // svelte:window의 키보드 핸들러만 타게 한다. 유닛 테스트는 이럴 때
  // getByLabelText('검색어')를 blur 타깃으로 쓰지만, 여기서는 그게 안
  // 맞는다 — 이 헬퍼를 쓰는 테스트 대부분이 바로 다음에 Space·M·화살표
  // 같은 단축키를 누르는데, isTypingTarget(src/lib/player.ts)이 포커스가
  // input·textarea·select·contenteditable에 있으면 그 즉시 무시하도록
  // 되어 있어(Player.svelte의 onKeydown 첫 줄) 검색 입력에 포커스를 두면
  // 단축키 자체가 죽어버린다. 목록 헤더 줄(data-testid="list-header")을
  // 대신 쓴다 — onclick도 없고 포커스도 못 받는 순수 장식용 div라, 클릭해도
  // 아무 부작용 없이 이전 포커스만 날아간다.
  await page.getByTestId('list-header').click();
}

function rowFor(page: Page, title: string) {
  return page
    .locator('ul.space-y-1 > li')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
}

// 기간 필터 경계 테스트가 쓸 "YYYY-MM-DD"만 읽는다. recordedAt은 서버가
// ZDATE(UTC)를 실행 머신의 로컬 타임존으로 변환해 만드는데(scan.ts의
// toLocalIso), 그 타임존을 테스트가 하드코딩해 재계산하면 실행 환경이
// 바뀔 때마다(자정 근처 날짜가 하루씩 밀리는 등) 깨질 수 있다 — 그래서
// 값을 계산하지 않고 화면에 이미 렌더된 걸 그대로 읽는다.
async function recordedDate(page: Page, title: string): Promise<string> {
  const text = await rowFor(page, title).locator('span.text-surface-500.tabular-nums').textContent();
  return (text ?? '').trim().slice(0, 10);
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

// FilterBar의 태그 칩만 짚는다. getByRole('button', {name: tag})는 목록
// 행의 태그 표시 버튼(같은 텍스트를 그대로 노출한다)에도 걸려 strict
// mode에서 여러 개가 잡힐 수 있다 — FilterBar 칩만 class="chip"을 버튼
// 자신이 직접 들고 있다(행 쪽은 안쪽 span에만 chip이 있고 버튼 자체엔
// 없다).
function tagFilterChip(page: Page, tag: string) {
  return page.locator('button.chip', { hasText: tag });
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

  test('메인에서 목록과 가져오기로 갈 수 있다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ULS Player' })).toBeVisible();

    await page.getByRole('link', { name: '녹음 목록' }).click();
    await expect(page).toHaveURL(/\/recordings$/);

    await page.goto('/');
    await page.getByRole('link', { name: '가져오기' }).click();
    await expect(page).toHaveURL(/\/import$/);
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
    await page.goto('/recordings');

    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();

    // 각 녹음이 원본·mp3·wav 셋 다 갖고 있는지: 배지 개수로 확인한다.
    await expect(page.locator('li .badge', { hasText: 'mp3' })).toHaveCount(2);
    await expect(page.locator('li .badge', { hasText: 'wav' })).toHaveCount(2);
    await expect(page.locator('li .badge', { hasText: 'm4a' })).toHaveCount(1);
    await expect(page.locator('li .badge', { hasText: 'qta' })).toHaveCount(1);
  });

  // 이전 태스크가 /import의 "목록으로" 링크를 지운 건 메뉴바가 그 자리를
  // 대신하기 때문이었다 — 그사이 /import는 브라우저 뒤로가기 말고는 나갈
  // 방법이 없었다. 이 테스트가 그 간극이 실제로 메워졌는지를 확인하는
  // 유일한 지점이다: 메뉴바 리스트 링크를 실제로 클릭해서 /recordings로
  // 이동하고, 거기 이미 변환된 녹음이 실제로 보이는지까지 본다.
  test('가져오기 화면에서 메뉴바의 리스트를 누르면 목록으로 이동한다', async ({ page }) => {
    await page.goto('/import');

    await page.getByRole('link', { name: '리스트' }).click();

    await expect(page).toHaveURL(/\/recordings$/);
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
  });

  test('검색·태그 필터로 좁혀지고, 없는 조건이면 안내 문구가 뜬다', async ({ page }) => {
    await page.goto('/recordings');

    await page.getByPlaceholder('검색어').fill('당신');
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);
    await page.getByPlaceholder('검색어').fill('');
    // 이전엔 여기서 검색 내비게이션이 끝나길 명시적으로 기다려야 했다 —
    // 한때는 메뉴바의 검색창과 목록의 태그 클릭이 각자 다른 곳에서
    // URL을 바꿨고, 둘이 겹치면 한쪽 변경이 지워지는 경합이 있었다.
    // 지금은 검색창도 목록 화면 자신의 것이라 필터를 바꾸는 것도 실제
    // goto를 부르는 것도 이 화면의 필터→URL 이펙트 하나뿐이고, writer가
    // 하나뿐이니 그런 경합 자체가 성립하지 않는다 — 이 기다림은 더 이상
    // 정확성을 위해 필요하지 않고, 그저 다음 단계로 넘어가기 전에 검색이
    // 실제로 끝났다는 걸 보여주는 용도로만 남긴다.
    await expect(page).toHaveURL(/\/recordings$/);

    // '데모' 태그는 qta 녹음에만 붙었다.
    const demoFilterChip = tagFilterChip(page, '데모');
    await demoFilterChip.click();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toHaveCount(0);
    await demoFilterChip.click(); // 태그 필터 해제

    await page.getByPlaceholder('검색어').fill('존재하지않는제목');
    await expect(page.getByText('조건에 맞는 녹음이 없습니다')).toBeVisible();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: '초기화' }).click();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
  });

  // Fix round 1: 목록에서 태그를 고른 뒤 메뉴바로 검색하면 그 태그가 조용히
  // 사라지는 회귀를 재현·재발 방지한다. 원인(당시): 태그 칩 클릭은
  // +page.svelte의 필터→URL 이펙트가 그때는 얕은 라우팅(replaceState)으로만
  // 주소창에 반영했는데, @sveltejs/kit@2.70.3의 replaceState는 SvelteKit의
  // page.url을 갱신하지 않는다(client.js 확인) — 그래서 메뉴바 검색이 기존
  // 쿼리를 보존하려고 page.url.searchParams를 읽으면 이미 화면 밖으로
  // 밀려난(page.url에 한 번도 반영된 적 없는) 태그를 통째로 놓쳤다. Round 2
  // 에서 그 이펙트 자체를 goto(진짜 내비게이션)로 바꿔 page.url이 항상
  // 최신이 되도록 뿌리에서 고쳤다(아래 "초기화" 테스트 앞 주석 참고) —
  // 지금은 이 값 자체가 어긋날 일이 없다. 그래도 이 시나리오는 컴포넌트
  // 테스트로는 못 잡는다 — 그쪽은 $app/state를 통째로 모킹해 실제 라우터의
  // 비동기 타이밍(goto가 아직 안 끝난 틈) 자체가 존재하지 않는다. 실제
  // 브라우저·실제 라우터가 있어야 재현되므로 여기 E2E에 둔다.
  test('목록에서 태그를 고른 뒤 검색해도 태그 필터가 유지된다', async ({ page }) => {
    await page.goto('/recordings');

    // '데모' 태그는 qta 녹음에만 붙었다(위 가져오기 테스트에서 붙인 뒤로
    // 이 파일의 어떤 테스트도 지우지 않는다).
    const demoFilterChip = tagFilterChip(page, '데모');
    await demoFilterChip.click();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toHaveCount(0);

    // 태그뿐 아니라 기간 필터도 같은 필터→URL 이펙트를 타므로 같이
    // 골라둔다 — 브리프 §6이 "태그·기간 파라미터를 보존"이라고 두 가지를
    // 함께 말하고 있어, 태그만으로는 기간까지 안전한지 증명하지 못한다.
    const qtaDate = await recordedDate(page, QTA_TITLE);
    await page.locator('input[type="date"]').first().fill(qtaDate);

    // 태그·기간을 고른 채로 검색한다.
    const search = page.getByPlaceholder('검색어');
    await search.fill(QTA_TITLE);
    await search.press('Enter');

    // 회귀가 재발하면 여기서 tags·from이 URL에서 사라진다.
    await expect(page).toHaveURL(/[?&]tags=/);
    await expect(page).toHaveURL(/[?&]from=/);
    await expect(page).toHaveURL(/[?&]q=/);

    // 검색어와 제목이 우연히 겹쳐서(qta 제목으로 검색했으니) m4a가 안
    // 보이는 것만으로는 태그가 실제로 살아있다는 증거가 안 된다 — 검색어를
    // 지워 태그 필터만 남긴 뒤에도 m4a가 여전히 안 보여야 태그가 진짜로
    // 걸려 있다는 증거가 된다.
    await search.fill('');
    await search.press('Enter');
    await expect(page).toHaveURL(/[?&]tags=/);
    await expect(page).toHaveURL(/[?&]from=/);
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: '초기화' }).click();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
  });

  // Fix round 2: 목록에서 "초기화"를 누르면 필터는 모두 비워지는데
  // 메뉴바 검색창에는 방금 지운 검색어가 그대로 남아 있던 회귀를
  // 재현·재발 방지한다. 원인은 round 1과 뿌리가 같다 — q가 새로 채워질
  // 때(메뉴바 검색)는 항상 goto(진짜 내비게이션)를 거쳐 page.url이
  // 안전하게 갱신되지만, 초기화 버튼은 filter 전체를 로컬로 재할당하고
  // 그 결과를 (round 1까지는) replaceState로만 주소창에 반영했다 —
  // replaceState는 page.url을 절대 안 바꾸므로, 메뉴바의 q prop
  // (page.url.searchParams.get('q'))이 옛 검색어를 계속 돌려줬다. 이번
  // 라운드에서 그 replaceState 자체를 goto로 바꿔 뿌리에서 고쳤다.
  test('목록에서 초기화하면 검색창도 함께 비워진다', async ({ page }) => {
    await page.goto('/recordings');

    const search = page.getByPlaceholder('검색어');
    await search.fill(QTA_TITLE);
    await search.press('Enter');
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(search).toHaveValue(QTA_TITLE);

    await page.getByRole('button', { name: '초기화' }).click();

    // 회귀가 재발하면 목록은 269건 전부로 돌아가도 이 입력값만 옛
    // 검색어에 머문다.
    await expect(search).toHaveValue('');
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
  });

  // 이 행은 목록의 두 번째(마지막) 항목이라, 더블클릭의 첫 클릭이
  // selectedId를 세팅해 하단 고정 Player를 띄우는 순간 행이 그 밑에
  // 깔린다(실측: 클릭 전 버튼 rect top=527/bottom=547 — 뷰포트
  // 720px 안에 이미 다 들어와 있어 Playwright의 자동 스크롤은 아무
  // 일도 하지 않는다. 클릭 후 Player rect는 top=527/bottom=720이라
  // 버튼과 정확히 겹치고, 그 중심 좌표에서 elementFromPoint는 Player
  // 오버레이를 반환한다 — dblclick의 두 클릭 다 같은 좌표에 꽂히므로
  // 두 번째 클릭이 Player에 막혀 브라우저가 진짜 dblclick 이벤트를
  // 버튼에 못 보낸다. scrollIntoViewIfNeeded()는 "이미 뷰포트 안"이라
  // 여전히 no-op이라 못 고친다 — 대신 네이티브 scrollIntoView로
  // 강제로 뷰포트 중앙까지 끌어올려 Player가 뜬 뒤에도 안전한
  // 위치를 확보한다). 단언은 그대로 두고 상호작용 대상만 옮긴다.
  //
  // 이건 테스트 전용 편법이 아니라 실사용자도 그대로 겪는 앱 버그다 — 두 번의
  // 물리 클릭도 같은 좌표를 다시 겨냥하지 않고, Player 마운트는 사람의
  // 더블클릭 간격보다 먼저 끝난다. scrollIntoView에는 이걸 대신할 사용자
  // 조작이 없어 테스트가 이 경로 자체를 피해가는 것뿐이다 — 잊힌 편법이
  // 아니라 추적 중인 결함이다. 자세한 내용과 후보 해결 방향은
  // docs/known-issues.md 참고.
  test('설명 인라인 편집이 blur로 저장되고 새로고침 후에도 남는다', async ({ page }) => {
    await page.goto('/recordings');
    const row = rowFor(page, QTA_TITLE);
    const descriptionButton = row.getByRole('button', { name: '설명 없음' });

    await expect(descriptionButton).toBeVisible();
    await descriptionButton.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await descriptionButton.dblclick();
    await row.getByLabel('설명 수정').fill('e2e 설명 수정');
    await row.getByLabel('설명 수정').blur();

    await expect(row.getByRole('button', { name: 'e2e 설명 수정' })).toBeVisible();

    await page.reload();
    await expect(rowFor(page, QTA_TITLE).getByRole('button', { name: 'e2e 설명 수정' })).toBeVisible();
  });

  test('태그 인라인 편집이 완료 버튼으로 저장되고 새로고침 후에도 남는다', async ({ page }) => {
    await page.goto('/recordings');
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
    await page.goto('/recordings');

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
    await page.goto('/recordings');

    await rowFor(page, M4A_TITLE).locator('input[type="checkbox"]').check();
    await page.getByPlaceholder('검색어').fill('새로운'); // qta 제목만 남긴다

    await expect(page.getByText('1개 선택됨')).toBeVisible();
    await expect(page.getByText(/현재 필터에 없는 1개 포함/)).toBeVisible();

    await page.getByRole('button', { name: '초기화' }).click();
    await expect(page.getByText(/현재 필터에 없는/)).toHaveCount(0);

    await page.getByRole('button', { name: '선택 해제' }).click();
  });

  test('태그 모드(모두 포함/하나라도)가 실제로 다른 결과를 낸다', async ({ page }) => {
    await page.goto('/recordings');

    // 이 시점에 qta는 '데모'만, m4a는 '중요'만 갖고 있다(위 "태그
    // 인라인 편집"·"일괄 태그 추가·제거" 테스트가 이 파일 안에서
    // serial로 실행되며 남긴 상태다 — serial이 아니었다면 이 순서를
    // 가정할 수 없다). 두 녹음이 겹치는 태그가 하나도 없으므로, 이
    // 둘을 동시에 선택하면
    // "모두 포함"(AND)은 아무도 못 만족해 0건이 되고 "하나라도"(OR)는
    // 각자 자기 태그로 만족해 2건이 된다 — 두 모드가 진짜 다른 결과를
    // 낸다는 걸 증명하려면 이렇게 "겹치지 않는 태그 두 개를 함께 선택"
    // 해야 한다. 두 모드가 같은 결과를 내는 조합으로는 아무것도
    // 증명하지 못한다.
    await tagFilterChip(page, '데모').click();
    await tagFilterChip(page, '중요').click();

    // 기본값 '모두 포함'(and): 어느 쪽도 두 태그를 동시에 갖고 있지
    // 않으므로 0건이다.
    await expect(page.getByText('조건에 맞는 녹음이 없습니다')).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toHaveCount(0);

    // '하나라도'(or)로 바꾸면 각자 자기 태그 하나씩으로 조건을 만족해
    // 둘 다 다시 보인다 — 같은 선택된 태그·같은 녹음인데 모드만
    // 바뀌었을 뿐이라, 이 차이는 AND/OR 로직 자체가 만든 것이다.
    await page.getByRole('button', { name: '하나라도' }).click();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();

    // '모두 포함'으로 되돌리면 다시 0건이어야 한다(모드 토글이 양방향으로
    // 동작하는지까지 확인).
    await page.getByRole('button', { name: '모두 포함' }).click();
    await expect(page.getByText('조건에 맞는 녹음이 없습니다')).toBeVisible();

    await page.getByRole('button', { name: '초기화' }).click();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
  });

  test('기간 필터의 시작일·종료일 경계가 포함된다(inclusive)', async ({ page }) => {
    await page.goto('/recordings');

    const m4aDate = await recordedDate(page, M4A_TITLE); // 더 늦은 날짜
    const qtaDate = await recordedDate(page, QTA_TITLE); // 더 이른 날짜
    expect(m4aDate).not.toBe(qtaDate); // 서로 다른 날짜여야 경계 테스트가 의미 있다

    const dateInputs = page.locator('input[type="date"]');
    const fromInput = dateInputs.nth(0);
    const toInput = dateInputs.nth(1);

    // from 경계: from을 m4a "그 날짜"로 정확히 맞춘다. 배타적이었다면
    // m4a 자신도 걸러졌을 것이다 — m4a가 여전히 보인다는 게 곧 from이
    // 포함(inclusive)이라는 증거다. qta는 그보다 이른 날짜라 항상
    // 제외된다(대조군 — 필터가 실제로 뭔가는 하고 있다는 증거).
    await fromInput.fill(m4aDate);
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);
    await fromInput.fill('');

    // to 경계: to를 qta "그 날짜"로 정확히 맞춘다. 같은 논리로, qta가
    // 여전히 보인다는 게 to도 포함이라는 증거다. m4a는 그보다 늦은
    // 날짜라 제외된다.
    await toInput.fill(qtaDate);
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toHaveCount(0);
    await toInput.fill('');

    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();
  });

  test('행을 클릭하면 재생기가 뜨고 포맷 버튼 세 개가 보인다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);

    await expect(page.locator('audio')).toBeAttached();
    await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
    await expect(page.getByRole('slider', { name: '재생 위치' })).toBeVisible();

    // exact: true — FilterBar의 확장자 칩(Task 4)이 붙은 뒤로 접두사가 같은
    // "qta 1" 같은 칩도 이 role/name에 걸린다. 칩과 이 포맷 전환 버튼을
    // 구분하려면 정확히 일치해야 한다(브리프의 칩 셀렉터 주의사항과 같은 이유).
    await expect(page.getByRole('button', { name: 'qta', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'mp3', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'wav', exact: true })).toBeVisible();
  });

  test('입력 필드에 포커스가 있으면 재생 단축키가 무시된다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);

    const search = page.getByPlaceholder('검색어');
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
    // 위치가 진행되는 건 재생 중이라는 관찰 가능한 대리 지표다). 고정
    // sleep 대신 값 자체를 폴링한다 — 이 스위트의 다른 곳들과 같은 원칙
    // (관찰 가능한 상태를 기다리지, 시간을 기다리지 않는다).
    await expect
      .poll(async () => (await audioState(page)).currentTime, { timeout: 3_000 })
      .toBeGreaterThan(0.05);

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

  // Fix Round 1: Waveform 캔버스에 role=slider·tabindex가 있고 Player.svelte의
  // svelte:window keydown이 이미 ArrowLeft/ArrowRight를 처리하고 있었다.
  // 캔버스 자신도 화살표를 처리하게 만들면(첫 커밋이 그랬다) keydown이
  // 캔버스 → window로 버블링되면서 두 핸들러가 같은 키 입력 한 번에
  // 모두 반응해, 한 번 눌러도 두 번 움직이는 사고가 난다.
  //
  // 이 픽스처(QTA 2.28초)는 5초 스텝 하나만으로 이미 끝까지 clamp되므로,
  // "몇 초 움직였나"로는 단일 반응(5초 → clamp)과 이중 반응(5초 →
  // clamp → 다시 5초 → 여전히 같은 clamp)을 구별할 수 없다 — 두 경우
  // 모두 도착 지점이 똑같다. 그래서 도착 값이 아니라 audio.currentTime
  // setter가 몇 번 호출됐는지를 직접 센다: 핸들러가 하나만 반응하면
  // 정확히 1번, 이중으로 반응하면 2번 호출된다.
  test('파형(슬라이더)에 포커스가 있을 때 화살표를 누르면 정확히 한 핸들러만 반응한다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);

    await page.locator('audio').evaluate((el) => {
      const audio = el as HTMLAudioElement & { __setCount: number };
      audio.__setCount = 0;
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
      Object.defineProperty(audio, 'currentTime', {
        configurable: true,
        get() {
          return desc.get!.call(audio);
        },
        set(v: number) {
          audio.__setCount += 1;
          desc.set!.call(audio, v);
        }
      });
    });

    await page.getByRole('slider', { name: '재생 위치' }).focus();
    await page.keyboard.press('ArrowRight');

    const setCount = await page
      .locator('audio')
      .evaluate((el) => (el as HTMLAudioElement & { __setCount: number }).__setCount);

    expect(setCount).toBe(1);
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

  // Task 4 Fix Round 1: 컴포넌트 테스트는 합성 PointerEvent를 직접
  // dispatchEvent하는데, 합성 이벤트는 UA가 뒤이어 click을 만들어주지
  // 않는다 — 그래서 "Escape로 드래그를 취소하면 점프하지 않는다"는
  // 컴포넌트 테스트가 통과해도, 실제 브라우저에서는 놓은 지점이 캔버스
  // 위였다면 pointerup 뒤에 진짜 click이 이어져 결국 점프해버리는
  // 버그를 잡아내지 못했다. 아래 두 테스트는 page.mouse.*로 실제
  // 신뢰된(trusted) 입력을 보내 그 간극에서만 드러나는 버그를 겨냥한다.
  test('드래그 중 Escape를 누르면 실제 클릭까지 막혀 점프하지 않는다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('waveform canvas가 보이지 않습니다');
    const y = box.y + box.height / 2;

    // 0.2 지점을 눌러 0.8 지점까지 실제로 끈다 — 임계값(3px)을 한참
    // 넘는 이동이라 dragging이 켜진다.
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, y, { steps: 5 });

    // 캔버스가 실제로 포커스를 받았어야 이 keydown이 캔버스의
    // onkeydown(Escape 처리)에 닿는다 — 실제 마우스 다운은 tabindex가
    // 있는 캔버스에 포커스를 준다.
    await expect(canvas).toBeFocused();
    await page.keyboard.press('Escape');

    // 놓는 지점은 여전히 캔버스 위(0.8 지점)다 — 실제 브라우저라면
    // pointerdown·pointerup이 같은 엘리먼트에서 일어났으니 click이
    // 뒤따른다. Escape가 그 click까지 막아야 한다.
    await page.mouse.up();

    // click을 실제로 만들어내는 동작이므로, 이벤트가 처리될 시간을
    // 준다(고정 sleep이 아니라 재생 위치가 "그대로"인지 재시도로
    // 확인한다 — 바뀌었다면 그 즉시 실패로 드러난다).
    await page.waitForTimeout(200);
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);
  });

  test('캔버스 밖에서 드래그를 놓아도, 뒤이은 정상 클릭은 계속 먹힌다', async ({ page }) => {
    // 드래그로 점프한 직후 삼키는 click 플래그가, click이 한 번도 오지
    // 않는 캔버스-밖-놓기 뒤에 눌어붙어 다음 클릭까지 먹어버리지
    // 않는지 확인한다.
    await selectRecording(page, QTA_TITLE);
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('waveform canvas가 보이지 않습니다');
    const y = box.y + box.height / 2;

    // 0.2 지점에서 눌러 캔버스 오른쪽 바깥까지 끌고 나가 놓는다 —
    // 오른쪽 끝(전체 길이)으로 고정돼야 한다. 이 놓기는 캔버스 밖이라
    // 실제 브라우저도 click을 만들지 않는다.
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 300, y, { steps: 5 });
    await page.mouse.up();

    await expect
      .poll(async () => (await audioState(page)).currentTime, { timeout: 5_000 })
      .toBeGreaterThan(QTA_DURATION_SEC - 0.3);

    // 완전히 새 제스처로 0.3 지점을 평범하게 클릭한다 — click이 한 번도
    // 없었던 앞의 놓기 때문에 삼킴 플래그가 여전히 true라면, 이 클릭이
    // 조용히 먹혀 재생 위치가 그대로(전체 길이) 남는다.
    await page.mouse.click(box.x + box.width * 0.3, y);

    const target = QTA_DURATION_SEC * 0.3;
    await expect
      .poll(async () => (await audioState(page)).currentTime, { timeout: 5_000 })
      .toBeLessThan(target + 0.4);
    expect((await audioState(page)).currentTime).toBeGreaterThan(target - 0.4);
  });

  // Final Review Fix: 오른쪽 버튼은 애초에 드래그를 시작해선 안 된다.
  // 이 테스트는 오른쪽 버튼으로 누르고 끌고 놓는 동작 자체가 아예
  // seek를 만들지 않는지만 본다 — swallowNextClick 자정 로직(항목 2)과
  // 겹치지 않는, onPointerDown의 버튼 가드(항목 1) 하나만 겨냥한
  // 테스트다.
  test('오른쪽 버튼으로 누르고 끌고 놓아도 드래그가 시작되지 않는다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('waveform canvas가 보이지 않습니다');
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width * 0.8, y, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    // 컨텍스트 메뉴가 열려 있을 수 있으니 닫아 다음 테스트에 영향이
    // 남지 않게 한다.
    await page.keyboard.press('Escape');

    await page.waitForTimeout(200);
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);
  });

  // Final Review Fix: 리뷰가 지적한 실제 시나리오를 그대로 재현한다 —
  // 오른쪽 클릭으로 컨텍스트 메뉴를 띄운 뒤 Escape로 닫고, 그 다음
  // 평범한 왼쪽 클릭이 여전히 먹히는지 본다. 항목 1(버튼 가드)만으로도
  // 이 시나리오는 막히고, 항목 2(자정)도 독립적으로 같은 경로를
  // 막아준다 — 그래서 이 테스트 하나로 둘을 따로 구분해내지는 못한다
  // (리포트의 "Final Review Fix" 절 참고). 그래도 실제로 보고된 버그가
  // 다시 살아나지 않는지 지키는 회귀 테스트로서는 유효하다.
  test('오른쪽 클릭으로 컨텍스트 메뉴를 띄우고 Escape로 닫아도, 다음 왼쪽 클릭은 여전히 먹힌다', async ({ page }) => {
    await selectRecording(page, QTA_TITLE);
    expect((await audioState(page)).currentTime).toBeLessThan(0.1);

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('waveform canvas가 보이지 않습니다');
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width * 0.5, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    // 실제 컨텍스트 메뉴를 Escape로 닫는다 — 리뷰가 지적한 바로 그 동작.
    await page.keyboard.press('Escape');

    await page.mouse.click(box.x + box.width * 0.4, y);

    const target = QTA_DURATION_SEC * 0.4;
    await expect
      .poll(async () => (await audioState(page)).currentTime, { timeout: 5_000 })
      .toBeLessThan(target + 0.4);
    expect((await audioState(page)).currentTime).toBeGreaterThan(target - 0.4);
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

  test('검색 범위를 태그로 바꾸면 제목이 같아도 걸리지 않는다', async ({ page }) => {
    await page.goto('/recordings');

    const search = page.getByPlaceholder('검색어');
    await search.fill(QTA_TITLE);
    await search.press('Enter');
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();

    // 범위를 태그로 좁히면 제목에만 있는 낱말은 더 이상 걸리지 않는다.
    await page.getByLabel('검색 범위').selectOption('tags');
    await expect(page).toHaveURL(/[?&]scope=tags/);
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);
  });

  test('확장자 칩으로 원본 형식을 좁힌다', async ({ page }) => {
    await page.goto('/recordings');

    // 픽스처의 두 녹음은 원본 확장자가 서로 다르다.
    await page.getByRole('button', { name: /^m4a/ }).click();
    await expect(page).toHaveURL(/[?&]ext=m4a/);
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);
  });

  test('목록 상단에 앱 이름이 중복으로 나오지 않는다', async ({ page }) => {
    await page.goto('/recordings');
    // 메뉴바의 로고 링크 하나만 남아야 한다.
    await expect(page.getByText('ULS Player', { exact: true })).toHaveCount(1);
  });
});
