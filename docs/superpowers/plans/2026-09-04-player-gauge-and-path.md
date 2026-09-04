# 재생기 드래그 게이지와 저장 경로 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파형 위에서 커서 위치의 시각을 미리 보고 놓는 지점으로 점프하게 하고, 지금 재생하는 파일이 디스크 어디에 있는지 보여준다.

**Architecture:** 경로 규칙을 서버·클라이언트가 함께 쓰는 순수 함수 하나로 모아 "보여주는 경로 = 여는 경로"를 구조적으로 보장한다. 파형에는 포인터 캡처로 캔버스 밖까지 따라가는 드래그를 붙이되, 진행률 채움은 놓기 전까지 움직이지 않아 스크러빙이 아님을 눈으로도 드러낸다.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, Skeleton v5, vitest(browser mode) + vitest-browser-svelte, Playwright

## Global Constraints

- Svelte 5 룬만 쓴다: `$state`, `$derived`, `$effect`, `$props`, `$bindable`. Svelte 4 스토어·`export let` 금지
- 주석은 무엇이 아니라 **왜**를 적는다. 한국어로, 주변 문체에 맞춘다. 코드에 대해 사실이 아닌 주석은 결함이다
- 모든 테스트는 그것이 지키는 동작이 깨지면 실패해야 한다. 뮤테이션으로 증명하고 실제 출력을 보고한다
- 테스트에 고정 `setTimeout`/sleep 대기를 쓰지 않는다. 관찰 가능한 조건을 기다린다
- **드래그 중 `onseek`를 호출하지 않는다.** 놓을 때 한 번만 호출한다(스크러빙 없음)
- **드래그 중 진행률 채움(`progress`)은 움직이지 않는다.** 움직이는 것은 재생헤드 선과 말풍선뿐이다
- 경로 규칙은 `src/lib/media.ts` 한 곳에만 존재한다. 서버·클라이언트가 같은 함수를 부른다
- 기존 Waveform 테스트 3개(마커 클릭, `durationSec` 0일 때 마커 클릭 무시, 캔버스 클릭 점프)는 **검증 내용을 바꾸지 않고** 통과해야 한다
- 배치를 재는 테스트는 `app.css`를 직접 import하는 별도 파일에 둔다 — 이 프로젝트의 컴포넌트 테스트는 `+layout.svelte` 없이 페이지를 단독 마운트해 Tailwind가 적용되지 않는다

---

### Task 1: 경로 규칙을 공유 모듈 하나로 모은다

동작은 그대로다. 흩어진 세 사본을 한 함수로 바꾸고, 그 함수가 브라우저에서도 돌 수 있게 만든다.

**Files:**
- Create: `src/lib/media.ts`
- Create: `src/lib/media.test.ts`
- Modify: `src/lib/server/jobs/runner.ts` (원본 경로, 포맷별 출력 경로)
- Modify: `src/routes/api/media/[id]/[format]/+server.ts`

**Interfaces:**
- Produces: `mediaFileExt(format: string, entry: { ext?: string } | undefined): string`, `mediaFilePath(mediaDir: string, recordingId: string, format: string, ext: string): string`. Task 2가 둘 다 쓴다

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/media.ts`를 만들기 전에 `src/lib/media.test.ts`를 쓴다.

```ts
import { describe, it, expect } from 'vitest';
import { mediaFileExt, mediaFilePath } from './media';

describe('mediaFileExt — 포맷별 확장자 결정', () => {
  it("'original'은 files 항목의 ext를 쓴다", () => {
    expect(mediaFileExt('original', { ext: 'qta' })).toBe('qta');
  });

  it("'original'인데 ext가 없으면 'bin'으로 떨어진다", () => {
    // 실제로 이런 항목이 생기면 안 되지만, 없다고 던지는 것보다
    // 열어보고 실패하는 편이 진단하기 쉽다 — 기존 media 라우트의
    // 동작을 그대로 옮긴 것이다.
    expect(mediaFileExt('original', {})).toBe('bin');
    expect(mediaFileExt('original', undefined)).toBe('bin');
  });

  it('변환본은 포맷 이름이 곧 확장자다', () => {
    expect(mediaFileExt('mp3', { bytes: 1 } as { ext?: string })).toBe('mp3');
    expect(mediaFileExt('wav', undefined)).toBe('wav');
  });
});

describe('mediaFilePath — 저장 경로 조합', () => {
  it('mediaDir/포맷/아이디.확장자로 잇는다', () => {
    expect(mediaFilePath('/srv/media', 'a1b2', 'mp3', 'mp3')).toBe('/srv/media/mp3/a1b2.mp3');
  });

  it('original도 같은 규칙이다', () => {
    expect(mediaFilePath('/srv/media', 'a1b2', 'original', 'qta')).toBe(
      '/srv/media/original/a1b2.qta'
    );
  });

  it('mediaDir 끝의 슬래시가 중복되지 않는다', () => {
    // config.mediaDir는 path.resolve를 거쳐 보통 슬래시가 없지만,
    // 환경변수로 '/srv/media/'가 들어오면 이 함수가 '//'를 만들면 안 된다.
    expect(mediaFilePath('/srv/media/', 'a1b2', 'mp3', 'mp3')).toBe('/srv/media/mp3/a1b2.mp3');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/media.test.ts
```

Expected: FAIL — `./media` 모듈이 없다

- [ ] **Step 3: 공유 모듈 작성**

`src/lib/media.ts`를 만든다.

```ts
/**
 * 미디어 파일의 저장 경로 규칙. 이 규칙은 이 파일에만 존재해야 한다 —
 * 서버는 파일을 열 때, 화면은 경로를 보여줄 때 같은 함수를 부른다.
 * 규칙이 두 벌이면 언젠가 갈라지고, 그러면 화면이 존재하지 않는 경로를
 * 자신 있게 보여준다. "보여주는 경로가 실제로 여는 경로와 같다"가
 * 경로 표시 기능의 전부다.
 *
 * node:path를 쓰지 않는다 — 이 모듈은 브라우저에서도 불린다. mediaDir는
 * 서버의 config가 path.resolve로 만든 절대 경로라, 여기서 할 일은
 * 구분자로 잇는 것뿐이다.
 */

/**
 * 포맷 이름으로 실제 파일 확장자를 정한다. 변환본은 포맷 이름이 곧
 * 확장자지만(mp3 → .mp3), 원본은 무엇이 들어올지 몰라 files 항목에
 * 따로 적어둔다.
 */
export function mediaFileExt(format: string, entry: { ext?: string } | undefined): string {
  return format === 'original' ? (entry?.ext ?? 'bin') : format;
}

/** mediaDir/포맷/아이디.확장자. */
export function mediaFilePath(
  mediaDir: string,
  recordingId: string,
  format: string,
  ext: string
): string {
  const base = mediaDir.endsWith('/') ? mediaDir.slice(0, -1) : mediaDir;
  return `${base}/${format}/${recordingId}.${ext}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/media.test.ts
```

Expected: PASS — 6개 전부

- [ ] **Step 5: media 라우트를 공유 함수로 바꾼다**

`src/routes/api/media/[id]/[format]/+server.ts`에서 다음 두 줄을 찾는다.

```ts
  const ext = params.format === 'original' ? (entry.ext ?? 'bin') : params.format;
  const file = path.join(config.mediaDir, params.format, `${rec.id}.${ext}`);
```

이렇게 바꾸고, 파일 상단에 `import { mediaFileExt, mediaFilePath } from '$lib/media';`를 추가한다.

```ts
  const ext = mediaFileExt(params.format, entry);
  const file = mediaFilePath(config.mediaDir, rec.id, params.format, ext);
```

`path`가 이 파일의 다른 곳에서 더 이상 안 쓰이면 import도 지운다. 남아 있으면 그대로 둔다.

- [ ] **Step 6: runner의 두 곳을 공유 함수로 바꾼다**

`src/lib/server/jobs/runner.ts`에서 원본 경로를 찾는다.

```ts
    const originalPath = path.join(cfg.mediaDir, 'original', `${job.recordingId}.${ext}`);
```

```ts
    const originalPath = mediaFilePath(cfg.mediaDir, job.recordingId, 'original', ext);
```

포맷별 출력 경로도 바꾼다.

```ts
      const out = path.join(cfg.mediaDir, spec.name, `${job.recordingId}.${spec.ext}`);
```

```ts
      const out = mediaFilePath(cfg.mediaDir, job.recordingId, spec.name, spec.ext);
```

`import { mediaFilePath } from '$lib/media';`를 추가한다. `ext` 계산(`path.extname(job.sourcePath).slice(1)`)은 그대로 둔다 — 원본은 소스 파일에서 확장자를 얻는 것이지 `files` 항목에서 얻는 게 아니라, `mediaFileExt`가 맡을 일이 아니다.

- [ ] **Step 7: 동작이 안 바뀌었는지 확인**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Expected: 전부 통과. 특히 `src/routes/api/media/[id]/[format]/server.test.ts`와 변환 관련 테스트가 그대로 통과해야 한다 — 이 태스크는 동작을 바꾸지 않는다

- [ ] **Step 8: 뮤테이션으로 판별력 확인**

`mediaFilePath`의 구분자를 `/` 대신 `-`로 바꿔보고, `media.test.ts`와 media 라우트 테스트가 함께 실패하는지 확인한 뒤 되돌린다. 실제 출력을 보고한다.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "refactor: 미디어 저장 경로 규칙을 공유 모듈 하나로 모은다

같은 규칙이 runner 두 곳과 media 라우트에 흩어져 있었다. 곧 화면에서도
같은 경로를 보여줘야 하는데, 넷째 사본을 만들면 언젠가 갈라진다 —
그러면 화면이 존재하지 않는 경로를 자신 있게 보여준다.

브라우저에서도 불려야 해서 node:path 대신 문자열로 잇는다. mediaDir는
서버 config가 path.resolve로 만든 절대 경로라 이을 것만 남는다."
```

---

### Task 2: 재생 중인 파일의 저장 경로를 보여준다

**Files:**
- Modify: `src/routes/recordings/+page.server.ts`
- Modify: `src/routes/recordings/+page.svelte` (Player에 `mediaDir` 전달)
- Modify: `src/lib/components/Player.svelte`
- Create: `src/lib/pathDisplay.ts`
- Create: `src/lib/pathDisplay.test.ts`
- Test: `src/lib/components/Player.svelte.test.ts`

**Interfaces:**
- Consumes: Task 1의 `mediaFileExt`, `mediaFilePath`
- Produces: `middleEllipsis(text: string, max: number): string`

- [ ] **Step 1: 줄이기 함수의 실패 테스트 작성**

`src/lib/pathDisplay.test.ts`를 만든다.

```ts
import { describe, it, expect } from 'vitest';
import { middleEllipsis } from './pathDisplay';

describe('middleEllipsis — 긴 경로 줄이기', () => {
  it('max 이하면 그대로 둔다', () => {
    expect(middleEllipsis('/a/b.mp3', 40)).toBe('/a/b.mp3');
  });

  it('가운데를 줄이고 앞과 끝을 남긴다', () => {
    // 끝만 남기면 어느 저장소인지 모르고, 앞만 남기면 어느 파일인지
    // 모른다 — 둘 다 남는 것이 이 함수의 존재 이유다.
    const long = '/Volumes/Storage/voice/uls/media/mp3/a1b2c3d4e5f6.mp3';
    const out = middleEllipsis(long, 30);

    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).toContain('…');
    expect(out.startsWith('/Volumes')).toBe(true);
    expect(out.endsWith('.mp3')).toBe(true);
  });

  it('줄인 뒤에도 파일명이 알아볼 만큼 남는다', () => {
    const long = '/very/long/prefix/that/keeps/going/on/and/on/recording.wav';
    expect(middleEllipsis(long, 30)).toContain('recording.wav');
  });

  it('max가 말줄임표보다도 작으면 빈 문자열이 아니라 끝부분을 준다', () => {
    // 어느 파일인지가 어느 저장소인지보다 급하다.
    const out = middleEllipsis('/a/bbbbbbbbbb/cccc.mp3', 5);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/pathDisplay.test.ts
```

Expected: FAIL — `./pathDisplay` 모듈이 없다

- [ ] **Step 3: 줄이기 함수 작성**

`src/lib/pathDisplay.ts`를 만든다.

```ts
/**
 * 긴 경로를 가운데에서 줄인다. 끝만 남기면 어느 저장소에 있는지 모르고,
 * 앞만 남기면 어느 파일인지 모른다 — 경로를 보여주는 이유가 둘 다이므로
 * 양끝을 남긴다. 파일명이 저장소 위치보다 급하다고 보고, 자리가 아주
 * 부족하면 뒤쪽을 우선한다.
 */
export function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(-max);

  const tail = Math.ceil((max - 1) / 2);
  const head = max - 1 - tail;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/pathDisplay.test.ts
```

Expected: PASS — 4개 전부

- [ ] **Step 5: 서버가 mediaDir를 내려준다**

`src/routes/recordings/+page.server.ts`를 이 내용으로 바꾼다.

```ts
import type { PageServerLoad } from './$types';
import { config } from '$lib/server/config';
import { listAll, allTags } from '$lib/server/store/recordings';

export const load: PageServerLoad = async () => ({
  recordings: await listAll(config),
  tags: await allTags(config),
  formats: config.formats.map((f) => f.name),
  // 경로 문자열 하나만 내려보낸다. 녹음마다 포맷별 경로를 미리 만들어
  // 실으면, 252개 × 포맷 수만큼의 쓰지도 않을 문자열이 매 요청에
  // 따라온다 — 실제로 필요한 것은 지금 재생 중인 하나뿐이라, 화면이
  // 이 값과 mediaFilePath로 그때 만든다.
  mediaDir: config.mediaDir
});
```

- [ ] **Step 6: Player가 경로를 받도록 실패 테스트 작성**

`src/lib/components/Player.svelte.test.ts` 맨 아래에 추가한다. 이 파일에 이미 있는 렌더 헬퍼와 픽스처가 있으면 그대로 쓰고, 없으면 이 테스트 안에서 만든다.

```ts
describe('Player.svelte — 재생 중인 파일의 저장 경로', () => {
  function recordingWith(files: Record<string, { ext?: string; bytes: number }>) {
    return {
      id: 'a1b2',
      title: '레인',
      description: '',
      tags: [],
      recordedAt: '2026-07-09T22:36:13+09:00',
      durationSec: 125,
      sourceName: 'a1b2.qta',
      appleAutoTitle: null,
      files,
      bookmarks: [],
      createdAt: '',
      updatedAt: '',
      deletedAt: null
    };
  }

  it('선택된 포맷의 절대 경로를 보여준다', async () => {
    render(Player, {
      recording: recordingWith({ original: { ext: 'qta', bytes: 1 }, mp3: { bytes: 2 } }),
      formats: ['mp3', 'wav'],
      mediaDir: '/srv/media'
    });

    // 줄여서 보여주더라도 전체 경로는 title에 남아야 한다 — 줄인
    // 문자열만 있으면 사용자가 실제 위치를 알 방법이 없다.
    const el = await page.getByTitle('/srv/media/mp3/a1b2.mp3').element();
    expect(el).toBeTruthy();
  });

  it('재생 중인 녹음이 없으면 경로를 보여주지 않는다', async () => {
    render(Player, { recording: null, formats: ['mp3'], mediaDir: '/srv/media' });

    expect(document.body.textContent).not.toContain('/srv/media');
  });

  it('original 포맷은 files의 ext를 써서 경로를 만든다', async () => {
    // 변환본은 포맷 이름이 곧 확장자지만 original은 아니다 — 여기서
    // 규칙이 어긋나면 화면이 없는 파일을 가리킨다.
    render(Player, {
      recording: recordingWith({ original: { ext: 'qta', bytes: 1 } }),
      formats: ['original'],
      mediaDir: '/srv/media'
    });

    const el = await page.getByTitle('/srv/media/original/a1b2.qta').element();
    expect(el).toBeTruthy();
  });
});
```

- [ ] **Step 7: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/components/Player.svelte.test.ts
```

Expected: 새 3개 중 최소 2개가 FAIL — Player가 아직 `mediaDir`를 받지도, 경로를 그리지도 않는다

- [ ] **Step 8: Player에 경로 표시를 넣는다**

`src/lib/components/Player.svelte`의 `$props()` 선언에 `mediaDir`를 더한다.

```ts
    mediaDir = '',
```

`<script>` 안, `src`를 만드는 `$derived` 근처에 경로 계산을 더한다.

```ts
  // 지금 재생 중인 파일이 디스크 어디에 있는지. 서버가 파일을 열 때
  // 쓰는 것과 같은 함수라, 여기 보이는 경로는 실제로 열리는 경로다.
  const filePath = $derived(
    recording && recording.files[format] && mediaDir
      ? mediaFilePath(mediaDir, recording.id, format, mediaFileExt(format, recording.files[format]))
      : ''
  );
```

파일 상단에 import를 더한다.

```ts
  import { mediaFilePath, mediaFileExt } from '$lib/media';
  import { middleEllipsis } from '$lib/pathDisplay';
```

마크업의 재생기 컨테이너 안, 맨 아래 우측에 한 줄을 더한다.

```svelte
  {#if filePath}
    <!-- 전체 경로는 title에 둔다 — 줄인 문자열만 있으면 실제 위치를
         알 방법이 없다. 60자는 재생기 폭에서 두 줄로 넘어가지 않는
         선에서 잡았다. -->
    <div class="text-surface-500 mt-1 text-right font-mono text-xs" title={filePath}>
      {middleEllipsis(filePath, 60)}
    </div>
  {/if}
```

- [ ] **Step 9: 테스트 통과 확인**

```bash
npx vitest run src/lib/components/Player.svelte.test.ts
```

Expected: PASS

- [ ] **Step 10: 뮤테이션으로 판별력 확인**

두 가지를 각각 해보고 되돌린 뒤, 실제 출력과 함께 보고한다.

1. `mediaFileExt(format, ...)` 대신 `format`을 그대로 확장자로 넘긴다 → "original 포맷은 files의 ext를 써서" 테스트가 실패해야 한다
2. `title={filePath}`를 `title={middleEllipsis(filePath, 60)}`로 바꾼다 → 짧은 경로에서는 통과하지만, 60자를 넘는 경로를 쓰는 테스트를 추가하지 않았다면 아무것도 안 깨진다. **아무것도 안 깨지면 그 사실을 보고하고**, 전체 경로가 title에 남는지를 실제로 지키는 테스트를 하나 더한다

- [ ] **Step 11: 네 가지 검증과 커밋**

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

```bash
git add -A
git commit -m "feat: 재생 중인 파일의 저장 경로를 재생기에 보여준다

서버가 파일을 열 때 쓰는 mediaFilePath를 화면도 그대로 부른다 —
규칙이 하나뿐이라 보여주는 경로와 여는 경로가 갈라질 수 없다.

mediaDir는 문자열 하나만 내려받는다. 녹음마다 포맷별 경로를 미리
만들면 쓰지도 않을 문자열 수백 개가 매 요청에 따라온다.

긴 경로는 가운데를 줄인다. 끝만 남기면 어느 저장소인지 모르고 앞만
남기면 어느 파일인지 모른다. 전체 경로는 title에 남는다."
```

---

### Task 3: 파형 위 호버에 재생헤드 선과 시간을 보여준다

이 태스크는 호버까지다. 드래그와 점프는 Task 4가 붙인다. 이 단계에서도 클릭 점프는 기존대로 동작한다.

**Files:**
- Modify: `src/lib/player.ts` (시간 형식 함수 추가)
- Modify: `src/lib/components/Waveform.svelte`
- Test: `src/lib/player.test.ts`, `src/lib/components/Waveform.svelte.test.ts`

**Interfaces:**
- Produces: `formatTime(sec: number): string`, 그리고 Waveform 내부의 `hoverRatio` 상태. Task 4가 그 상태를 드래그로 확장한다

- [ ] **Step 1: 시간 형식 함수의 실패 테스트 작성**

`src/lib/player.test.ts` 맨 아래에 추가한다.

```ts
describe('formatTime — 재생 시간 표시', () => {
  it('분:초로 보여주고 초는 두 자리로 채운다', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });

  it('소수점 이하는 버린다', () => {
    expect(formatTime(65.9)).toBe('1:05');
  });

  it('음수나 NaN은 0:00으로 떨어진다', () => {
    // 파형 위 좌표 계산이 어긋나도 "NaN:NaN" 같은 문자열이 화면에
    // 뜨지는 않게 한다.
    expect(formatTime(-3)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});
```

파일 상단 import에 `formatTime`을 더한다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/player.test.ts
```

Expected: FAIL — `formatTime`이 없다

- [ ] **Step 3: 시간 형식 함수 작성**

`src/lib/player.ts`에 더한다.

```ts
/** 재생 시간을 m:ss로. 잘못된 값은 0:00으로 떨어진다. */
export function formatTime(sec: number): string {
  const t = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
```

- [ ] **Step 4: 통과 확인과 기존 사본 정리**

```bash
npx vitest run src/lib/player.test.ts
```

Expected: PASS

`src/routes/recordings/+page.svelte`와 `src/lib/components/Player.svelte`에 지역 시간 형식 함수(`fmt` 등)가 있다. **출력이 이 함수와 완전히 같은지 직접 확인하고**, 같으면 `formatTime`으로 바꾸고, 다르면 그대로 두고 무엇이 다른지 보고한다. 확인 없이 바꾸지 않는다 — 화면 표시가 조용히 달라진다.

- [ ] **Step 5: 호버 표시의 실패 테스트 작성**

`src/lib/components/Waveform.svelte.test.ts`에 새 describe를 더한다.

```ts
describe('Waveform.svelte — 호버 시 재생헤드와 시간', () => {
  /** 캔버스의 실제 폭 안에서 비율 위치의 clientX를 만든다. */
  function xAt(canvas: Element, ratio: number): number {
    const r = canvas.getBoundingClientRect();
    return r.left + r.width * ratio;
  }

  function canvasOf(): HTMLCanvasElement {
    const c = document.querySelector('canvas');
    if (!c) throw new Error('캔버스가 없다');
    return c as HTMLCanvasElement;
  }

  it('파형 위에 커서를 올리면 그 지점의 시각을 보여준다', async () => {
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek: vi.fn() });

    const c = canvasOf();
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );

    // 100초의 절반 → 0:50
    await expect.element(page.getByText('0:50')).toBeInTheDocument();
  });

  it('커서가 파형을 벗어나면 표시가 사라진다', async () => {
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek: vi.fn() });

    const c = canvasOf();
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );
    await expect.element(page.getByText('0:50')).toBeInTheDocument();

    c.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1 }));

    expect(document.body.textContent).not.toContain('0:50');
  });

  it('호버만으로는 onseek를 호출하지 않는다', async () => {
    // 스크러빙 없음의 절반이다 — 올려놓기만 해도 소리가 튀면 안 된다.
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );

    expect(onseek).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/components/Waveform.svelte.test.ts
```

Expected: 새 3개 중 앞의 2개가 FAIL — 시간 표시가 아직 없다

- [ ] **Step 7: 호버 표시 구현**

`src/lib/components/Waveform.svelte`의 `<script>`에 더한다. import에 `formatTime`을 추가한다.

```ts
  /**
   * 커서가 가리키는 위치(0~1). null이면 표시하지 않는다.
   *
   * 이 값은 progress와 별개다 — 드래그·호버 중에도 진행률 채움은
   * 움직이지 않는다(스크러빙 없음). 소리는 원래 위치에서 계속 나는데
   * 채움이 커서를 따라가면 소리와 화면이 어긋나 보인다.
   */
  let hoverRatio = $state<number | null>(null);

  function ratioFromPointer(e: { clientX: number }): number {
    if (!canvas) return 0;
    const r = canvas.getBoundingClientRect();
    return ratioFromClick(e.clientX, r.left, r.width);
  }
```

마크업의 `<canvas>`에 핸들러를 더한다(`onclick`은 그대로 둔다).

```svelte
    onpointermove={(e) => (hoverRatio = ratioFromPointer(e))}
    onpointerleave={() => (hoverRatio = null)}
```

`{#if !peaks.length}` 블록 **앞**에 표시를 더한다.

```svelte
  {#if hoverRatio !== null}
    <!-- 선과 말풍선 모두 포인터 이벤트를 받지 않는다 — 커서 바로 아래에
         있어서, 받으면 자기 자신이 캔버스의 pointermove를 가려 표시가
         깜빡인다. -->
    <div
      class="bg-surface-900-100 pointer-events-none absolute inset-y-0 w-px"
      style="left: {hoverRatio * 100}%"
    ></div>
    <!-- 좌우 끝에서 말풍선이 잘리지 않게 안쪽으로 민다. -->
    <div
      class="bg-surface-900-100 text-surface-100-900 pointer-events-none absolute -top-6 rounded px-1 text-xs tabular-nums"
      style="left: {hoverRatio * 100}%; transform: translateX({hoverRatio < 0.1
        ? '0'
        : hoverRatio > 0.9
          ? '-100%'
          : '-50%'})"
    >
      {formatTime(hoverRatio * durationSec)}
    </div>
  {/if}
```

- [ ] **Step 8: 통과 확인**

```bash
npx vitest run src/lib/components/Waveform.svelte.test.ts
```

Expected: 기존 3개 + 새 3개 전부 PASS

- [ ] **Step 9: 뮤테이션으로 판별력 확인**

두 가지를 각각 해보고 되돌린 뒤, 실제 출력과 함께 보고한다.

1. `onpointerleave` 핸들러를 지운다 → "커서가 파형을 벗어나면 표시가 사라진다"가 실패해야 한다
2. 말풍선에 `formatTime(hoverRatio * durationSec)` 대신 `formatTime(progress * durationSec)`를 넣는다 → "그 지점의 시각을 보여준다"가 실패해야 한다(커서가 아니라 현재 재생 위치를 보여주게 되므로)

- [ ] **Step 10: 네 가지 검증과 커밋**

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

```bash
git add -A
git commit -m "feat: 파형 위 호버에 재생헤드 선과 시간을 보여준다

누르기 전에 어디로 점프할지 확인할 수 있어 빗나간 클릭이 줄어든다.

hoverRatio는 progress와 별개다 — 커서를 따라가는 것은 선과 말풍선뿐이고
진행률 채움은 움직이지 않는다. 소리는 원래 위치에서 계속 나는데 채움이
커서를 따라가면 소리와 화면이 어긋나 보인다."
```

---

### Task 4: 끌어서 놓는 지점으로 점프한다

**Files:**
- Modify: `src/lib/components/Waveform.svelte`
- Test: `src/lib/components/Waveform.svelte.test.ts`

**Interfaces:**
- Consumes: Task 3의 `hoverRatio`, `ratioFromPointer`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/components/Waveform.svelte.test.ts`에 새 describe를 더한다. Task 3이 만든 `xAt`·`canvasOf` 헬퍼를 파일 상단으로 올려 두 describe가 함께 쓰게 한다.

```ts
describe('Waveform.svelte — 끌어서 점프', () => {
  /** pointerdown → pointermove → pointerup을 순서대로 보낸다. */
  function drag(c: HTMLCanvasElement, fromRatio: number, toRatio: number) {
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    c.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: xAt(c, fromRatio), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, toRatio), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointerup', { clientX: xAt(c, toRatio), bubbles: true, pointerId: 1 })
    );
  }

  it('끌어서 놓으면 놓은 지점의 진행률로 정확히 한 번 onseek를 호출한다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    drag(canvasOf(), 0.2, 0.75);

    expect(onseek).toHaveBeenCalledTimes(1);
    expect(onseek.mock.calls[0][0]).toBeCloseTo(0.75, 2);
  });

  it('끄는 동안에는 onseek를 호출하지 않는다', async () => {
    // 스크러빙 없음의 나머지 절반이다. 놓기 전에 소리가 따라오면 안 된다.
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    c.setPointerCapture = () => {};
    c.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: xAt(c, 0.2), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.8), bubbles: true, pointerId: 1 })
    );

    expect(onseek).not.toHaveBeenCalled();
  });

  it('캔버스 왼쪽 밖에서 놓으면 0으로 고정해 호출한다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    const r = c.getBoundingClientRect();
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    c.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: xAt(c, 0.5), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointerup', { clientX: r.left - 500, bubbles: true, pointerId: 1 })
    );

    expect(onseek).toHaveBeenCalledTimes(1);
    expect(onseek).toHaveBeenCalledWith(0);
  });

  it('끄는 중 Escape를 누르면 점프하지 않고 표시도 사라진다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    c.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: xAt(c, 0.2), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: xAt(c, 0.8), bubbles: true, pointerId: 1 })
    );
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    c.dispatchEvent(
      new PointerEvent('pointerup', { clientX: xAt(c, 0.8), bubbles: true, pointerId: 1 })
    );

    expect(onseek).not.toHaveBeenCalled();
  });

  it('거의 움직이지 않고 놓으면 드래그가 아니라 클릭으로 처리한다', async () => {
    // 마우스를 누를 때 손이 1~2px 흔들리는 것은 정상이다. 이걸 드래그로
    // 보면 마커를 클릭하려던 사용자가 의도치 않게 드래그 경로로 빠진다.
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5, 0.5, 0.5], progress: 0, durationSec: 100, onseek });

    const c = canvasOf();
    const x = xAt(c, 0.5);
    c.setPointerCapture = () => {};
    c.releasePointerCapture = () => {};
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, bubbles: true, pointerId: 1 }));
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 2, bubbles: true, pointerId: 1 }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 2, bubbles: true, pointerId: 1 }));

    // 드래그로는 호출하지 않는다 — 뒤이어 오는 click이 기존 경로로 처리한다.
    expect(onseek).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/components/Waveform.svelte.test.ts
```

Expected: 새 5개 중 최소 3개가 FAIL — 드래그가 아직 없다

- [ ] **Step 3: 드래그 구현**

`src/lib/components/Waveform.svelte`의 `<script>`에 더한다.

```ts
  /**
   * 3px보다 적게 움직이고 놓으면 드래그가 아니라 클릭이다. 마우스를
   * 누를 때 손이 1~2px 흔들리는 것은 정상이라, 0px을 기준으로 하면
   * 마커나 캔버스를 클릭하려던 사용자가 드래그 경로로 빠진다.
   */
  const DRAG_THRESHOLD_PX = 3;

  let pressX: number | null = null;
  let dragging = $state(false);
  /** 드래그로 점프한 직후 브라우저가 보내는 click을 한 번 무시한다. */
  let swallowNextClick = false;

  function onPointerDown(e: PointerEvent) {
    pressX = e.clientX;
    hoverRatio = ratioFromPointer(e);
    // 캔버스 밖으로 나가도 계속 따라간다 — 끝 근처를 노리다 살짝
    // 벗어나면 드래그가 조용히 죽는 쪽이 더 나쁘다.
    canvas?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    hoverRatio = ratioFromPointer(e);
    if (pressX !== null && Math.abs(e.clientX - pressX) >= DRAG_THRESHOLD_PX) dragging = true;
  }

  function onPointerUp(e: PointerEvent) {
    canvas?.releasePointerCapture(e.pointerId);
    const wasDragging = dragging;
    const ratio = ratioFromPointer(e);
    pressX = null;
    dragging = false;

    // 움직임이 임계값 미만이면 아무것도 하지 않는다 — 뒤이어 오는
    // click이 기존 경로(캔버스 클릭 점프, 마커 클릭 점프)로 처리한다.
    if (!wasDragging) return;

    swallowNextClick = true;
    onseek(ratio);
  }

  function cancelDrag() {
    pressX = null;
    dragging = false;
    hoverRatio = null;
  }
```

기존 `seekAt`을 고쳐 삼킴 플래그를 본다.

```ts
  function seekAt(e: MouseEvent) {
    if (swallowNextClick) {
      swallowNextClick = false;
      return;
    }
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    onseek(ratioFromClick(e.clientX, r.left, r.width));
  }
```

Task 3에서 넣은 `onpointermove`·`onpointerleave`를 다음으로 바꾸고 나머지를 더한다.

```svelte
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointerleave={() => {
      if (!dragging) hoverRatio = null;
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') cancelDrag();
    }}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/lib/components/Waveform.svelte.test.ts
```

Expected: 기존 3개 + Task 3의 3개 + 새 5개 전부 PASS. **기존 "캔버스를 클릭하면 0~1 사이의 진행률로 onseek를 호출한다"가 그대로 통과해야 한다** — 임계값 미만 움직임을 클릭으로 넘기는 설계가 지키려는 것이 바로 이것이다

- [ ] **Step 5: 뮤테이션으로 판별력 확인**

세 가지를 각각 해보고 되돌린 뒤, 실제 출력과 함께 보고한다.

1. `onPointerMove`에 `onseek(hoverRatio)`를 더한다 → "끄는 동안에는 onseek를 호출하지 않는다"가 실패해야 한다
2. `DRAG_THRESHOLD_PX`를 0으로 바꾼다 → "거의 움직이지 않고 놓으면 클릭으로 처리한다"가 실패해야 한다
3. `cancelDrag`에서 `dragging = false`를 뺀다 → Escape 테스트가 실패해야 한다

- [ ] **Step 6: 실제로 써본다**

```bash
npm run dev
```

재생 중에 파형을 끌어보고, **끄는 동안 소리가 따라오지 않는지**와 **진행률 채움이 커서를 따라가지 않는지**를 확인한다. 캔버스 밖으로 끌고 나갔다 놓았을 때 양 끝으로 고정되는지, 북마크 마커를 클릭했을 때 여전히 그 지점으로 점프하는지도 본다. 본 것을 보고한다. 브라우저를 못 띄우면 그렇게 밝힌다.

- [ ] **Step 7: 네 가지 검증과 커밋**

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

```bash
git add -A
git commit -m "feat: 파형을 끌어서 놓는 지점으로 점프한다

끄는 동안에는 onseek를 부르지 않는다 — 소리는 원래 위치에서 계속
나고, 진행률 채움도 그대로다. 움직이는 것은 재생헤드 선과 말풍선뿐이다.

포인터 캡처로 캔버스 밖까지 따라간다. 끝 근처를 노리다 살짝 벗어나면
드래그가 조용히 죽는 쪽이 더 나쁘다.

3px 미만 움직임은 클릭으로 넘긴다. 마우스를 누를 때 손이 1~2px
흔들리는 것은 정상이라, 0px 기준이면 마커를 클릭하려던 사용자가
드래그 경로로 빠진다."
```

---

### Task 5: 키보드로도 탐색한다

캔버스에는 이미 `role="slider"`와 `tabindex="0"`이 붙어 있는데 키 핸들러가 없다. 키보드로 조작할 수 있다고 선언해 놓고 아무 키에도 반응하지 않는 상태다.

**Files:**
- Modify: `src/lib/components/Waveform.svelte`
- Test: `src/lib/components/Waveform.svelte.test.ts`

**Interfaces:**
- Consumes: Task 4의 `cancelDrag`와 `onkeydown` 핸들러

- [ ] **Step 1: 실패 테스트 작성**

```ts
describe('Waveform.svelte — 키보드 탐색', () => {
  function keyOn(c: HTMLCanvasElement, key: string) {
    c.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  it('오른쪽 화살표는 5초 앞으로 간다', async () => {
    const onseek = vi.fn();
    // 100초짜리에서 20초 지점(progress 0.2) → 25초 → 0.25
    render(Waveform, { peaks: [0.5, 0.5], progress: 0.2, durationSec: 100, onseek });

    keyOn(canvasOf(), 'ArrowRight');

    expect(onseek).toHaveBeenCalledTimes(1);
    expect(onseek.mock.calls[0][0]).toBeCloseTo(0.25, 3);
  });

  it('왼쪽 화살표는 5초 뒤로 간다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5], progress: 0.2, durationSec: 100, onseek });

    keyOn(canvasOf(), 'ArrowLeft');

    expect(onseek.mock.calls[0][0]).toBeCloseTo(0.15, 3);
  });

  it('Home은 처음으로, End는 끝으로 간다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5], progress: 0.4, durationSec: 100, onseek });

    keyOn(canvasOf(), 'Home');
    expect(onseek).toHaveBeenLastCalledWith(0);

    keyOn(canvasOf(), 'End');
    expect(onseek).toHaveBeenLastCalledWith(1);
  });

  it('시작과 끝을 넘어가지 않는다', async () => {
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5], progress: 0, durationSec: 100, onseek });

    keyOn(canvasOf(), 'ArrowLeft');

    expect(onseek).toHaveBeenCalledWith(0);
  });

  it('durationSec이 0이면 키를 눌러도 아무 일도 없다', async () => {
    // 0으로 나눠 NaN을 onseek에 넘기면 재생기가 조용히 망가진다.
    const onseek = vi.fn();
    render(Waveform, { peaks: [0.5, 0.5], progress: 0, durationSec: 0, onseek });

    keyOn(canvasOf(), 'ArrowRight');

    expect(onseek).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/components/Waveform.svelte.test.ts
```

Expected: 새 5개 중 4개가 FAIL — 키 핸들러가 Escape만 처리한다

- [ ] **Step 3: 키 핸들러 구현**

`src/lib/components/Waveform.svelte`의 `<script>`에 더한다.

```ts
  /** 화살표 한 번에 움직이는 초. 한 문장을 건너뛰기엔 짧고, 위치를
      더듬기엔 충분한 정도로 잡았다. */
  const KEY_STEP_SEC = 5;

  function seekByKey(key: string): boolean {
    // 길이를 모르면 비율을 계산할 수 없다 — 0으로 나눠 NaN을 넘기면
    // 재생기가 조용히 망가진다.
    if (!durationSec) return false;

    const at = progress * durationSec;
    let next: number;
    if (key === 'ArrowRight') next = at + KEY_STEP_SEC;
    else if (key === 'ArrowLeft') next = at - KEY_STEP_SEC;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = durationSec;
    else return false;

    onseek(Math.min(1, Math.max(0, next / durationSec)));
    return true;
  }
```

Task 4에서 넣은 `onkeydown`을 다음으로 바꾼다.

```svelte
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        cancelDrag();
        return;
      }
      // 화살표가 페이지를 스크롤하지 않게 막는다 — 처리한 키만.
      if (seekByKey(e.key)) e.preventDefault();
    }}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/lib/components/Waveform.svelte.test.ts
```

Expected: 이 파일의 모든 테스트 PASS

- [ ] **Step 5: 뮤테이션으로 판별력 확인**

두 가지를 각각 해보고 되돌린 뒤, 실제 출력과 함께 보고한다.

1. `if (!durationSec) return false;`를 뺀다 → "durationSec이 0이면 아무 일도 없다"가 실패해야 한다(NaN이 넘어간다)
2. `Math.min(1, Math.max(0, ...))` 고정을 뺀다 → "시작과 끝을 넘어가지 않는다"가 실패해야 한다

- [ ] **Step 6: 네 가지 검증과 커밋**

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

```bash
git add -A
git commit -m "feat: 파형을 키보드로도 탐색한다

캔버스에 role=slider와 tabindex가 붙어 있는데 키 핸들러가 없어,
키보드로 조작할 수 있다고 선언만 하고 아무 키에도 반응하지 않았다.
드래그가 붙으면서 그 약속이 더 두드러졌다.

화살표는 5초, Home/End는 양 끝. 길이를 모르면 비율을 계산할 수 없으므로
아무것도 하지 않는다 — 0으로 나눈 NaN을 넘기면 재생기가 조용히 망가진다."
```

---

## 자체 검토

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| 3절 호버 표시 | Task 3 |
| 3절 드래그 중 채움 안 움직임 | Task 3(hoverRatio를 progress와 분리) + Task 4 뮤테이션 1 |
| 3절 캔버스 밖 드래그·0/1 고정 | Task 4 Step 1의 왼쪽 밖 테스트 |
| 3절 Escape 취소 | Task 4 |
| 3절 시간 말풍선 m:ss·끝에서 밀어넣기 | Task 3 Step 3(`formatTime`), Step 7(transform 분기) |
| 3절 북마크 마커 3px 임계값 | Task 4 Step 3의 `DRAG_THRESHOLD_PX` |
| 3절 키보드 | Task 5 |
| 4절 규칙 한 곳·기존 세 사본 교체 | Task 1 |
| 4절 mediaDir 문자열 하나만 내려보냄 | Task 2 Step 5 |
| 4절 우측 하단·가운데 줄임·title에 전체 | Task 2 Step 3·8 |
| 4절 녹음 없으면 표시 없음, 포맷 따라 바뀜 | Task 2 Step 6의 테스트 |
| 5절 기존 파형 테스트 3개 유지 | Task 4 Step 4에 명시 |

**플레이스홀더 점검**

TBD·TODO·"적절히 처리"류 없음. 코드 스텝에는 실제 코드가 들어 있다.

조건부 지시가 둘 있고 모두 "확인 없이 바꾸지 말 것"과 "안 깨지면 그 사실을 보고할 것"을 못박았다. Task 3 Step 4(기존 지역 시간 형식 함수가 `formatTime`과 같은 출력인지 확인 후에만 교체)와 Task 2 Step 10 뮤테이션 2(아무것도 안 깨지면 보고하고 테스트를 더한다)다. 둘 다 문서가 정할 수 없고 실행해야 아는 사실이라, 값을 지어내지 않았다.

**타입 일관성**

`mediaFileExt(format, entry)`·`mediaFilePath(mediaDir, id, format, ext)`는 Task 1이 정의하고 Task 2가 같은 시그니처로 부른다. `middleEllipsis(text, max)`는 Task 2 안에서 정의·사용한다. `formatTime(sec)`는 Task 3이 정의하고 같은 태스크에서 쓴다. `hoverRatio`·`ratioFromPointer`는 Task 3이 만들고 Task 4가 확장한다. `cancelDrag`는 Task 4가 만들고 Task 5의 핸들러가 부른다.

**남는 위험 둘**

`setPointerCapture`는 실제 포인터가 없는 합성 이벤트 환경에서 던질 수 있다. 그래서 Task 4의 테스트가 이를 no-op으로 덮어쓴다 — 프로덕션 동작(캔버스 밖 추적)을 테스트가 검증하지 못한다는 뜻이므로, Task 4 Step 6의 수동 확인이 그 몫을 진다.

`getBoundingClientRect`는 캔버스가 실제로 배치돼야 폭을 준다. 이 프로젝트의 컴포넌트 테스트에는 Tailwind가 없어 `w-full`이 적용되지 않는다 — 폭이 0이면 `ratioFromClick`이 0을 돌려주어 좌표 테스트가 전부 0에 몰린다. Task 3 Step 6과 Task 4 Step 2에서 이 증상이 보이면, 이 계획의 다른 곳을 고치지 말고 `app.css`를 import하는 별도 테스트 파일로 옮긴다(전역 제약에 적힌 것과 같은 이유·같은 방법이다).
