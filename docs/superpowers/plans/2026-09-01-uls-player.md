# ULS Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 애플 음성 메모 파일을 가져와 태그·날짜로 정리하고, 파형이 있는 재생기로 듣는 로컬 웹 애플리케이션을 만든다.

**Architecture:** SvelteKit 단일 프로세스. 서버 라이브러리는 `store`(JSON 저장소) · `apple`(CloudRecordings.db 리더) · `media`(ffprobe/ffmpeg) · `jobs`(변환 큐) 넷으로 나뉘고, `store` 외에는 파일시스템에 직접 접근하지 않는다. 무거운 변환은 요청 밖 백그라운드 큐에서 돌고 진행률은 SSE로 흘린다.

**Tech Stack:** SvelteKit 2 · Svelte 5 · Skeleton UI v5 · Tailwind 4 · TypeScript · better-sqlite3 · ffmpeg/ffprobe · Vitest · Playwright

**Spec:** `docs/superpowers/specs/2026-08-31-uls-player-design.md`

## Global Constraints

- 프로젝트 루트: `~/Dev/SIDE_PROJECT/uls_player` (이미 `git init` 되어 있고 `.gitignore`·`docs/`가 있다)
- 검증된 툴체인: Node `v22.14.0` · npm `10.9.2` · ffmpeg `9.0.1` · ffprobe `9.0.1`
- 데이터베이스를 도입하지 않는다. 모든 영속 상태는 `data/` 아래 JSON 파일이다
- `src/lib/server/store/` 외의 모듈은 `fs`로 `data/`를 직접 읽거나 쓰지 않는다
- ffmpeg 호출 시 **반드시 ffprobe로 얻은 절대 스트림 인덱스를 `-map 0:<index>`로 명시**한다. `apple_apac`은 ffmpeg에 디코더가 없어 지정하면 변환이 실패한다
- 모든 시각은 ISO 8601 오프셋 포함 문자열로 저장한다 (예: `2026-07-11T18:15:30+09:00`)
- 제목 중복을 허용한다. 항목 식별은 항상 `id`로 한다
- 삭제는 `deletedAt` 소프트 삭제이며 미디어 파일은 지우지 않는다
- 단위·통합 테스트는 Vitest, E2E는 Playwright
- 커밋 메시지는 한국어 본문, Conventional Commits 접두사(`feat:`, `test:`, `chore:`, `fix:`)

## 픽스처

실제 샘플에서 뽑은 파일만 저장소에 넣는다. 3.1GB 전체를 git에 넣지 않는다.

| 픽스처 | 출처 | 성질 |
|---|---|---|
| `tests/fixtures/audio/spatial.qta` | `20260711 181530-1923A106.qta` (176KB) | `[0]aac 2ch` + `[1]apple_apac 4ch`, 2.2767초 |
| `tests/fixtures/audio/plain.m4a` | `20260725 210049-B752B57A.m4a` (12KB) | `[0]aac 1ch`, 1.258667초 |
| `tests/fixtures/CloudRecordings.db` | 실제 DB에서 4행만 추출 | 제목이 갈리는 사례 포함 |

검증된 픽스처 값 (테스트에서 그대로 단언한다):

| 파일 | `format_tags.title` | DB `ZENCRYPTEDTITLE` | `ZDATE` → 로컬 |
|---|---|---|---|
| `20260711 181530-1923A106.qta` | 새로운 녹음 2 | 새로운 녹음 2 | 2026-07-11 18:15:30 |
| `20260725 210049-B752B57A.m4a` | 화양동 16 2 | 화양동 16 2 | 2026-07-25 21:00:49 |
| `20260725 005422-39A2B8E8.m4a` | 화양동 13 | **비와 당신** | 2026-07-25 00:54:22 |
| `20260830 194216-6C5B2224.m4a` | 화양동 57 | **울든 꽃에 물을주듯** | 2026-08-30 19:42:16 |

뒤 두 행은 오디오 파일 없이 DB 행만 픽스처에 넣는다. 제목이 갈린다는 사실은 DB만으로 검증되며, 오디오 바이트는 필요 없다.

## 파일 구조

```
uls_player/
├─ .env.example
├─ playwright.config.ts
├─ src/
│  ├─ app.html                                  html[data-theme]
│  ├─ app.css                                   Tailwind + Skeleton
│  ├─ lib/
│  │  ├─ types.ts                               공유 타입 전부
│  │  ├─ filter.ts                              순수 필터 함수 (서버/클라 공용)
│  │  ├─ server/
│  │  │  ├─ config.ts                           env → AppConfig
│  │  │  ├─ store/
│  │  │  │  ├─ atomic.ts                        원자적 JSON 쓰기 + 직렬화 큐
│  │  │  │  ├─ recordings.ts                    항목 CRUD, 태그 집계
│  │  │  │  └─ waveforms.ts                     피크 파일 읽기/쓰기
│  │  │  ├─ apple/cloudRecordings.ts            DB → 제목 맵
│  │  │  ├─ media/
│  │  │  │  ├─ probe.ts                         ffprobe + 스트림 선택
│  │  │  │  ├─ convert.ts                       ffmpeg 변환
│  │  │  │  └─ waveform.ts                      피크 생성
│  │  │  ├─ scan.ts                             폴더 → ScanItem[]
│  │  │  └─ jobs/
│  │  │     ├─ queue.ts                         동시성 큐 + 이벤트
│  │  │     └─ runner.ts                        항목 1개 파이프라인
│  │  └─ components/
│  │     ├─ TagInput.svelte
│  │     ├─ FilterBar.svelte
│  │     ├─ Waveform.svelte
│  │     └─ Player.svelte
│  └─ routes/
│     ├─ +layout.svelte
│     ├─ +page.svelte / +page.server.ts         목록
│     ├─ import/+page.svelte / +page.server.ts  가져오기
│     └─ api/
│        ├─ recordings/+server.ts               PATCH · DELETE
│        ├─ media/[id]/[format]/+server.ts      Range 스트리밍
│        ├─ waveform/[id]/+server.ts
│        └─ jobs/events/+server.ts              SSE
└─ tests/
   ├─ fixtures/
   └─ e2e/
```

---

### Task 1: 프로젝트 스캐폴딩과 설정 모듈

**Files:**
- Create: `src/lib/server/config.ts`
- Create: `src/lib/server/config.test.ts`
- Create: `src/lib/types.ts`
- Create: `.env.example`
- Modify: `src/app.html`, `src/app.css`, `src/routes/+layout.svelte`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `loadConfig(env: Record<string,string|undefined>): AppConfig`, `AppConfig`, `FormatSpec`, 그리고 `src/lib/types.ts`의 모든 타입. 이후 모든 태스크가 이 타입들을 가져다 쓴다.

- [ ] **Step 1: SvelteKit 스캐폴딩**

디렉터리에 `.git`·`.gitignore`·`docs/`가 이미 있으므로 `--no-dir-check`가 필요하다.

```bash
cd ~/Dev/SIDE_PROJECT/uls_player
npx sv create . --template minimal --types ts --no-add-ons --no-dir-check --install npm
```

- [ ] **Step 2: 애드온과 Skeleton 설치**

```bash
npx sv add tailwindcss vitest playwright --install npm
npm i -D @skeletonlabs/skeleton @skeletonlabs/skeleton-svelte
npm i better-sqlite3
npm i -D @types/better-sqlite3
```

- [ ] **Step 3: 스타일과 테마 연결**

`src/app.css` 전체를 이 내용으로 바꾼다. 임포트 순서가 중요하다.

```css
@import 'tailwindcss';
@import '@skeletonlabs/skeleton';
@import '@skeletonlabs/skeleton-svelte';
@import '@skeletonlabs/skeleton/themes/cerberus';
```

`src/app.html`의 `<html>` 태그에 테마 속성을 넣는다.

```html
<html lang="ko" data-theme="cerberus">
```

`src/routes/+layout.svelte`를 만든다.

```svelte
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

- [ ] **Step 4: 개발 서버가 뜨는지 확인**

```bash
npm run dev
```

Expected: `http://localhost:5173`에서 빈 페이지가 뜨고 콘솔에 오류가 없다. 확인 후 종료한다.

- [ ] **Step 5: 공유 타입 작성**

`src/lib/types.ts`:

```ts
export interface FileEntry {
  /** original 항목에만 있다. 변환본은 포맷 이름이 곧 확장자다. */
  ext?: string;
  bytes: number;
}

export interface Bookmark {
  id: string;
  atSec: number;
  /** null이면 지점 북마크, 값이 있으면 구간 북마크 */
  endSec: number | null;
  note: string;
}

export interface Recording {
  id: string;
  title: string;
  description: string;
  tags: string[];
  recordedAt: string;
  durationSec: number;
  sourceName: string;
  appleAutoTitle: string | null;
  /** 키는 'original' 또는 포맷 이름('mp3','wav') */
  files: Record<string, FileEntry>;
  bookmarks: Bookmark[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RecordingsFile {
  version: 1;
  recordings: Recording[];
}

export type TagMode = 'and' | 'or';

export interface Filter {
  q: string;
  tags: string[];
  tagMode: TagMode;
  /** YYYY-MM-DD, 포함 */
  from: string;
  /** YYYY-MM-DD, 포함 */
  to: string;
}

export interface FormatSpec {
  name: string;
  ext: string;
  codec: string;
  bitrate: string | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface AppConfig {
  dataDir: string;
  mediaDir: string;
  formats: FormatSpec[];
  convertConcurrency: number;
  waveformPeaks: number;
  maxUploadMb: number;
}

export interface ScanItem {
  sourcePath: string;
  sourceName: string;
  title: string;
  appleAutoTitle: string | null;
  recordedAt: string;
  durationSec: number;
  ext: string;
  bytes: number;
  audioStreamIndex: number;
  duplicate: boolean;
  /** 읽을 수 없는 파일이면 사유가 들어가고 나머지 필드는 신뢰할 수 없다 */
  error: string | null;
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobItem {
  id: string;
  recordingId: string;
  sourcePath: string;
  title: string;
  status: JobStatus;
  /** 포맷 이름 → 상태 */
  formats: Record<string, JobStatus>;
  error: string | null;
}

export interface JobsFile {
  version: 1;
  items: JobItem[];
}
```

- [ ] **Step 6: 설정 모듈 실패 테스트 작성**

`src/lib/server/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('빈 env에서 기본값을 만든다', () => {
    const cfg = loadConfig({});
    expect(cfg.formats.map((f) => f.name)).toEqual(['mp3', 'wav']);
    expect(cfg.convertConcurrency).toBe(4);
    expect(cfg.waveformPeaks).toBe(2000);
    expect(cfg.maxUploadMb).toBe(500);
  });

  it('OUTPUT_FORMATS에 없는 포맷은 만들지 않는다', () => {
    const cfg = loadConfig({ OUTPUT_FORMATS: 'mp3' });
    expect(cfg.formats).toHaveLength(1);
    expect(cfg.formats[0].name).toBe('mp3');
  });

  it('포맷별 파라미터를 env로 덮어쓴다', () => {
    const cfg = loadConfig({
      OUTPUT_FORMATS: 'mp3,wav',
      MP3_BITRATE: '320k',
      WAV_CHANNELS: '2',
      WAV_SAMPLE_RATE: '48000'
    });
    const mp3 = cfg.formats.find((f) => f.name === 'mp3')!;
    const wav = cfg.formats.find((f) => f.name === 'wav')!;
    expect(mp3.bitrate).toBe('320k');
    expect(wav.channels).toBe(2);
    expect(wav.sampleRate).toBe(48000);
  });

  it('공백과 빈 항목을 걸러낸다', () => {
    const cfg = loadConfig({ OUTPUT_FORMATS: ' mp3 , , wav ' });
    expect(cfg.formats.map((f) => f.name)).toEqual(['mp3', 'wav']);
  });

  it('알 수 없는 포맷은 거부한다', () => {
    expect(() => loadConfig({ OUTPUT_FORMATS: 'mp3,flac' })).toThrow(/flac/);
  });
});
```

- [ ] **Step 7: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/config.test.ts
```

Expected: FAIL — `Failed to resolve import "./config"`

- [ ] **Step 8: 설정 모듈 구현**

`src/lib/server/config.ts`:

```ts
import path from 'node:path';
import type { AppConfig, FormatSpec } from '$lib/types';

/** 포맷별 기본값. env는 이 위에 덮어쓰기만 한다. */
const FORMAT_DEFAULTS: Record<string, Omit<FormatSpec, 'name'>> = {
  mp3: { ext: 'mp3', codec: 'libmp3lame', bitrate: '192k', sampleRate: 44100, channels: 2 },
  wav: { ext: 'wav', codec: 'pcm_s16le', bitrate: null, sampleRate: 44100, channels: 1 }
};

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key}는 숫자여야 합니다: ${raw}`);
  return n;
}

export function loadConfig(env: Env): AppConfig {
  const names = (env.OUTPUT_FORMATS ?? 'mp3,wav')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const formats: FormatSpec[] = names.map((name) => {
    const base = FORMAT_DEFAULTS[name];
    if (!base) {
      throw new Error(
        `OUTPUT_FORMATS에 알 수 없는 포맷이 있습니다: ${name}. ` +
          `지원 포맷: ${Object.keys(FORMAT_DEFAULTS).join(', ')}`
      );
    }
    const up = name.toUpperCase();
    return {
      name,
      ext: base.ext,
      codec: env[`${up}_CODEC`] ?? base.codec,
      bitrate: env[`${up}_BITRATE`] ?? base.bitrate,
      sampleRate: base.sampleRate === null ? null : num(env, `${up}_SAMPLE_RATE`, base.sampleRate),
      channels: base.channels === null ? null : num(env, `${up}_CHANNELS`, base.channels)
    };
  });

  return {
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    mediaDir: path.resolve(env.MEDIA_DIR ?? './media'),
    formats,
    convertConcurrency: num(env, 'CONVERT_CONCURRENCY', 4),
    waveformPeaks: num(env, 'WAVEFORM_PEAKS', 2000),
    maxUploadMb: num(env, 'MAX_UPLOAD_MB', 500)
  };
}

/** 프로세스 env로 만든 싱글턴. 라우트와 잡에서 쓴다. */
export const config: AppConfig = loadConfig(process.env);
```

- [ ] **Step 9: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/config.test.ts
```

Expected: PASS — 5 tests

- [ ] **Step 10: .env.example 작성**

```ini
DATA_DIR=./data
MEDIA_DIR=./media

OUTPUT_FORMATS=mp3,wav

MP3_BITRATE=192k
MP3_SAMPLE_RATE=44100
MP3_CHANNELS=2

WAV_CODEC=pcm_s16le
WAV_SAMPLE_RATE=44100
WAV_CHANNELS=1

CONVERT_CONCURRENCY=4
WAVEFORM_PEAKS=2000
MAX_UPLOAD_MB=500
```

- [ ] **Step 11: 커밋**

```bash
git add -A
git commit -m "feat: SvelteKit + Skeleton 스캐폴딩과 설정 모듈

env로 출력 포맷과 포맷별 파라미터를 조정한다.
알 수 없는 포맷은 시작 시점에 거부한다."
```

---

### Task 2: 원자적 JSON 저장소

**Files:**
- Create: `src/lib/server/store/atomic.ts`
- Create: `src/lib/server/store/atomic.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `readJson<T>(filePath: string, fallback: T): Promise<T>`
  - `updateJson<T>(filePath: string, mutate: (current: T) => T, fallback: T): Promise<T>`

  `updateJson`은 같은 경로에 대한 호출을 직렬화한다. Task 3·10이 이것만 쓴다.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/store/atomic.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, updateJson } from './atomic';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-atomic-'));
  file = path.join(dir, 'nested', 'data.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readJson', () => {
  it('파일이 없으면 fallback을 준다', async () => {
    expect(await readJson(file, { n: 0 })).toEqual({ n: 0 });
  });

  it('쓴 값을 그대로 읽는다', async () => {
    await updateJson(file, () => ({ n: 7 }), { n: 0 });
    expect(await readJson(file, { n: 0 })).toEqual({ n: 7 });
  });
});

describe('updateJson', () => {
  it('없는 디렉터리를 만들어서 쓴다', async () => {
    await updateJson(file, () => ({ n: 1 }), { n: 0 });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ n: 1 });
  });

  it('동시 호출에서 갱신이 유실되지 않는다', async () => {
    await Promise.all(
      Array.from({ length: 50 }, () => updateJson(file, (c) => ({ n: c.n + 1 }), { n: 0 }))
    );
    expect((await readJson(file, { n: 0 })).n).toBe(50);
  });

  it('임시 파일을 남기지 않는다', async () => {
    await updateJson(file, () => ({ n: 1 }), { n: 0 });
    const left = await fs.readdir(path.dirname(file));
    expect(left).toEqual(['data.json']);
  });

  it('mutate가 던지면 기존 파일을 훼손하지 않는다', async () => {
    await updateJson(file, () => ({ n: 5 }), { n: 0 });
    await expect(
      updateJson(file, () => {
        throw new Error('boom');
      }, { n: 0 })
    ).rejects.toThrow('boom');
    expect((await readJson(file, { n: 0 })).n).toBe(5);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/store/atomic.test.ts
```

Expected: FAIL — `Failed to resolve import "./atomic"`

- [ ] **Step 3: 구현**

`src/lib/server/store/atomic.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';

/** 경로별 쓰기 직렬화 체인. 같은 파일에 대한 갱신이 겹치지 않게 한다. */
const chains = new Map<string, Promise<unknown>>();

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, filePath);
}

/**
 * 현재 값을 읽어 mutate를 적용하고 원자적으로 쓴다.
 * 같은 filePath에 대한 호출은 순차 실행되므로 갱신이 유실되지 않는다.
 */
export function updateJson<T>(
  filePath: string,
  mutate: (current: T) => T,
  fallback: T
): Promise<T> {
  const prev = chains.get(filePath) ?? Promise.resolve();
  const next = prev.then(
    async () => {
      const current = await readJson(filePath, fallback);
      const updated = mutate(current);
      await writeAtomic(filePath, updated);
      return updated;
    },
    async () => {
      // 앞 작업이 실패해도 체인은 이어간다
      const current = await readJson(filePath, fallback);
      const updated = mutate(current);
      await writeAtomic(filePath, updated);
      return updated;
    }
  );
  chains.set(
    filePath,
    next.catch(() => undefined)
  );
  return next;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/store/atomic.test.ts
```

Expected: PASS — 6 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/store/
git commit -m "feat: 원자적 JSON 저장소

임시파일 → fsync → rename으로 쓰고, 경로별 체인으로 직렬화한다.
동시 갱신 50건에서 유실이 없음을 테스트로 고정했다."
```

---

### Task 3: 녹음 저장소

**Files:**
- Create: `src/lib/server/store/recordings.ts`
- Create: `src/lib/server/store/recordings.test.ts`

**Interfaces:**
- Consumes: `readJson`, `updateJson` (Task 2), `AppConfig`·`Recording`·`RecordingsFile` (Task 1)
- Produces:
  - `newId(): string`
  - `listAll(cfg: AppConfig): Promise<Recording[]>` — `deletedAt`이 null인 것만, `recordedAt` 내림차순
  - `getById(cfg: AppConfig, id: string): Promise<Recording | null>`
  - `addMany(cfg: AppConfig, recs: Recording[]): Promise<void>`
  - `patch(cfg, id: string, changes: Partial<Pick<Recording,'title'|'description'|'tags'|'files'|'bookmarks'>>): Promise<Recording>`
  - `addTags(cfg, ids: string[], tags: string[]): Promise<void>`
  - `removeTags(cfg, ids: string[], tags: string[]): Promise<void>`
  - `softDelete(cfg, ids: string[]): Promise<void>`
  - `allTags(cfg): Promise<{ tag: string; count: number }[]>`
  - `existingSourceNames(cfg): Promise<Set<string>>`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/store/recordings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, Recording } from '$lib/types';
import { loadConfig } from '../config';
import {
  newId, listAll, getById, addMany, patch,
  addTags, removeTags, softDelete, allTags, existingSourceNames
} from './recordings';

let dir: string;
let cfg: AppConfig;

function rec(over: Partial<Recording> = {}): Recording {
  return {
    id: newId(),
    title: '레인',
    description: '',
    tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00',
    durationSec: 274.205,
    sourceName: '20260709 223613-AA3B4246.qta',
    appleAutoTitle: '화양동',
    files: { original: { ext: 'qta', bytes: 100 } },
    bookmarks: [],
    createdAt: '2026-08-31T20:35:00+09:00',
    updatedAt: '2026-08-31T20:35:00+09:00',
    deletedAt: null,
    ...over
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-rec-'));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data'), MEDIA_DIR: path.join(dir, 'media') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('recordings store', () => {
  it('저장소가 비어 있으면 빈 배열이다', async () => {
    expect(await listAll(cfg)).toEqual([]);
    expect(await allTags(cfg)).toEqual([]);
  });

  it('제목이 같아도 서로 다른 항목으로 저장된다', async () => {
    await addMany(cfg, [rec({ title: '화양동' }), rec({ title: '화양동' })]);
    const all = await listAll(cfg);
    expect(all).toHaveLength(2);
    expect(all[0].id).not.toBe(all[1].id);
  });

  it('recordedAt 내림차순으로 준다', async () => {
    await addMany(cfg, [
      rec({ recordedAt: '2026-07-09T22:36:13+09:00', title: '먼저' }),
      rec({ recordedAt: '2026-08-30T19:54:04+09:00', title: '나중' })
    ]);
    expect((await listAll(cfg)).map((r) => r.title)).toEqual(['나중', '먼저']);
  });

  it('patch가 updatedAt을 갱신한다', async () => {
    const r = rec();
    await addMany(cfg, [r]);
    const after = await patch(cfg, r.id, { title: '정류장', tags: ['데모'] });
    expect(after.title).toBe('정류장');
    expect(after.tags).toEqual(['데모']);
    expect(after.updatedAt).not.toBe(r.updatedAt);
  });

  it('없는 id를 patch하면 던진다', async () => {
    await expect(patch(cfg, 'nope', { title: 'x' })).rejects.toThrow(/nope/);
  });

  it('addTags는 중복을 만들지 않는다', async () => {
    const a = rec({ tags: ['데모'] });
    const b = rec({ tags: [] });
    await addMany(cfg, [a, b]);
    await addTags(cfg, [a.id, b.id], ['데모', '1절']);
    const all = await listAll(cfg);
    expect(all.find((r) => r.id === a.id)!.tags.sort()).toEqual(['1절', '데모']);
    expect(all.find((r) => r.id === b.id)!.tags.sort()).toEqual(['1절', '데모']);
  });

  it('removeTags는 지정한 태그만 뺀다', async () => {
    const a = rec({ tags: ['데모', '1절'] });
    await addMany(cfg, [a]);
    await removeTags(cfg, [a.id], ['데모']);
    expect((await getById(cfg, a.id))!.tags).toEqual(['1절']);
  });

  it('소프트 삭제된 항목은 목록과 태그 집계에서 빠진다', async () => {
    const a = rec({ tags: ['데모'] });
    const b = rec({ tags: ['데모'] });
    await addMany(cfg, [a, b]);
    await softDelete(cfg, [a.id]);
    expect(await listAll(cfg)).toHaveLength(1);
    expect(await allTags(cfg)).toEqual([{ tag: '데모', count: 1 }]);
    expect(await getById(cfg, a.id)).toBeNull();
  });

  it('태그 집계는 빈도 내림차순, 동률은 가나다순', async () => {
    await addMany(cfg, [
      rec({ tags: ['가', '나'] }),
      rec({ tags: ['나'] }),
      rec({ tags: ['다'] })
    ]);
    expect(await allTags(cfg)).toEqual([
      { tag: '나', count: 2 },
      { tag: '가', count: 1 },
      { tag: '다', count: 1 }
    ]);
  });

  it('existingSourceNames는 삭제된 것도 포함한다', async () => {
    const a = rec({ sourceName: 'a.qta' });
    await addMany(cfg, [a]);
    await softDelete(cfg, [a.id]);
    expect(await existingSourceNames(cfg)).toEqual(new Set(['a.qta']));
  });
});
```

`existingSourceNames`가 삭제된 항목까지 포함하는 이유는, 지운 파일을 같은 폴더 재스캔에서 다시 끌고 오지 않기 위해서다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/store/recordings.test.ts
```

Expected: FAIL — `Failed to resolve import "./recordings"`

- [ ] **Step 3: 구현**

`src/lib/server/store/recordings.ts`:

```ts
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, Recording, RecordingsFile } from '$lib/types';
import { readJson, updateJson } from './atomic';

const EMPTY: RecordingsFile = { version: 1, recordings: [] };

function file(cfg: AppConfig): string {
  return path.join(cfg.dataDir, 'recordings.json');
}

export function newId(): string {
  return randomUUID();
}

function nowIso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

async function all(cfg: AppConfig): Promise<Recording[]> {
  return (await readJson<RecordingsFile>(file(cfg), EMPTY)).recordings;
}

export async function listAll(cfg: AppConfig): Promise<Recording[]> {
  return (await all(cfg))
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
}

export async function getById(cfg: AppConfig, id: string): Promise<Recording | null> {
  return (await all(cfg)).find((r) => r.id === id && r.deletedAt === null) ?? null;
}

export async function addMany(cfg: AppConfig, recs: Recording[]): Promise<void> {
  await updateJson<RecordingsFile>(
    file(cfg),
    (cur) => ({ ...cur, recordings: [...cur.recordings, ...recs] }),
    EMPTY
  );
}

type Patchable = Partial<Pick<Recording, 'title' | 'description' | 'tags' | 'files' | 'bookmarks'>>;

export async function patch(cfg: AppConfig, id: string, changes: Patchable): Promise<Recording> {
  let out: Recording | null = null;
  await updateJson<RecordingsFile>(
    file(cfg),
    (cur) => {
      const i = cur.recordings.findIndex((r) => r.id === id && r.deletedAt === null);
      if (i === -1) throw new Error(`녹음을 찾을 수 없습니다: ${id}`);
      out = { ...cur.recordings[i], ...changes, updatedAt: nowIso() };
      const next = cur.recordings.slice();
      next[i] = out;
      return { ...cur, recordings: next };
    },
    EMPTY
  );
  return out!;
}

function mapIds(
  cfg: AppConfig,
  ids: string[],
  fn: (r: Recording) => Recording
): Promise<RecordingsFile> {
  const set = new Set(ids);
  return updateJson<RecordingsFile>(
    file(cfg),
    (cur) => ({
      ...cur,
      recordings: cur.recordings.map((r) => (set.has(r.id) ? fn(r) : r))
    }),
    EMPTY
  );
}

export async function addTags(cfg: AppConfig, ids: string[], tags: string[]): Promise<void> {
  await mapIds(cfg, ids, (r) => ({
    ...r,
    tags: Array.from(new Set([...r.tags, ...tags])),
    updatedAt: nowIso()
  }));
}

export async function removeTags(cfg: AppConfig, ids: string[], tags: string[]): Promise<void> {
  const drop = new Set(tags);
  await mapIds(cfg, ids, (r) => ({
    ...r,
    tags: r.tags.filter((t) => !drop.has(t)),
    updatedAt: nowIso()
  }));
}

export async function softDelete(cfg: AppConfig, ids: string[]): Promise<void> {
  const at = nowIso();
  await mapIds(cfg, ids, (r) => ({ ...r, deletedAt: at, updatedAt: at }));
}

export async function allTags(cfg: AppConfig): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const r of await listAll(cfg)) {
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko')
  );
}

/** 삭제된 항목의 원본명도 포함한다. 재스캔에서 다시 끌려오지 않게 하기 위해서다. */
export async function existingSourceNames(cfg: AppConfig): Promise<Set<string>> {
  return new Set((await all(cfg)).map((r) => r.sourceName));
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/store/recordings.test.ts
```

Expected: PASS — 10 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/store/
git commit -m "feat: 녹음 저장소

CRUD, 태그 일괄 추가/제거, 소프트 삭제, 태그 집계.
삭제된 항목의 원본명은 재스캔 중복 감지를 위해 남긴다."
```

---

### Task 4: 필터

**Files:**
- Create: `src/lib/filter.ts`
- Create: `src/lib/filter.test.ts`

`src/lib/server/`가 아니라 `src/lib/`에 둔다. 서버 로딩과 클라이언트 즉시 필터링 양쪽에서 쓰는 순수 함수이기 때문이다.

**Interfaces:**
- Consumes: `Recording`, `Filter`, `TagMode` (Task 1)
- Produces:
  - `EMPTY_FILTER: Filter`
  - `applyFilter(recs: Recording[], f: Filter): Recording[]`
  - `filterFromParams(params: URLSearchParams): Filter`
  - `filterToParams(f: Filter): URLSearchParams`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Filter, Recording } from './types';
import { EMPTY_FILTER, applyFilter, filterFromParams, filterToParams } from './filter';

function rec(over: Partial<Recording>): Recording {
  return {
    id: over.id ?? 'x', title: '레인', description: '', tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00', durationSec: 1, sourceName: 's.qta',
    appleAutoTitle: '화양동', files: {}, bookmarks: [],
    createdAt: '', updatedAt: '', deletedAt: null, ...over
  };
}

const data = [
  rec({ id: '1', title: '레인', tags: ['데모', '1절'], recordedAt: '2026-07-09T22:36:13+09:00' }),
  rec({ id: '2', title: '정류장', tags: ['데모'], recordedAt: '2026-07-15T10:00:00+09:00' }),
  rec({ id: '3', title: '빨래', tags: ['1절'], recordedAt: '2026-08-30T19:54:04+09:00' })
];

const ids = (f: Partial<Filter>) => applyFilter(data, { ...EMPTY_FILTER, ...f }).map((r) => r.id);

describe('applyFilter', () => {
  it('빈 필터는 전부 통과시킨다', () => {
    expect(ids({})).toEqual(['1', '2', '3']);
  });

  it('제목 부분일치, 대소문자 무시', () => {
    expect(ids({ q: '류' })).toEqual(['2']);
    expect(ids({ q: 'RAIN' })).toEqual([]);
  });

  it('제목만 검색하고 appleAutoTitle은 보지 않는다', () => {
    expect(ids({ q: '화양동' })).toEqual([]);
  });

  it('태그 AND는 전부 가진 것만', () => {
    expect(ids({ tags: ['데모', '1절'], tagMode: 'and' })).toEqual(['1']);
  });

  it('태그 OR는 하나라도 가진 것', () => {
    expect(ids({ tags: ['데모', '1절'], tagMode: 'or' })).toEqual(['1', '2', '3']);
  });

  it('날짜 범위는 양끝을 포함한다', () => {
    expect(ids({ from: '2026-07-09', to: '2026-07-09' })).toEqual(['1']);
    expect(ids({ from: '2026-07-15' })).toEqual(['2', '3']);
    expect(ids({ to: '2026-07-15' })).toEqual(['1', '2']);
  });

  it('세 조건은 AND로 결합된다', () => {
    expect(ids({ q: '레', tags: ['데모'], tagMode: 'and', from: '2026-07-01' })).toEqual(['1']);
    expect(ids({ q: '레', tags: ['없는태그'], tagMode: 'and' })).toEqual([]);
  });
});

describe('URL 왕복', () => {
  it('파라미터를 필터로 읽는다', () => {
    const f = filterFromParams(new URLSearchParams('q=레&tags=데모&tags=1절&mode=or&from=2026-07-01'));
    expect(f).toEqual({ q: '레', tags: ['데모', '1절'], tagMode: 'or', from: '2026-07-01', to: '' });
  });

  it('쉼표는 구분자가 아니라 태그 내용이다', () => {
    expect(filterFromParams(new URLSearchParams('tags=lo-fi,demo')).tags).toEqual(['lo-fi,demo']);
  });

  it('쉼표가 든 태그도 왕복에서 온전하다', () => {
    const f = { ...EMPTY_FILTER, tags: ['lo-fi,demo'] };
    expect(filterFromParams(filterToParams(f)).tags).toEqual(['lo-fi,demo']);
  });

  it('mode가 없으면 and가 기본이다', () => {
    expect(filterFromParams(new URLSearchParams('')).tagMode).toBe('and');
  });

  it('빈 값은 파라미터로 내보내지 않는다', () => {
    expect(filterToParams(EMPTY_FILTER).toString()).toBe('');
  });

  it('필터 → 파라미터 → 필터가 보존된다', () => {
    const f = { q: '레인', tags: ['데모'], tagMode: 'or' as const, from: '2026-07-01', to: '2026-08-01' };
    expect(filterFromParams(filterToParams(f))).toEqual(f);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/filter.test.ts
```

Expected: FAIL — `Failed to resolve import "./filter"`

- [ ] **Step 3: 구현**

`src/lib/filter.ts`:

```ts
import type { Filter, Recording, TagMode } from './types';

/**
 * 빈 필터의 기준값. 호출부가 `{ ...EMPTY_FILTER, ...f }`로 필터를 만드는데,
 * `tags`를 덮어쓰지 않으면 같은 배열 참조를 물려받는다. 얼려두면 실수로
 * 밀어넣었을 때 조용히 공유 상태가 오염되는 대신 즉시 터진다.
 */
export const EMPTY_FILTER: Filter = { q: '', tags: [], tagMode: 'and', from: '', to: '' };
Object.freeze(EMPTY_FILTER.tags);
Object.freeze(EMPTY_FILTER);

/** recordedAt의 날짜 부분만 뽑는다. 오프셋이 붙어 있으므로 앞 10글자가 로컬 날짜다. */
function localDate(recordedAt: string): string {
  return recordedAt.slice(0, 10);
}

export function applyFilter(recs: Recording[], f: Filter): Recording[] {
  const q = f.q.trim().toLowerCase();
  const tags = f.tags.filter(Boolean);

  return recs.filter((r) => {
    if (q && !r.title.toLowerCase().includes(q)) return false;

    if (tags.length) {
      const has = (t: string) => r.tags.includes(t);
      if (f.tagMode === 'and' ? !tags.every(has) : !tags.some(has)) return false;
    }

    const d = localDate(r.recordedAt);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;

    return true;
  });
}

/**
 * 태그는 쉼표로 잇지 않고 파라미터를 반복해서 담는다(`tags=a&tags=b`).
 * 태그는 사용자가 자유롭게 입력하는 값이라 쉼표가 들어갈 수 있는데,
 * 쉼표를 구분자로 쓰면 그런 태그가 조용히 둘로 쪼개진다.
 */
export function filterFromParams(params: URLSearchParams): Filter {
  const mode = params.get('mode');
  return {
    q: params.get('q') ?? '',
    tags: params.getAll('tags').map((s) => s.trim()).filter(Boolean),
    tagMode: (mode === 'or' ? 'or' : 'and') as TagMode,
    from: params.get('from') ?? '',
    to: params.get('to') ?? ''
  };
}

export function filterToParams(f: Filter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  for (const tag of f.tags) p.append('tags', tag);
  if (f.tagMode === 'or') p.set('mode', 'or');
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  return p;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/filter.test.ts
```

Expected: PASS — 11 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/filter.ts src/lib/filter.test.ts
git commit -m "feat: 목록 필터

제목 부분일치, 태그 AND/OR, 날짜 범위를 AND로 결합한다.
제목 검색은 title만 보고 appleAutoTitle은 제외한다."
```

---

### Task 5: Apple CloudRecordings.db 리더

**Files:**
- Create: `src/lib/server/apple/cloudRecordings.ts`
- Create: `src/lib/server/apple/cloudRecordings.test.ts`
- Create: `tests/fixtures/CloudRecordings.db` (스텝 1에서 생성)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `AppleEntry { title: string; recordedAt: string; durationSec: number }`
  - `findDbPath(folder: string): Promise<string | null>`
  - `readTitleMap(dbPath: string): Promise<Map<string, AppleEntry>>` — 키는 파일명(`ZPATH`)

- [ ] **Step 1: 픽스처 DB 생성**

실제 DB에서 4행만 뽑아 새 DB를 만든다. 오디오 픽스처 2개와 제목이 갈리는 사례 2개다.

```bash
mkdir -p tests/fixtures/audio
SRC=~/Dev/SIDE_PROJECT/_voice_sample
sqlite3 "$SRC/CloudRecordings.db" ".schema ZCLOUDRECORDING" \
  | grep -v '^CREATE TRIGGER' | grep -v '^CREATE INDEX' > /tmp/uls-schema.sql
rm -f tests/fixtures/CloudRecordings.db
sqlite3 tests/fixtures/CloudRecordings.db < /tmp/uls-schema.sql
sqlite3 "$SRC/CloudRecordings.db" \
  ".mode insert ZCLOUDRECORDING" \
  "SELECT * FROM ZCLOUDRECORDING WHERE ZPATH IN (
     '20260711 181530-1923A106.qta',
     '20260725 210049-B752B57A.m4a',
     '20260725 005422-39A2B8E8.m4a',
     '20260830 194216-6C5B2224.m4a');" \
  | sqlite3 tests/fixtures/CloudRecordings.db
sqlite3 tests/fixtures/CloudRecordings.db \
  "SELECT ZPATH, ZENCRYPTEDTITLE FROM ZCLOUDRECORDING;"
```

Expected: 4행이 출력되고 그중 `20260725 005422-39A2B8E8.m4a|비와 당신`이 있다.

- [ ] **Step 2: 오디오 픽스처 복사**

```bash
SRC=~/Dev/SIDE_PROJECT/_voice_sample
cp "$SRC/20260711 181530-1923A106.qta" tests/fixtures/audio/spatial.qta
cp "$SRC/20260725 210049-B752B57A.m4a" tests/fixtures/audio/plain.m4a
ls -lh tests/fixtures/audio/
```

Expected: `spatial.qta` 약 176KB, `plain.m4a` 약 12KB

- [ ] **Step 3: 실패 테스트 작성**

`src/lib/server/apple/cloudRecordings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findDbPath, readTitleMap } from './cloudRecordings';

const FIXTURE = path.resolve('tests/fixtures/CloudRecordings.db');

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-apple-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readTitleMap', () => {
  it('파일명을 키로 항목을 준다', async () => {
    const map = await readTitleMap(FIXTURE);
    expect(map.size).toBe(4);
    expect(map.has('20260711 181530-1923A106.qta')).toBe(true);
  });

  it('사용자가 지정한 제목을 준다 (파일 메타의 위치 이름이 아니다)', async () => {
    const map = await readTitleMap(FIXTURE);
    // 이 파일의 format_tags.title은 '화양동 13'이지만 사용자가 붙인 제목은 다르다
    expect(map.get('20260725 005422-39A2B8E8.m4a')!.title).toBe('비와 당신');
    expect(map.get('20260830 194216-6C5B2224.m4a')!.title).toBe('울든 꽃에 물을주듯');
  });

  it('ZDATE를 오프셋 포함 ISO로 변환한다', async () => {
    const map = await readTitleMap(FIXTURE);
    const e = map.get('20260711 181530-1923A106.qta')!;
    expect(e.recordedAt).toMatch(/^2026-07-11T18:15:30[+-]\d{2}:\d{2}$/);
  });

  it('길이를 준다', async () => {
    const map = await readTitleMap(FIXTURE);
    expect(map.get('20260711 181530-1923A106.qta')!.durationSec).toBeCloseTo(2.277, 2);
  });

  it('원본 DB를 수정하지 않는다', async () => {
    const before = await fs.readFile(FIXTURE);
    await readTitleMap(FIXTURE);
    expect(await fs.readFile(FIXTURE)).toEqual(before);
  });

  it('DB가 아닌 파일이면 던진다', async () => {
    const bad = path.join(dir, 'nope.db');
    await fs.writeFile(bad, 'not a database');
    await expect(readTitleMap(bad)).rejects.toThrow();
  });
});

describe('findDbPath', () => {
  it('폴더에서 CloudRecordings.db를 찾는다', async () => {
    await fs.copyFile(FIXTURE, path.join(dir, 'CloudRecordings.db'));
    expect(await findDbPath(dir)).toBe(path.join(dir, 'CloudRecordings.db'));
  });

  it('없으면 null을 준다', async () => {
    expect(await findDbPath(dir)).toBeNull();
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/apple/cloudRecordings.test.ts
```

Expected: FAIL — `Failed to resolve import "./cloudRecordings"`

- [ ] **Step 5: 구현**

`src/lib/server/apple/cloudRecordings.ts`:

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface AppleEntry {
  title: string;
  recordedAt: string;
  durationSec: number;
}

const DB_NAME = 'CloudRecordings.db';
/** Core Data 기준 시각(2001-01-01)과 unix epoch의 차이 */
const CORE_DATA_EPOCH = 978_307_200;

export async function findDbPath(folder: string): Promise<string | null> {
  const p = path.join(folder, DB_NAME);
  try {
    await fs.access(p);
    return p;
  } catch {
    return null;
  }
}

function toIsoWithOffset(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

/**
 * CloudRecordings.db에서 파일명 → 제목·녹음시각·길이 맵을 만든다.
 *
 * 제목은 ZENCRYPTEDTITLE에서 온다. 컬럼명과 달리 평문이며, 사용자가 지정한
 * 제목이 여기 들어간다. 파일 메타데이터의 title은 애플이 위치 기반으로
 * 자동 생성한 이름이라 사용자 제목과 다르다.
 *
 * DB는 WAL 모드다. -wal/-shm이 함께 있어야 최신 내용이 보이므로 셋을 임시
 * 위치로 복사한 뒤 읽는다. 원본은 손대지 않는다.
 */
export async function readTitleMap(dbPath: string): Promise<Map<string, AppleEntry>> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-cloudrec-'));
  const copy = path.join(tmp, DB_NAME);
  try {
    await fs.copyFile(dbPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      try {
        await fs.copyFile(dbPath + suffix, copy + suffix);
      } catch {
        // 없으면 넘어간다. 체크포인트가 끝난 DB에는 없다.
      }
    }

    const db = new Database(copy, { readonly: true });
    try {
      const rows = db
        .prepare(
          `SELECT ZPATH AS p, ZENCRYPTEDTITLE AS t, ZDATE AS d, ZDURATION AS dur
             FROM ZCLOUDRECORDING
            WHERE ZPATH IS NOT NULL`
        )
        .all() as { p: string; t: string | null; d: number | null; dur: number | null }[];

      const map = new Map<string, AppleEntry>();
      for (const r of rows) {
        map.set(r.p, {
          title: r.t ?? '',
          recordedAt: r.d === null ? '' : toIsoWithOffset(r.d + CORE_DATA_EPOCH),
          durationSec: r.dur ?? 0
        });
      }
      return map;
    } finally {
      db.close();
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/apple/cloudRecordings.test.ts
```

Expected: PASS — 8 tests

- [ ] **Step 7: 커밋**

```bash
git add src/lib/server/apple/ tests/fixtures/
git commit -m "feat: CloudRecordings.db 리더

사용자 지정 제목은 파일 메타가 아니라 ZENCRYPTEDTITLE에 있다.
WAL 파일까지 임시 위치로 복사해 읽기 전용으로 연다."
```

---

### Task 6: ffprobe 메타 추출과 스트림 선택

**Files:**
- Create: `src/lib/server/media/probe.ts`
- Create: `src/lib/server/media/probe.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `UNDECODABLE_CODECS: Set<string>`
  - `ProbeResult { durationSec, title, creationTime, audioStreamIndex, codecName, channels }`
  - `probe(filePath: string): Promise<ProbeResult>` — `audioStreamIndex`는 **절대 스트림 인덱스**이며 `-map 0:<index>`에 그대로 쓴다

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/media/probe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { probe, UNDECODABLE_CODECS } from './probe';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const PLAIN = path.resolve('tests/fixtures/audio/plain.m4a');

describe('probe', () => {
  it('공간 음향 qta에서 apple_apac이 아닌 스트림을 고른다', async () => {
    const r = await probe(SPATIAL);
    // 이 파일은 [0]aac 2ch + [1]apple_apac 4ch 구성이다
    expect(r.audioStreamIndex).toBe(0);
    expect(r.codecName).toBe('aac');
    expect(r.channels).toBe(2);
  });

  it('절대 인덱스가 apple_apac을 가리키지 않는다', async () => {
    const r = await probe(SPATIAL);
    expect(UNDECODABLE_CODECS.has(r.codecName)).toBe(false);
  });

  it('길이를 준다', async () => {
    expect((await probe(SPATIAL)).durationSec).toBeCloseTo(2.2767, 3);
    expect((await probe(PLAIN)).durationSec).toBeCloseTo(1.2587, 3);
  });

  it('파일 메타의 title을 준다 (애플 자동 생성 이름)', async () => {
    expect((await probe(SPATIAL)).title).toBe('새로운 녹음 2');
    expect((await probe(PLAIN)).title).toBe('화양동 16 2');
  });

  it('creation_time을 UTC ISO로 준다', async () => {
    expect((await probe(SPATIAL)).creationTime).toBe('2026-07-11T09:15:30.000000Z');
  });

  it('단일 스트림 m4a도 처리한다', async () => {
    const r = await probe(PLAIN);
    expect(r.audioStreamIndex).toBe(0);
    expect(r.channels).toBe(1);
  });

  it('없는 파일이면 던진다', async () => {
    await expect(probe('/nope/nope.m4a')).rejects.toThrow();
  });

  it('오디오가 아닌 파일이면 던진다', async () => {
    await expect(probe(path.resolve('package.json'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/media/probe.test.ts
```

Expected: FAIL — `Failed to resolve import "./probe"`

- [ ] **Step 3: 구현**

`src/lib/server/media/probe.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * ffmpeg에 디코더가 없는 코덱. 이 스트림을 -map으로 지정하면
 * "no decoder found"로 변환 전체가 실패한다.
 */
export const UNDECODABLE_CODECS = new Set(['apple_apac']);

export interface ProbeResult {
  durationSec: number;
  /** 파일 메타의 title. 애플이 위치 기반으로 자동 생성한 이름이다. */
  title: string | null;
  /** UTC ISO 문자열 그대로 */
  creationTime: string | null;
  /** 절대 스트림 인덱스. -map 0:<index>에 그대로 쓴다. */
  audioStreamIndex: number;
  codecName: string;
  channels: number;
}

interface RawStream {
  index: number;
  codec_name?: string;
  codec_type?: string;
  channels?: number;
}

interface RawProbe {
  streams?: RawStream[];
  format?: { duration?: string; tags?: Record<string, string> };
}

export async function probe(filePath: string): Promise<ProbeResult> {
  let stdout: string;
  try {
    ({ stdout } = await run('ffprobe', [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      filePath
    ]));
  } catch (err) {
    throw new Error(`ffprobe 실패: ${filePath} — ${(err as Error).message}`);
  }

  const raw = JSON.parse(stdout) as RawProbe;
  const audio = (raw.streams ?? []).filter((s) => s.codec_type === 'audio');
  if (audio.length === 0) throw new Error(`오디오 스트림이 없습니다: ${filePath}`);

  const usable = audio.find((s) => !UNDECODABLE_CODECS.has(s.codec_name ?? ''));
  if (!usable) {
    throw new Error(
      `디코딩 가능한 오디오 스트림이 없습니다: ${filePath} ` +
        `(${audio.map((s) => s.codec_name).join(', ')})`
    );
  }

  const duration = Number(raw.format?.duration);
  if (!Number.isFinite(duration)) throw new Error(`길이를 읽을 수 없습니다: ${filePath}`);

  const tags = raw.format?.tags ?? {};
  return {
    durationSec: duration,
    title: tags.title ?? null,
    creationTime: tags.creation_time ?? null,
    audioStreamIndex: usable.index,
    codecName: usable.codec_name ?? '',
    channels: usable.channels ?? 0
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/media/probe.test.ts
```

Expected: PASS — 8 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/media/
git commit -m "feat: ffprobe 메타 추출과 스트림 선택

apple_apac이 아닌 첫 오디오 스트림의 절대 인덱스를 고른다.
인덱스를 하드코딩하면 APAC이 먼저 오는 파일에서 전체가 실패한다."
```

---

### Task 7: ffmpeg 변환

**Files:**
- Create: `src/lib/server/media/convert.ts`
- Create: `src/lib/server/media/convert.test.ts`

**Interfaces:**
- Consumes: `FormatSpec` (Task 1), `probe` (Task 6)
- Produces: `convert(input: string, output: string, streamIndex: number, spec: FormatSpec): Promise<void>`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/media/convert.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FormatSpec } from '$lib/types';
import { loadConfig } from '../config';
import { probe } from './probe';
import { convert } from './convert';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const { formats } = loadConfig({});
const MP3 = formats.find((f) => f.name === 'mp3')!;
const WAV = formats.find((f) => f.name === 'wav')!;

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-convert-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('convert', () => {
  it('qta를 mp3로 바꾸고 길이를 보존한다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const out = path.join(dir, 'a.mp3');
    await convert(SPATIAL, out, audioStreamIndex, MP3);

    const r = await probe(out);
    expect(r.codecName).toBe('mp3');
    expect(r.durationSec).toBeCloseTo(2.2767, 1);
  });

  it('wav 설정의 채널·샘플레이트를 따른다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const out = path.join(dir, 'a.wav');
    await convert(SPATIAL, out, audioStreamIndex, WAV);

    const r = await probe(out);
    expect(r.channels).toBe(1);
  });

  it('apple_apac 스트림을 지정하면 실패한다', async () => {
    const out = path.join(dir, 'bad.mp3');
    // spatial.qta의 인덱스 1은 apple_apac이다
    await expect(convert(SPATIAL, out, 1, MP3)).rejects.toThrow(/apple_apac|decoder/i);
  });

  it('실패 시 부분 출력 파일을 남기지 않는다', async () => {
    const out = path.join(dir, 'bad.mp3');
    await expect(convert(SPATIAL, out, 1, MP3)).rejects.toThrow();
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('출력 디렉터리가 없으면 만든다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const out = path.join(dir, 'deep', 'nested', 'a.mp3');
    await convert(SPATIAL, out, audioStreamIndex, MP3);
    expect((await fs.stat(out)).size).toBeGreaterThan(0);
  });

  it('bitrate가 null인 포맷은 -b:a를 붙이지 않는다', async () => {
    const spec: FormatSpec = { ...WAV, sampleRate: 8000, channels: 1 };
    const { audioStreamIndex } = await probe(SPATIAL);
    const out = path.join(dir, 'b.wav');
    await convert(SPATIAL, out, audioStreamIndex, spec);
    expect((await fs.stat(out)).size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/media/convert.test.ts
```

Expected: FAIL — `Failed to resolve import "./convert"`

- [ ] **Step 3: 구현**

`src/lib/server/media/convert.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FormatSpec } from '$lib/types';

const run = promisify(execFile);

/**
 * 지정한 절대 스트림 인덱스 하나만 뽑아 spec대로 인코딩한다.
 *
 * streamIndex는 ffprobe가 준 절대 인덱스여야 한다. `-map 0:a:0` 같은
 * 오디오 상대 인덱스를 쓰면 어느 트랙이 잡혔는지 알 수 없다.
 */
export async function convert(
  input: string,
  output: string,
  streamIndex: number,
  spec: FormatSpec
): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true });

  const args = ['-y', '-v', 'error', '-i', input, '-map', `0:${streamIndex}`, '-c:a', spec.codec];
  if (spec.bitrate) args.push('-b:a', spec.bitrate);
  if (spec.sampleRate) args.push('-ar', String(spec.sampleRate));
  if (spec.channels) args.push('-ac', String(spec.channels));
  args.push(output);

  try {
    await run('ffmpeg', args);
  } catch (err) {
    // ffmpeg가 실패하면 잘린 출력이 남을 수 있다. 재시도가 깨끗하도록 지운다.
    await fs.rm(output, { force: true });
    const e = err as { stderr?: string; message: string };
    throw new Error(`변환 실패 (${spec.name}): ${(e.stderr ?? e.message).trim()}`);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/media/convert.test.ts
```

Expected: PASS — 6 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/media/
git commit -m "feat: ffmpeg 변환

절대 스트림 인덱스를 -map으로 명시하고 포맷 스펙대로 인코딩한다.
실패하면 잘린 출력 파일을 지워 재시도가 깨끗하게 한다."
```

---

### Task 8: 파형 피크 생성

**Files:**
- Create: `src/lib/server/media/waveform.ts`
- Create: `src/lib/server/media/waveform.test.ts`
- Create: `src/lib/server/store/waveforms.ts`
- Create: `src/lib/server/store/waveforms.test.ts`

**Interfaces:**
- Consumes: `probe` (Task 6), `readJson`/`updateJson` (Task 2), `AppConfig` (Task 1)
- Produces:
  - `generatePeaks(input: string, streamIndex: number, peaks: number): Promise<number[]>` — 길이 `peaks`, 값은 0~1
  - `savePeaks(cfg: AppConfig, id: string, peaks: number[]): Promise<void>`
  - `loadPeaks(cfg: AppConfig, id: string): Promise<number[] | null>`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/media/waveform.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { probe } from './probe';
import { generatePeaks } from './waveform';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');

describe('generatePeaks', () => {
  it('요청한 개수만큼 준다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    expect(await generatePeaks(SPATIAL, audioStreamIndex, 100)).toHaveLength(100);
    expect(await generatePeaks(SPATIAL, audioStreamIndex, 7)).toHaveLength(7);
  });

  it('모든 값이 0과 1 사이다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const peaks = await generatePeaks(SPATIAL, audioStreamIndex, 200);
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('무음이 아니다', async () => {
    const { audioStreamIndex } = await probe(SPATIAL);
    const peaks = await generatePeaks(SPATIAL, audioStreamIndex, 200);
    expect(Math.max(...peaks)).toBeGreaterThan(0.01);
  });

  it('디코딩 불가 스트림을 지정하면 던진다', async () => {
    await expect(generatePeaks(SPATIAL, 1, 100)).rejects.toThrow();
  });
});
```

`src/lib/server/store/waveforms.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config';
import { savePeaks, loadPeaks } from './waveforms';

let dir: string;
let cfg: ReturnType<typeof loadConfig>;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-wave-'));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data') });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('waveforms store', () => {
  it('없으면 null이다', async () => {
    expect(await loadPeaks(cfg, 'nope')).toBeNull();
  });

  it('저장한 피크를 그대로 읽는다', async () => {
    await savePeaks(cfg, 'abc', [0, 0.5, 1]);
    expect(await loadPeaks(cfg, 'abc')).toEqual([0, 0.5, 1]);
  });

  it('recordings.json과 분리된 파일에 쓴다', async () => {
    await savePeaks(cfg, 'abc', [0.1]);
    const files = await fs.readdir(path.join(cfg.dataDir, 'waveforms'));
    expect(files).toEqual(['abc.json']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/media/waveform.test.ts src/lib/server/store/waveforms.test.ts
```

Expected: FAIL — `Failed to resolve import "./waveform"` / `"./waveforms"`

- [ ] **Step 3: 피크 생성 구현**

`src/lib/server/media/waveform.ts`:

```ts
import { spawn } from 'node:child_process';

/** 피크 계산용 디코딩 샘플레이트. 파형 표시에는 이 정도면 충분하다. */
const PEAK_SAMPLE_RATE = 8000;

/**
 * 8kHz 모노 PCM을 파이프로 받아 구간별 최대 진폭만 남긴다.
 * 중간 PCM은 디스크에 쓰지 않는다.
 */
export function generatePeaks(
  input: string,
  streamIndex: number,
  peaks: number
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-v', 'error',
      '-i', input,
      '-map', `0:${streamIndex}`,
      '-ac', '1',
      '-ar', String(PEAK_SAMPLE_RATE),
      '-f', 's16le',
      '-'
    ]);

    const maxima: number[] = [];
    let leftover: Buffer = Buffer.alloc(0);
    let stderr = '';

    ff.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    ff.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        maxima.push(Math.abs(buf.readInt16LE(i)) / 32768);
      }
      leftover = buf.subarray(usable);
    });

    ff.on('error', reject);

    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`파형 생성 실패: ${stderr.trim() || `ffmpeg exit ${code}`}`));
        return;
      }
      if (maxima.length === 0) {
        reject(new Error('파형 생성 실패: 샘플이 없습니다'));
        return;
      }

      // 전체 샘플을 peaks개 구간으로 나눠 각 구간의 최대 진폭을 남긴다
      const out = new Array<number>(peaks);
      const per = maxima.length / peaks;
      for (let i = 0; i < peaks; i++) {
        const start = Math.floor(i * per);
        const end = Math.max(start + 1, Math.floor((i + 1) * per));
        let m = 0;
        for (let j = start; j < end && j < maxima.length; j++) {
          if (maxima[j] > m) m = maxima[j];
        }
        out[i] = m;
      }
      resolve(out);
    });
  });
}
```

- [ ] **Step 4: 피크 저장소 구현**

`src/lib/server/store/waveforms.ts`:

```ts
import path from 'node:path';
import type { AppConfig } from '$lib/types';
import { readJson, updateJson } from './atomic';

function file(cfg: AppConfig, id: string): string {
  return path.join(cfg.dataDir, 'waveforms', `${id}.json`);
}

export async function savePeaks(cfg: AppConfig, id: string, peaks: number[]): Promise<void> {
  await updateJson<number[]>(file(cfg, id), () => peaks, []);
}

export async function loadPeaks(cfg: AppConfig, id: string): Promise<number[] | null> {
  const sentinel: number[] | null = null;
  return readJson<number[] | null>(file(cfg, id), sentinel);
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/media/waveform.test.ts src/lib/server/store/waveforms.test.ts
```

Expected: PASS — 7 tests

- [ ] **Step 6: 커밋**

```bash
git add src/lib/server/
git commit -m "feat: 파형 피크 생성과 저장

8kHz 모노 PCM을 파이프로 받아 구간 최대 진폭만 남긴다.
피크는 recordings.json이 아니라 항목별 파일로 분리해 둔다."
```

---

### Task 9: 폴더 스캔

**Files:**
- Create: `src/lib/server/scan.ts`
- Create: `src/lib/server/scan.test.ts`

**Interfaces:**
- Consumes: `probe` (Task 6), `findDbPath`·`readTitleMap` (Task 5), `existingSourceNames`·`compareByRecordedAtDesc` (Task 3), `AppConfig`·`ScanItem` (Task 1)
- Produces:
  - `AUDIO_EXTENSIONS: Set<string>`
  - `scanFolder(cfg: AppConfig, folder: string): Promise<ScanItem[]>`

`compareByRecordedAtDesc`는 Task 3에서 정의한 것을 그대로 쓴다. 정렬 규칙(실제 시각 비교, 날짜 없는 항목은 뒤로)이 저장소와 스캔 두 곳에 갈라져 있으면 어긋나기 쉽다.

제목 우선순위는 **DB 제목 → 파일 메타 title → 확장자 뗀 파일명** 순이다.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/scan.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, Recording } from '$lib/types';
import { loadConfig } from './config';
import { addMany, newId } from './store/recordings';
import { scanFolder } from './scan';

const FIX_DB = path.resolve('tests/fixtures/CloudRecordings.db');
const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const PLAIN = path.resolve('tests/fixtures/audio/plain.m4a');

const QTA_NAME = '20260711 181530-1923A106.qta';
const M4A_NAME = '20260725 210049-B752B57A.m4a';

let dir: string;
let src: string;
let cfg: AppConfig;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-scan-'));
  src = path.join(dir, 'src');
  await fs.mkdir(src, { recursive: true });
  await fs.copyFile(SPATIAL, path.join(src, QTA_NAME));
  await fs.copyFile(PLAIN, path.join(src, M4A_NAME));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data'), MEDIA_DIR: path.join(dir, 'media') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('scanFolder', () => {
  it('오디오 파일만 집어온다', async () => {
    await fs.writeFile(path.join(src, 'notes.txt'), 'x');
    await fs.writeFile(path.join(src, 'a-track0.waveform'), 'x');
    const items = await scanFolder(cfg, src);
    expect(items.map((i) => i.sourceName).sort()).toEqual([M4A_NAME, QTA_NAME].sort());
  });

  it('DB가 있으면 사용자 제목을 쓴다', async () => {
    await fs.copyFile(FIX_DB, path.join(src, 'CloudRecordings.db'));
    const items = await scanFolder(cfg, src);
    const qta = items.find((i) => i.sourceName === QTA_NAME)!;
    expect(qta.title).toBe('새로운 녹음 2');
    expect(qta.appleAutoTitle).toBe('새로운 녹음 2');
  });

  it('DB가 없으면 파일 메타 title로 대체하고 계속 진행한다', async () => {
    const items = await scanFolder(cfg, src);
    const qta = items.find((i) => i.sourceName === QTA_NAME)!;
    expect(qta.title).toBe('새로운 녹음 2');
    expect(qta.error).toBeNull();
  });

  it('디코딩 가능한 스트림 인덱스를 담는다', async () => {
    const items = await scanFolder(cfg, src);
    expect(items.find((i) => i.sourceName === QTA_NAME)!.audioStreamIndex).toBe(0);
  });

  it('이미 등록된 원본명은 duplicate로 표시한다', async () => {
    const existing: Recording = {
      id: newId(), title: 'x', description: '', tags: [],
      recordedAt: '2026-07-11T18:15:30+09:00', durationSec: 2.2767,
      sourceName: QTA_NAME, appleAutoTitle: null,
      files: {}, bookmarks: [], createdAt: '', updatedAt: '', deletedAt: null
    };
    await addMany(cfg, [existing]);
    const items = await scanFolder(cfg, src);
    expect(items.find((i) => i.sourceName === QTA_NAME)!.duplicate).toBe(true);
    expect(items.find((i) => i.sourceName === M4A_NAME)!.duplicate).toBe(false);
  });

  it('손상 파일은 error를 달고 나머지는 계속 처리한다', async () => {
    await fs.writeFile(path.join(src, 'broken.m4a'), 'not audio');
    const items = await scanFolder(cfg, src);
    const broken = items.find((i) => i.sourceName === 'broken.m4a')!;
    expect(broken.error).toBeTruthy();
    expect(items.find((i) => i.sourceName === QTA_NAME)!.error).toBeNull();
  });

  it('recordedAt 내림차순으로 준다', async () => {
    const items = await scanFolder(cfg, src);
    expect(items[0].sourceName).toBe(M4A_NAME); // 07-25가 07-11보다 나중
  });

  it('없는 폴더면 던진다', async () => {
    await expect(scanFolder(cfg, path.join(dir, 'nope'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/scan.test.ts
```

Expected: FAIL — `Failed to resolve import "./scan"`

- [ ] **Step 3: 구현**

`src/lib/server/scan.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, ScanItem } from '$lib/types';
import { probe } from './media/probe';
import { findDbPath, readTitleMap, type AppleEntry } from './apple/cloudRecordings';
import { existingSourceNames, compareByRecordedAtDesc } from './store/recordings';

export const AUDIO_EXTENSIONS = new Set([
  '.qta', '.m4a', '.mp3', '.wav', '.aac', '.caf', '.aiff', '.aif', '.flac', '.ogg', '.opus'
]);

/** UTC ISO를 로컬 오프셋 표기로 바꾼다. */
function toLocalIso(utcIso: string): string {
  const d = new Date(utcIso);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

async function inspect(
  filePath: string,
  name: string,
  apple: AppleEntry | undefined,
  duplicate: boolean
): Promise<ScanItem> {
  const bytes = (await fs.stat(filePath)).size;
  const ext = path.extname(name).slice(1);
  const base: ScanItem = {
    sourcePath: filePath,
    sourceName: name,
    title: path.basename(name, path.extname(name)),
    appleAutoTitle: null,
    recordedAt: '',
    durationSec: 0,
    ext,
    bytes,
    audioStreamIndex: 0,
    duplicate,
    error: null
  };

  try {
    const p = await probe(filePath);
    // 제목 우선순위: DB 사용자 제목 → 파일 메타 title → 파일명
    const title = apple?.title || p.title || base.title;
    const recordedAt =
      apple?.recordedAt || (p.creationTime ? toLocalIso(p.creationTime) : '');

    return {
      ...base,
      title,
      appleAutoTitle: p.title,
      recordedAt,
      durationSec: apple?.durationSec || p.durationSec,
      audioStreamIndex: p.audioStreamIndex
    };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

export async function scanFolder(cfg: AppConfig, folder: string): Promise<ScanItem[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && AUDIO_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name);

  const dbPath = await findDbPath(folder);
  const apple = dbPath ? await readTitleMap(dbPath) : new Map<string, AppleEntry>();
  const known = await existingSourceNames(cfg);

  const items = await Promise.all(
    names.map((n) => inspect(path.join(folder, n), n, apple.get(n), known.has(n)))
  );

  // 문자열 비교가 아니라 실제 시각으로 정렬한다. recordedAt에 오프셋이
  // 붙어 있어 사전식으로 비교하면 타임존이 섞였을 때 순서가 뒤집힌다.
  // 날짜를 못 읽은 항목(recordedAt === '')은 뒤로 간다.
  return items.sort(compareByRecordedAtDesc);
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/scan.test.ts
```

Expected: PASS — 8 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/scan.ts src/lib/server/scan.test.ts
git commit -m "feat: 폴더 스캔

probe 메타와 CloudRecordings.db 제목을 합쳐 ScanItem을 만든다.
DB가 없으면 파일 메타로 대체하고, 손상 파일은 error만 달고 넘어간다."
```

---

### Task 10: 작업 큐

**Files:**
- Create: `src/lib/server/jobs/queue.ts`
- Create: `src/lib/server/jobs/queue.test.ts`

**Interfaces:**
- Consumes: `JobItem`, `JobStatus` (Task 1)
- Produces:
  - `JobQueue` 클래스
    - `constructor(concurrency: number, worker: (item: JobItem) => Promise<Record<string, JobStatus>>)` — worker는 포맷별 최종 상태를 돌려준다
    - `enqueue(items: JobItem[]): void`
    - `subscribe(fn: (items: JobItem[]) => void): () => void`
    - `snapshot(): JobItem[]`
    - `retryFailed(): void`
    - `idle(): Promise<void>` — 테스트와 종료용

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/jobs/queue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { JobItem, JobStatus } from '$lib/types';
import { JobQueue, JobFailure } from './queue';

function item(id: string): JobItem {
  return {
    id, recordingId: `rec-${id}`, sourcePath: `/tmp/${id}.qta`, title: id,
    status: 'pending', formats: { mp3: 'pending', wav: 'pending' }, error: null
  };
}

const ok: Record<string, JobStatus> = { mp3: 'done', wav: 'done' };

describe('JobQueue', () => {
  it('모든 항목을 처리한다', async () => {
    const seen: string[] = [];
    const q = new JobQueue(2, async (i) => {
      seen.push(i.id);
      return ok;
    });
    q.enqueue([item('a'), item('b'), item('c')]);
    await q.idle();
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
    expect(q.snapshot().every((i) => i.status === 'done')).toBe(true);
  });

  it('동시 실행 수를 넘지 않는다', async () => {
    let running = 0;
    let peak = 0;
    const q = new JobQueue(2, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return ok;
    });
    q.enqueue([item('a'), item('b'), item('c'), item('d'), item('e')]);
    await q.idle();
    expect(peak).toBe(2);
  });

  it('한 항목이 실패해도 나머지는 계속된다', async () => {
    const q = new JobQueue(1, async (i) => {
      if (i.id === 'b') throw new Error('boom');
      return ok;
    });
    q.enqueue([item('a'), item('b'), item('c')]);
    await q.idle();
    const s = q.snapshot();
    expect(s.find((i) => i.id === 'b')!.status).toBe('failed');
    expect(s.find((i) => i.id === 'b')!.error).toContain('boom');
    expect(s.filter((i) => i.status === 'done')).toHaveLength(2);
  });

  it('포맷별 부분 실패를 기록한다', async () => {
    const q = new JobQueue(1, async () => ({ mp3: 'done', wav: 'failed' }));
    q.enqueue([item('a')]);
    await q.idle();
    const a = q.snapshot()[0];
    expect(a.formats).toEqual({ mp3: 'done', wav: 'failed' });
    expect(a.status).toBe('failed');
  });

  it('retryFailed는 실패한 것만 다시 돌린다', async () => {
    let attempt = 0;
    const q = new JobQueue(1, async (i) => {
      attempt++;
      if (i.id === 'b' && attempt <= 2) throw new Error('일시 실패');
      return ok;
    });
    q.enqueue([item('a'), item('b')]);
    await q.idle();
    expect(q.snapshot().find((i) => i.id === 'b')!.status).toBe('failed');

    q.retryFailed();
    await q.idle();
    expect(q.snapshot().every((i) => i.status === 'done')).toBe(true);
  });

  it('구독자에게 변경을 알린다', async () => {
    const fn = vi.fn();
    const q = new JobQueue(1, async () => ok);
    const off = q.subscribe(fn);
    q.enqueue([item('a')]);
    await q.idle();
    expect(fn).toHaveBeenCalled();
    off();
    const before = fn.mock.calls.length;
    q.enqueue([item('b')]);
    await q.idle();
    expect(fn.mock.calls.length).toBe(before);
  });

  it('비어 있을 때 idle은 즉시 끝난다', async () => {
    const q = new JobQueue(2, async () => ok);
    await expect(q.idle()).resolves.toBeUndefined();
  });

  it('워커가 JobFailure에 부분 진행을 실어 던지면 그 상태를 남긴다', async () => {
    const q = new JobQueue(1, async () => {
      throw new JobFailure('파형 생성 실패', { mp3: 'done', wav: 'done' });
    });
    q.enqueue([item('a')]);
    await q.idle();

    const a = q.snapshot()[0];
    expect(a.status).toBe('failed');
    // 실행 이전 상태(전부 pending)로 되돌아가면 안 된다
    expect(a.formats).toEqual({ mp3: 'done', wav: 'done' });
  });

  it('부분 진행이 남으면 재시도가 이미 만든 포맷을 다시 만들지 않는다', async () => {
    let seen: Record<string, JobStatus> | null = null;
    let calls = 0;
    const q = new JobQueue(1, async (i) => {
      calls++;
      if (calls === 1) throw new JobFailure('파형 생성 실패', { mp3: 'done', wav: 'done' });
      seen = i.formats;
      return ok;
    });

    q.enqueue([item('a')]);
    await q.idle();
    q.retryFailed();
    await q.idle();

    // 재시도 워커가 받은 formats에 done이 보존돼야 러너가 convert를 건너뛴다
    expect(seen).toEqual({ mp3: 'done', wav: 'done' });
    expect(q.snapshot()[0].status).toBe('done');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/jobs/queue.test.ts
```

Expected: FAIL — `Failed to resolve import "./queue"`

- [ ] **Step 3: 구현**

`src/lib/server/jobs/queue.ts`:

```ts
import type { JobItem, JobStatus } from '$lib/types';

export type Worker = (item: JobItem) => Promise<Record<string, JobStatus>>;

/**
 * 워커가 도중에 실패했지만 일부 포맷은 이미 만들어졌을 때 던지는 에러.
 * 여기 실린 formats가 없으면 큐는 실행 이전 상태를 그대로 남기게 되고,
 * 그러면 이미 성공한 포맷이 pending으로 되돌아가 재시도 때 다시 변환된다.
 * 그 재시도가 실패하면 convert의 정리 로직이 멀쩡한 파일을 지운다.
 */
export class JobFailure extends Error {
  constructor(
    message: string,
    readonly formats?: Record<string, JobStatus>
  ) {
    super(message);
    this.name = 'JobFailure';
  }
}

/**
 * 인메모리 변환 큐. 요청과 무관하게 돌아가고, 진행 상황은 구독자에게 흘린다.
 * 항목 하나가 실패해도 나머지는 계속 처리한다.
 */
export class JobQueue {
  private items = new Map<string, JobItem>();
  private pending: string[] = [];
  private running = 0;
  private subscribers = new Set<(items: JobItem[]) => void>();
  private idleWaiters: (() => void)[] = [];

  constructor(
    private concurrency: number,
    private worker: Worker
  ) {}

  enqueue(items: JobItem[]): void {
    for (const i of items) {
      this.items.set(i.id, { ...i, status: 'pending', error: null });
      this.pending.push(i.id);
    }
    this.emit();
    this.pump();
  }

  retryFailed(): void {
    const ids = this.snapshot()
      .filter((i) => i.status === 'failed')
      .map((i) => i.id);
    for (const id of ids) {
      const cur = this.items.get(id)!;
      const formats = { ...cur.formats };
      // 성공한 포맷은 다시 만들지 않는다
      for (const k of Object.keys(formats)) {
        if (formats[k] !== 'done') formats[k] = 'pending';
      }
      this.items.set(id, { ...cur, status: 'pending', error: null, formats });
      this.pending.push(id);
    }
    this.emit();
    this.pump();
  }

  snapshot(): JobItem[] {
    return Array.from(this.items.values()).map((i) => ({ ...i, formats: { ...i.formats } }));
  }

  subscribe(fn: (items: JobItem[]) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  idle(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.subscribers) fn(snap);
  }

  private settleIdle(): void {
    if (this.running === 0 && this.pending.length === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      this.running++;
      void this.runOne(id);
    }
    this.settleIdle();
  }

  private async runOne(id: string): Promise<void> {
    const start = this.items.get(id)!;
    this.items.set(id, { ...start, status: 'running' });
    this.emit();

    try {
      const formats = await this.worker(this.items.get(id)!);
      const failed = Object.values(formats).some((s) => s === 'failed');
      this.items.set(id, {
        ...this.items.get(id)!,
        status: failed ? 'failed' : 'done',
        formats,
        error: failed ? '일부 포맷 변환에 실패했습니다' : null
      });
    } catch (err) {
      const cur = this.items.get(id)!;
      // 워커가 부분 진행 상태를 실어 보냈으면 그것을 남긴다. 그러지 않으면
      // 이미 성공한 포맷이 pending으로 되돌아가 재시도 때 다시 변환된다.
      const formats = err instanceof JobFailure && err.formats ? err.formats : cur.formats;
      this.items.set(id, {
        ...cur,
        status: 'failed',
        formats,
        error: (err as Error).message
      });
    } finally {
      this.running--;
      this.emit();
      this.pump();
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/jobs/queue.test.ts
```

Expected: PASS — 7 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/jobs/
git commit -m "feat: 백그라운드 변환 큐

동시 실행 수를 지키고, 항목 하나가 실패해도 나머지를 계속 처리한다.
retryFailed는 성공한 포맷을 다시 만들지 않는다."
```

---

### Task 11: 변환 러너

**Files:**
- Create: `src/lib/server/jobs/runner.ts`
- Create: `src/lib/server/jobs/runner.test.ts`

**Interfaces:**
- Consumes: `convert` (Task 7), `generatePeaks` (Task 8), `savePeaks` (Task 8), `addMany`·`newId` (Task 3), `AppConfig`·`ScanItem`·`JobItem`·`Recording` (Task 1), `JobQueue` (Task 10)
- Produces:
  - `PendingItem { scan: ScanItem; title: string; description: string; tags: string[] }`
  - `buildJobs(cfg, pending: PendingItem[]): { jobs: JobItem[]; recordings: Recording[] }`
  - `makeRunner(cfg: AppConfig): Worker`
  - `getQueue(cfg: AppConfig): JobQueue` — 프로세스 싱글턴

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/jobs/runner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, ScanItem } from '$lib/types';
import { loadConfig } from '../config';
import { listAll } from '../store/recordings';
import { loadPeaks } from '../store/waveforms';
import { scanFolder } from '../scan';
import { JobQueue } from './queue';
import { buildJobs, makeRunner } from './runner';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const QTA_NAME = '20260711 181530-1923A106.qta';

let dir: string;
let src: string;
let cfg: AppConfig;
let scan: ScanItem[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-runner-'));
  src = path.join(dir, 'src');
  await fs.mkdir(src, { recursive: true });
  await fs.copyFile(SPATIAL, path.join(src, QTA_NAME));
  cfg = loadConfig({
    DATA_DIR: path.join(dir, 'data'),
    MEDIA_DIR: path.join(dir, 'media'),
    WAVEFORM_PEAKS: '64'
  });
  scan = await scanFolder(cfg, src);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('buildJobs', () => {
  it('입력한 제목·설명·태그를 녹음 항목에 담는다', () => {
    const { recordings, jobs } = buildJobs(cfg, [
      { scan: scan[0], title: '레인', description: '데모', tags: ['1절'] }
    ]);
    expect(recordings[0].title).toBe('레인');
    expect(recordings[0].description).toBe('데모');
    expect(recordings[0].tags).toEqual(['1절']);
    expect(recordings[0].sourceName).toBe(QTA_NAME);
    expect(jobs[0].recordingId).toBe(recordings[0].id);
  });

  it('설정된 포맷을 pending으로 초기화한다', () => {
    const { jobs } = buildJobs(cfg, [{ scan: scan[0], title: 't', description: '', tags: [] }]);
    expect(jobs[0].formats).toEqual({ mp3: 'pending', wav: 'pending' });
  });
});

describe('makeRunner', () => {
  it('원본을 복사하고 모든 포맷을 만들고 파형을 저장한다', async () => {
    const { recordings, jobs } = buildJobs(cfg, [
      { scan: scan[0], title: '레인', description: '', tags: ['데모'] }
    ]);
    const q = new JobQueue(2, makeRunner(cfg));
    q.enqueue(jobs);
    await q.idle();

    expect(q.snapshot()[0].status).toBe('done');

    const id = recordings[0].id;
    expect((await fs.stat(path.join(cfg.mediaDir, 'original', `${id}.qta`))).size).toBeGreaterThan(0);
    expect((await fs.stat(path.join(cfg.mediaDir, 'mp3', `${id}.mp3`))).size).toBeGreaterThan(0);
    expect((await fs.stat(path.join(cfg.mediaDir, 'wav', `${id}.wav`))).size).toBeGreaterThan(0);

    const peaks = await loadPeaks(cfg, id);
    expect(peaks).toHaveLength(64);

    const stored = await listAll(cfg);
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('레인');
    expect(Object.keys(stored[0].files).sort()).toEqual(['mp3', 'original', 'wav']);
    expect(stored[0].files.mp3.bytes).toBeGreaterThan(0);
  });

  it('원본이 사라지면 실패로 기록하고 저장소를 오염시키지 않는다', async () => {
    const { jobs } = buildJobs(cfg, [{ scan: scan[0], title: 't', description: '', tags: [] }]);
    await fs.rm(jobs[0].sourcePath);

    const q = new JobQueue(1, makeRunner(cfg));
    q.enqueue(jobs);
    await q.idle();

    expect(q.snapshot()[0].status).toBe('failed');
    expect(await listAll(cfg)).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/jobs/runner.test.ts
```

Expected: FAIL — `Failed to resolve import "./runner"`

- [ ] **Step 3: 구현**

`src/lib/server/jobs/runner.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AppConfig, FileEntry, JobItem, JobStatus, Recording, ScanItem
} from '$lib/types';
import { convert } from '../media/convert';
import { probe } from '../media/probe';
import { generatePeaks } from '../media/waveform';
import { savePeaks } from '../store/waveforms';
import { addMany, newId } from '../store/recordings';
import { JobQueue, JobFailure, type Worker } from './queue';
import { pendingRecordings } from './registry';

export interface PendingItem {
  scan: ScanItem;
  title: string;
  description: string;
  tags: string[];
}

function nowIso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

/** 스캔 결과와 사용자 입력을 합쳐 녹음 항목과 변환 작업을 만든다. */
export function buildJobs(
  cfg: AppConfig,
  pending: PendingItem[]
): { jobs: JobItem[]; recordings: Recording[] } {
  const jobs: JobItem[] = [];
  const recordings: Recording[] = [];
  const at = nowIso();

  for (const p of pending) {
    const id = newId();
    recordings.push({
      id,
      title: p.title,
      description: p.description,
      tags: p.tags,
      recordedAt: p.scan.recordedAt,
      durationSec: p.scan.durationSec,
      sourceName: p.scan.sourceName,
      appleAutoTitle: p.scan.appleAutoTitle,
      files: {},
      bookmarks: [],
      createdAt: at,
      updatedAt: at,
      deletedAt: null
    });

    const formats: Record<string, JobStatus> = {};
    for (const f of cfg.formats) formats[f.name] = 'pending';

    jobs.push({
      id,
      recordingId: id,
      sourcePath: p.scan.sourcePath,
      title: p.title,
      status: 'pending',
      formats,
      error: null
    });
  }

  // 변환이 끝난 뒤 저장소에 넣을 수 있도록 레지스트리에 맡겨둔다
  pendingRecordings.put(recordings);
  return { jobs, recordings };
}

/**
 * 항목 하나의 파이프라인.
 * 원본 복사 → 포맷별 변환 → 파형 → 저장소 기록.
 *
 * 원본 복사가 실패하면 이후 단계가 의미 없으므로 전체를 실패로 던진다.
 * 개별 포맷 실패는 그 포맷만 failed로 남기고 나머지를 계속한다.
 */
export function makeRunner(cfg: AppConfig): Worker {
  return async (job: JobItem) => {
    const ext = path.extname(job.sourcePath).slice(1);
    const originalPath = path.join(cfg.mediaDir, 'original', `${job.recordingId}.${ext}`);

    await fs.mkdir(path.dirname(originalPath), { recursive: true });
    await fs.copyFile(job.sourcePath, originalPath);

    const meta = await probe(originalPath);

    const files: Record<string, FileEntry> = {
      original: { ext, bytes: (await fs.stat(originalPath)).size }
    };
    const result: Record<string, JobStatus> = {};

    for (const spec of cfg.formats) {
      if (job.formats[spec.name] === 'done') {
        result[spec.name] = 'done';
        continue;
      }
      const out = path.join(cfg.mediaDir, spec.name, `${job.recordingId}.${spec.ext}`);
      try {
        await convert(originalPath, out, meta.audioStreamIndex, spec);
        files[spec.name] = { bytes: (await fs.stat(out)).size };
        result[spec.name] = 'done';
      } catch {
        result[spec.name] = 'failed';
      }
    }

    // 여기서부터 던지는 오류는 이미 만들어진 포맷 정보를 실어 보내야 한다.
    // 그러지 않으면 큐가 실행 이전 상태(전부 pending)를 남기고, 재시도가
    // 멀쩡한 파일을 다시 변환하다 실패하면 convert가 그 파일을 지운다.
    try {
      const peaks = await generatePeaks(originalPath, meta.audioStreamIndex, cfg.waveformPeaks);
      await savePeaks(cfg, job.recordingId, peaks);

      // 저장소 기록은 파이프라인이 여기까지 온 뒤에만 한다.
      // 앞에서 던지면 목록에 반쪽짜리 항목이 남지 않는다.
      const rec = pendingRecordings.take(job.recordingId);
      if (rec) await addMany(cfg, [{ ...rec, files }]);
    } catch (err) {
      throw new JobFailure((err as Error).message, result);
    }

    return result;
  };
}

let queue: JobQueue | null = null;

/** 프로세스당 하나. 라우트가 요청마다 새 큐를 만들지 않도록 한다. */
export function getQueue(cfg: AppConfig): JobQueue {
  if (!queue) queue = new JobQueue(cfg.convertConcurrency, makeRunner(cfg));
  return queue;
}
```

- [ ] **Step 4: 대기 녹음 레지스트리 작성**

러너는 변환이 끝난 뒤에야 저장소에 기록한다. 그 사이 녹음 항목을 들고 있을 곳이 필요하다.

`src/lib/server/jobs/registry.ts`:

```ts
import type { Recording } from '$lib/types';

/**
 * 변환이 끝나기를 기다리는 녹음 항목. 러너가 성공하면 꺼내서 저장소에 넣는다.
 * 실패하면 남아 있다가 재시도 때 다시 쓰인다.
 */
class PendingRecordings {
  private map = new Map<string, Recording>();

  put(recs: Recording[]): void {
    for (const r of recs) this.map.set(r.id, r);
  }

  take(id: string): Recording | undefined {
    return this.map.get(id);
  }

  drop(id: string): void {
    this.map.delete(id);
  }
}

export const pendingRecordings = new PendingRecordings();
```

`registry.ts`는 `runner.ts`가 임포트하므로 두 파일을 함께 만든다. Step 3의 `runner.ts`에 이미 `import { pendingRecordings } from './registry';`와 `buildJobs` 안의 `pendingRecordings.put(recordings);`가 들어 있다.

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/jobs/runner.test.ts
```

Expected: PASS — 4 tests

- [ ] **Step 6: 전체 테스트 확인**

```bash
npx vitest run
```

Expected: PASS — 이전 태스크 테스트 포함 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add src/lib/server/jobs/
git commit -m "feat: 변환 러너

원본 복사 → 포맷별 변환 → 파형 → 저장소 기록 순으로 처리한다.
포맷 하나가 실패해도 나머지를 만들고, 실패한 포맷만 재시도한다."
```

---

### Task 12: 미디어·파형 HTTP API

**Files:**
- Create: `src/routes/api/media/[id]/[format]/+server.ts`
- Create: `src/routes/api/waveform/[id]/+server.ts`
- Create: `src/routes/api/recordings/+server.ts`
- Create: `src/routes/api/jobs/events/+server.ts`

**Interfaces:**
- Consumes: `config` (Task 1), `getById`·`patch`·`addTags`·`removeTags`·`softDelete` (Task 3), `loadPeaks` (Task 8), `getQueue` (Task 11)
- Produces: HTTP 엔드포인트
  - `GET /api/media/<id>/<format>` — Range 지원 오디오 스트리밍
  - `GET /api/waveform/<id>` — `number[]`
  - `PATCH /api/recordings` — `{ op, ids, ... }`
  - `GET /api/jobs/events` — SSE, `JobItem[]` 스냅샷

- [ ] **Step 1: 미디어 스트리밍 구현**

`src/routes/api/media/[id]/[format]/+server.ts`:

```ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getById } from '$lib/server/store/recordings';

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  qta: 'audio/mp4',
  aac: 'audio/aac'
};

export const GET: RequestHandler = async ({ params, request }) => {
  const rec = await getById(config, params.id);
  if (!rec) throw error(404, '녹음을 찾을 수 없습니다');

  const entry = rec.files[params.format];
  if (!entry) throw error(404, `이 녹음에는 ${params.format} 파일이 없습니다`);

  const ext = params.format === 'original' ? (entry.ext ?? 'bin') : params.format;
  const file = path.join(config.mediaDir, params.format, `${rec.id}.${ext}`);

  let size: number;
  try {
    size = (await fsp.stat(file)).size;
  } catch {
    throw error(404, '파일이 디스크에 없습니다');
  }

  const type = MIME[ext] ?? 'application/octet-stream';
  const range = request.headers.get('range');

  // Range 없이 전체를 주면 브라우저가 탐색을 못 한다
  if (!range) {
    return new Response(fs.createReadStream(file) as unknown as ReadableStream, {
      headers: {
        'content-type': type,
        'content-length': String(size),
        'accept-ranges': 'bytes'
      }
    });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m && m[1] ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }

  return new Response(fs.createReadStream(file, { start, end }) as unknown as ReadableStream, {
    status: 206,
    headers: {
      'content-type': type,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes'
    }
  });
};
```

- [ ] **Step 2: 파형 엔드포인트 구현**

`src/routes/api/waveform/[id]/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { loadPeaks } from '$lib/server/store/waveforms';

export const GET: RequestHandler = async ({ params }) => {
  const peaks = await loadPeaks(config, params.id);
  if (!peaks) throw error(404, '파형이 아직 없습니다');
  return json(peaks, { headers: { 'cache-control': 'public, max-age=31536000, immutable' } });
};
```

- [ ] **Step 3: 녹음 편집 엔드포인트 구현**

`src/routes/api/recordings/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { patch, addTags, removeTags, softDelete, listAll, allTags } from '$lib/server/store/recordings';

type Body =
  | { op: 'patch'; id: string; title?: string; description?: string; tags?: string[] }
  | { op: 'addTags'; ids: string[]; tags: string[] }
  | { op: 'removeTags'; ids: string[]; tags: string[] }
  | { op: 'delete'; ids: string[] };

export const PATCH: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as Body;

  switch (body.op) {
    case 'patch': {
      const { op, id, ...changes } = body;
      await patch(config, id, changes);
      break;
    }
    case 'addTags':
      await addTags(config, body.ids, body.tags);
      break;
    case 'removeTags':
      await removeTags(config, body.ids, body.tags);
      break;
    case 'delete':
      await softDelete(config, body.ids);
      break;
    default:
      throw error(400, '알 수 없는 작업입니다');
  }

  return json({ recordings: await listAll(config), tags: await allTags(config) });
};
```

- [ ] **Step 4: SSE 진행률 엔드포인트 구현**

`src/routes/api/jobs/events/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getQueue } from '$lib/server/jobs/runner';

export const GET: RequestHandler = async () => {
  const queue = getQueue(config);
  const encoder = new TextEncoder();

  // 정리 함수를 클로저에 둬야 cancel에서 실제로 부를 수 있다.
  // controller에 매달아두면 호출되지 않아 구독과 타이머가 새어나간다.
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (items: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(items)}\n\n`));
      };
      send(queue.snapshot());

      const off = queue.subscribe(send);
      // 프록시가 유휴 연결을 끊지 않게 주기적으로 주석 프레임을 보낸다
      const beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': beat\n\n'));
        } catch {
          cleanup();
        }
      }, 15000);

      cleanup = () => {
        off();
        clearInterval(beat);
      };
    },
    cancel() {
      cleanup();
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
};
```

- [ ] **Step 5: 수동 확인**

```bash
npm run dev
```

다른 터미널에서:

```bash
curl -s -i http://localhost:5173/api/waveform/nope | head -1
```

Expected: `HTTP/1.1 404 Not Found`

```bash
curl -s -N http://localhost:5173/api/jobs/events | head -1
```

Expected: `data: []`

- [ ] **Step 6: 커밋**

```bash
git add src/routes/api/
git commit -m "feat: 미디어·파형·편집·진행률 API

미디어는 Range 요청을 지원해 재생기가 탐색할 수 있게 한다.
진행률은 SSE로 큐 스냅샷을 흘린다."
```

---

### Task 13: 가져오기 화면

**Files:**
- Create: `src/routes/import/+page.server.ts`
- Create: `src/routes/import/+page.svelte`
- Create: `src/lib/components/TagInput.svelte`

**Interfaces:**
- Consumes: `scanFolder` (Task 9), `buildJobs`·`getQueue` (Task 11), `allTags` (Task 3), `config` (Task 1)
- Produces:
  - form action `?/scan` — `{ folder: string }` → `{ items: ScanItem[] }`
  - form action `?/enqueue` — `{ payload: string }` (JSON `PendingItem` 배열) → `{ queued: number }`
  - `TagInput.svelte` — `bind:tags`, `suggestions` prop

- [ ] **Step 1: 서버 액션 구현**

`src/routes/import/+page.server.ts`:

```ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { PendingItem } from '$lib/server/jobs/runner';
import { config } from '$lib/server/config';
import { scanFolder } from '$lib/server/scan';
import { buildJobs, getQueue } from '$lib/server/jobs/runner';
import { allTags } from '$lib/server/store/recordings';

export const load: PageServerLoad = async () => ({
  tags: (await allTags(config)).map((t) => t.tag),
  formats: config.formats.map((f) => f.name)
});

export const actions: Actions = {
  scan: async ({ request }) => {
    const folder = String((await request.formData()).get('folder') ?? '').trim();
    if (!folder) return fail(400, { message: '폴더 경로를 입력하세요' });

    try {
      return { items: await scanFolder(config, folder) };
    } catch (err) {
      return fail(400, { message: `폴더를 읽을 수 없습니다: ${(err as Error).message}` });
    }
  },

  enqueue: async ({ request }) => {
    const raw = String((await request.formData()).get('payload') ?? '');
    let pending: PendingItem[];
    try {
      pending = JSON.parse(raw) as PendingItem[];
    } catch {
      return fail(400, { message: '보낼 항목을 읽을 수 없습니다' });
    }
    if (pending.length === 0) return fail(400, { message: '선택된 항목이 없습니다' });

    const { jobs } = buildJobs(config, pending);
    getQueue(config).enqueue(jobs);
    return { queued: jobs.length };
  }
};
```

- [ ] **Step 2: 태그 입력 컴포넌트 구현**

`src/lib/components/TagInput.svelte`:

```svelte
<script lang="ts">
  let {
    tags = $bindable<string[]>([]),
    suggestions = [] as string[],
    placeholder = '태그 입력 후 Enter'
  } = $props();

  let draft = $state('');

  const matches = $derived(
    draft.trim()
      ? suggestions.filter((s) => s.includes(draft.trim()) && !tags.includes(s)).slice(0, 6)
      : []
  );

  function add(tag: string) {
    const t = tag.trim();
    if (t && !tags.includes(t)) tags = [...tags, t];
    draft = '';
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(matches[0] ?? draft);
    } else if (e.key === 'Backspace' && draft === '' && tags.length) {
      tags = tags.slice(0, -1);
    }
  }
</script>

<div class="flex flex-wrap items-center gap-1">
  {#each tags as tag (tag)}
    <span class="badge preset-filled-primary-500 gap-1">
      {tag}
      <button type="button" aria-label="{tag} 제거" onclick={() => (tags = tags.filter((t) => t !== tag))}>
        ×
      </button>
    </span>
  {/each}
  <input
    class="input w-32 grow"
    bind:value={draft}
    onkeydown={onKeydown}
    {placeholder}
  />
</div>

{#if matches.length}
  <div class="mt-1 flex flex-wrap gap-1">
    {#each matches as m (m)}
      <button type="button" class="chip preset-tonal" onclick={() => add(m)}>{m}</button>
    {/each}
  </div>
{/if}
```

- [ ] **Step 3: 가져오기 화면 구현**

`src/routes/import/+page.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { JobItem, ScanItem } from '$lib/types';
  import TagInput from '$lib/components/TagInput.svelte';

  let { data, form } = $props();

  interface Row {
    scan: ScanItem;
    selected: boolean;
    title: string;
    description: string;
    tags: string[];
  }

  let rows = $state<Row[]>([]);
  let bulkTags = $state<string[]>([]);
  let jobs = $state<JobItem[]>([]);
  let watching = $state(false);

  // 스캔 결과가 오면 편집 행을 만든다. 이미 등록된 항목은 기본 해제한다.
  $effect(() => {
    if (form && 'items' in form && form.items) {
      rows = (form.items as ScanItem[]).map((scan) => ({
        scan,
        selected: !scan.duplicate && scan.error === null,
        title: scan.title,
        description: '',
        tags: []
      }));
    }
  });

  const selected = $derived(rows.filter((r) => r.selected));

  function applyBulkTags() {
    for (const r of rows) {
      if (r.selected) r.tags = Array.from(new Set([...r.tags, ...bulkTags]));
    }
    bulkTags = [];
  }

  function payload(): string {
    return JSON.stringify(
      selected.map((r) => ({
        scan: r.scan,
        title: r.title,
        description: r.description,
        tags: r.tags
      }))
    );
  }

  function watchProgress() {
    if (watching) return;
    watching = true;
    const es = new EventSource('/api/jobs/events');
    es.onmessage = (e) => {
      jobs = JSON.parse(e.data) as JobItem[];
    };
  }

  const doneCount = $derived(jobs.filter((j) => j.status === 'done').length);
  const failedCount = $derived(jobs.filter((j) => j.status === 'failed').length);

  function fmtDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
</script>

<div class="mx-auto max-w-6xl space-y-6 p-6">
  <header class="flex items-baseline justify-between">
    <h1 class="h2">가져오기</h1>
    <a href="/" class="anchor">목록으로</a>
  </header>

  <form method="POST" action="?/scan" use:enhance class="flex gap-2">
    <input
      name="folder"
      class="input"
      placeholder="/Volumes/Storage/voice"
      required
    />
    <button type="submit" class="btn preset-filled">스캔</button>
  </form>

  {#if form && 'message' in form}
    <aside class="card preset-tonal-error p-4">{form.message}</aside>
  {/if}

  {#if rows.length}
    <div class="card preset-tonal p-4">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm">{selected.length}개 선택됨 / 전체 {rows.length}개</span>
        <button type="button" class="btn btn-sm preset-tonal"
          onclick={() => rows.forEach((r) => (r.selected = r.error === null))}>전체 선택</button>
        <button type="button" class="btn btn-sm preset-tonal"
          onclick={() => rows.forEach((r) => (r.selected = false))}>전체 해제</button>
        <div class="grow">
          <TagInput bind:tags={bulkTags} suggestions={data.tags} placeholder="선택 항목에 붙일 태그" />
        </div>
        <button type="button" class="btn btn-sm preset-filled"
          disabled={!bulkTags.length || !selected.length}
          onclick={applyBulkTags}>선택 항목에 태그 적용</button>
      </div>
    </div>

    <div class="table-wrap overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th></th>
            <th>제목</th>
            <th>설명</th>
            <th>태그</th>
            <th>녹음시각</th>
            <th>길이</th>
            <th>원본</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.scan.sourceName)}
            <tr class:opacity-50={row.scan.error !== null}>
              <td>
                <input type="checkbox" class="checkbox"
                  bind:checked={row.selected} disabled={row.scan.error !== null} />
              </td>
              <td class="min-w-48">
                <input class="input" bind:value={row.title} disabled={row.scan.error !== null} />
                {#if row.scan.duplicate}
                  <span class="badge preset-tonal-warning mt-1">이미 있음</span>
                {/if}
                {#if row.scan.error}
                  <span class="badge preset-tonal-error mt-1">읽을 수 없음</span>
                {/if}
              </td>
              <td class="min-w-48">
                <input class="input" bind:value={row.description} disabled={row.scan.error !== null} />
              </td>
              <td class="min-w-56">
                <TagInput bind:tags={row.tags} suggestions={data.tags} />
              </td>
              <td class="whitespace-nowrap text-sm tabular-nums">
                {row.scan.recordedAt.replace('T', ' ').slice(0, 16)}
              </td>
              <td class="tabular-nums">{fmtDuration(row.scan.durationSec)}</td>
              <td class="uppercase">{row.scan.ext}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <form method="POST" action="?/enqueue"
      use:enhance={() => {
        watchProgress();
        return async ({ update }) => update({ reset: false });
      }}>
      <input type="hidden" name="payload" value={payload()} />
      <button type="submit" class="btn preset-filled-primary-500" disabled={!selected.length}>
        {selected.length}개 저장 및 변환
      </button>
    </form>
  {/if}

  {#if jobs.length}
    <section class="card p-4">
      <h2 class="h4 mb-2">
        변환 진행 — 완료 {doneCount} / {jobs.length}
        {#if failedCount}<span class="text-error-500">· 실패 {failedCount}</span>{/if}
      </h2>
      <ul class="space-y-1 text-sm">
        {#each jobs as job (job.id)}
          <li class="flex items-center gap-3">
            <span class="w-20 shrink-0">
              {#if job.status === 'done'}<span class="badge preset-tonal-success">완료</span>
              {:else if job.status === 'running'}<span class="badge preset-tonal-primary">변환중</span>
              {:else if job.status === 'failed'}<span class="badge preset-tonal-error">실패</span>
              {:else}<span class="badge preset-tonal">대기</span>{/if}
            </span>
            <span class="grow truncate">{job.title}</span>
            <span class="text-surface-500 shrink-0 font-mono text-xs">
              {Object.entries(job.formats).map(([k, v]) => `${k}:${v}`).join(' ')}
            </span>
          </li>
        {/each}
      </ul>
      {#if failedCount}
        <button type="button" class="btn btn-sm preset-tonal mt-3"
          onclick={() => fetch('/api/jobs/retry', { method: 'POST' })}>
          실패한 {failedCount}개 재시도
        </button>
      {/if}
    </section>
  {/if}
</div>
```

- [ ] **Step 4: 재시도 엔드포인트 추가**

`src/routes/api/jobs/retry/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getQueue } from '$lib/server/jobs/runner';

export const POST: RequestHandler = async () => {
  getQueue(config).retryFailed();
  return json({ ok: true });
};
```

- [ ] **Step 5: 수동 확인**

```bash
npm run dev
```

브라우저에서 `http://localhost:5173/import`를 열고 `~/Dev/SIDE_PROJECT/_voice_sample`을 스캔한다.

Expected: 252행이 뜨고 제목 칸에 "레인", "정류장" 같은 사용자 제목이 채워져 있다. 몇 개만 선택해 저장하면 진행률이 실시간으로 갱신되고 완료로 바뀐다.

- [ ] **Step 6: 커밋**

```bash
git add src/routes/import/ src/routes/api/jobs/ src/lib/components/
git commit -m "feat: 가져오기 화면

스캔은 읽기만 하므로 즉시 끝나고, 검토를 마친 뒤에만 변환을 시작한다.
선택한 행에 태그를 일괄 적용하고 진행률은 SSE로 받는다."
```

---

### Task 14: 목록 화면과 필터 UI

**Files:**
- Create: `src/routes/+page.server.ts`
- Create: `src/routes/+page.svelte`
- Create: `src/lib/components/FilterBar.svelte`

**Interfaces:**
- Consumes: `listAll`·`allTags` (Task 3), `applyFilter`·`filterFromParams`·`filterToParams`·`EMPTY_FILTER` (Task 4)
- Produces: 목록 화면. Task 15가 이 페이지에 `Player`를 붙인다. `selectedId` 상태를 `$state`로 들고 있어야 한다.

- [ ] **Step 1: 서버 로더 구현**

`src/routes/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { config } from '$lib/server/config';
import { listAll, allTags } from '$lib/server/store/recordings';

export const load: PageServerLoad = async () => ({
  recordings: await listAll(config),
  tags: await allTags(config),
  formats: config.formats.map((f) => f.name)
});
```

- [ ] **Step 2: 필터바 구현**

`src/lib/components/FilterBar.svelte`:

```svelte
<script lang="ts">
  import type { Filter } from '$lib/types';

  let {
    filter = $bindable<Filter>(),
    tags = [] as { tag: string; count: number }[],
    total = 0,
    shown = 0
  } = $props();

  function toggleTag(tag: string) {
    filter.tags = filter.tags.includes(tag)
      ? filter.tags.filter((t) => t !== tag)
      : [...filter.tags, tag];
  }
</script>

<div class="card preset-tonal space-y-3 p-4">
  <div class="flex flex-wrap items-center gap-3">
    <input class="input max-w-64" bind:value={filter.q} placeholder="제목 검색" />
    <label class="flex items-center gap-2 text-sm">
      <span>기간</span>
      <input type="date" class="input" bind:value={filter.from} />
      <span>~</span>
      <input type="date" class="input" bind:value={filter.to} />
    </label>
    <button type="button" class="btn btn-sm preset-tonal"
      onclick={() => (filter = { q: '', tags: [], tagMode: 'and', from: '', to: '' })}>
      초기화
    </button>
    <span class="text-surface-500 ml-auto text-sm tabular-nums">{shown} / {total}</span>
  </div>

  {#if tags.length}
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex overflow-hidden rounded">
        <button type="button"
          class="btn btn-sm {filter.tagMode === 'and' ? 'preset-filled' : 'preset-tonal'}"
          onclick={() => (filter.tagMode = 'and')}>모두 포함</button>
        <button type="button"
          class="btn btn-sm {filter.tagMode === 'or' ? 'preset-filled' : 'preset-tonal'}"
          onclick={() => (filter.tagMode = 'or')}>하나라도</button>
      </div>
      {#each tags as t (t.tag)}
        <button type="button"
          class="chip {filter.tags.includes(t.tag) ? 'preset-filled-primary-500' : 'preset-tonal'}"
          onclick={() => toggleTag(t.tag)}>
          {t.tag}<span class="ml-1 opacity-60 tabular-nums">{t.count}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 3: 목록 화면 구현**

`src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import type { Filter, Recording } from '$lib/types';
  import { applyFilter, filterFromParams, filterToParams } from '$lib/filter';
  import FilterBar from '$lib/components/FilterBar.svelte';

  let { data } = $props();

  let recordings = $state<Recording[]>(data.recordings);
  let tags = $state(data.tags);
  let filter = $state<Filter>(filterFromParams(page.url.searchParams));
  let selectedIds = $state<Set<string>>(new Set());
  let editingId = $state<string | null>(null);

  const shown = $derived(applyFilter(recordings, filter));

  // 필터를 URL에 반영해 새로고침과 링크 공유에서 유지되게 한다
  $effect(() => {
    const qs = filterToParams(filter).toString();
    replaceState(qs ? `?${qs}` : '/', {});
  });

  async function send(body: unknown) {
    const res = await fetch('/api/recordings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return;
    const next = await res.json();
    recordings = next.recordings;
    tags = next.tags;
  }

  function toggle(id: string) {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    selectedIds = s;
  }

  function fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  }
</script>

<div class="mx-auto max-w-6xl space-y-4 p-6 pb-40">
  <header class="flex items-baseline justify-between">
    <h1 class="h2">ULS Player</h1>
    <a href="/import" class="btn preset-filled">가져오기</a>
  </header>

  <FilterBar bind:filter {tags} total={recordings.length} shown={shown.length} />

  {#if selectedIds.size}
    <div class="card preset-tonal-primary flex flex-wrap items-center gap-3 p-3">
      <span class="text-sm">{selectedIds.size}개 선택됨</span>
      <button type="button" class="btn btn-sm preset-tonal"
        onclick={() => send({ op: 'delete', ids: [...selectedIds] }).then(() => (selectedIds = new Set()))}>
        목록에서 제거
      </button>
      <button type="button" class="btn btn-sm preset-tonal"
        onclick={() => (selectedIds = new Set())}>선택 해제</button>
    </div>
  {/if}

  <ul class="space-y-1">
    {#each shown as rec (rec.id)}
      <li class="card hover:preset-tonal flex items-center gap-3 p-3">
        <input type="checkbox" class="checkbox"
          checked={selectedIds.has(rec.id)} onchange={() => toggle(rec.id)} />

        {#if editingId === rec.id}
          <input class="input grow" value={rec.title}
            onblur={(e) => {
              send({ op: 'patch', id: rec.id, title: e.currentTarget.value });
              editingId = null;
            }} />
        {:else}
          <button type="button" class="grow text-left" ondblclick={() => (editingId = rec.id)}>
            {rec.title}
          </button>
        {/if}

        <div class="flex shrink-0 gap-1">
          {#each rec.tags as t (t)}<span class="chip preset-tonal">{t}</span>{/each}
        </div>
        <span class="text-surface-500 shrink-0 text-sm tabular-nums">
          {rec.recordedAt.replace('T', ' ').slice(0, 16)}
        </span>
        <span class="shrink-0 text-sm tabular-nums">{fmt(rec.durationSec)}</span>
        <div class="flex shrink-0 gap-1">
          {#each Object.keys(rec.files) as f (f)}
            <span class="badge preset-tonal text-xs uppercase">{f === 'original' ? rec.files[f].ext : f}</span>
          {/each}
        </div>
      </li>
    {:else}
      <li class="card preset-tonal p-8 text-center">
        {recordings.length ? '조건에 맞는 녹음이 없습니다' : '아직 가져온 녹음이 없습니다'}
      </li>
    {/each}
  </ul>
</div>
```

- [ ] **Step 4: 수동 확인**

```bash
npm run dev
```

Task 13에서 가져온 항목이 목록에 보이는지, 태그 칩을 누르면 걸러지는지, AND/OR 전환이 먹는지, 새로고침해도 필터가 유지되는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/routes/+page.server.ts src/routes/+page.svelte src/lib/components/FilterBar.svelte
git commit -m "feat: 목록 화면과 필터

제목 검색·태그 AND/OR·날짜 범위를 URL 쿼리에 반영한다.
행에서 제목을 바로 고치고, 여러 행을 골라 한 번에 제거한다."
```

---

### Task 15: 플레이어

**Files:**
- Create: `src/lib/components/Waveform.svelte`
- Create: `src/lib/components/Player.svelte`
- Modify: `src/routes/+page.svelte` (플레이어 연결)

**Interfaces:**
- Consumes: `GET /api/media/<id>/<format>`, `GET /api/waveform/<id>` (Task 12), `Recording`·`Bookmark` (Task 1)
- Produces:
  - `Waveform.svelte` — props `peaks: number[]`, `progress: number`(0~1), `bookmarks: Bookmark[]`, `durationSec: number`, `onseek: (ratio: number) => void`
  - `Player.svelte` — props `recording: Recording | null`, `formats: string[]`, `onbookmark: (b: Omit<Bookmark,'id'>) => void`

- [ ] **Step 1: 파형 컴포넌트 구현**

`src/lib/components/Waveform.svelte`:

```svelte
<script lang="ts">
  import type { Bookmark } from '$lib/types';

  let {
    peaks = [] as number[],
    progress = 0,
    bookmarks = [] as Bookmark[],
    durationSec = 0,
    onseek = (_: number) => {}
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);

  function draw() {
    if (!canvas || !peaks.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(canvas);
    const played = styles.getPropertyValue('--wf-played').trim() || '#c4562b';
    const rest = styles.getPropertyValue('--wf-rest').trim() || '#9aa4ad';

    const bw = 2;
    const gap = 1;
    const bars = Math.floor(w / (bw + gap));
    const per = peaks.length / bars;
    const mid = h / 2;

    for (let i = 0; i < bars; i++) {
      let m = 0;
      for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per) && j < peaks.length; j++) {
        if (peaks[j] > m) m = peaks[j];
      }
      const barH = Math.max(1, m * (h - 2));
      ctx.fillStyle = i / bars <= progress ? played : rest;
      ctx.fillRect(i * (bw + gap), mid - barH / 2, bw, barH);
    }
  }

  $effect(() => {
    // peaks와 progress가 바뀔 때마다 다시 그린다
    void peaks;
    void progress;
    draw();
  });

  $effect(() => {
    const on = () => draw();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  });

  function seekAt(e: MouseEvent) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    onseek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  }
</script>

<div class="relative">
  <canvas
    bind:this={canvas}
    class="block h-16 w-full cursor-pointer"
    style="--wf-played: var(--color-primary-500); --wf-rest: var(--color-surface-400);"
    onclick={seekAt}
    role="slider"
    tabindex="0"
    aria-label="재생 위치"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(progress * 100)}
  ></canvas>

  {#each bookmarks as b (b.id)}
    <span
      class="bg-tertiary-500 pointer-events-none absolute top-0 h-2 w-0.5"
      style="left: {durationSec ? (b.atSec / durationSec) * 100 : 0}%"
      title={b.note}
    ></span>
  {/each}
</div>
```

- [ ] **Step 2: 플레이어 컴포넌트 구현**

`src/lib/components/Player.svelte`:

```svelte
<script lang="ts">
  import type { Bookmark, Recording } from '$lib/types';
  import Waveform from './Waveform.svelte';

  let {
    recording = null as Recording | null,
    formats = [] as string[],
    onbookmark = (_: Omit<Bookmark, 'id'>) => {}
  } = $props();

  let audio = $state<HTMLAudioElement | null>(null);
  let format = $state('mp3');
  let playing = $state(false);
  let current = $state(0);
  let volume = $state(1);
  let muted = $state(false);
  let rate = $state(1);
  let peaks = $state<number[]>([]);
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);

  const available = $derived(recording ? formats.filter((f) => recording.files[f]) : []);
  const duration = $derived(recording?.durationSec ?? 0);
  const progress = $derived(duration ? current / duration : 0);

  const src = $derived(
    recording && recording.files[format] ? `/api/media/${recording.id}/${format}` : ''
  );

  // 녹음이 바뀌면 파형을 새로 받고 포맷을 사용 가능한 것으로 맞춘다
  $effect(() => {
    const rec = recording;
    if (!rec) {
      peaks = [];
      return;
    }
    if (!rec.files[format]) format = available[0] ?? 'original';
    current = 0;
    loopA = loopB = null;
    fetch(`/api/waveform/${rec.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((p: number[]) => (peaks = p))
      .catch(() => (peaks = []));
  });

  /**
   * 포맷을 바꿔도 재생 위치를 유지한다.
   * 같은 녹음을 mp3와 wav로 비교해 들으려면 이게 없으면 안 된다.
   */
  function switchFormat(next: string) {
    const at = audio?.currentTime ?? 0;
    const wasPlaying = playing;
    format = next;
    queueMicrotask(() => {
      if (!audio) return;
      audio.currentTime = at;
      if (wasPlaying) void audio.play();
    });
  }

  function toggle() {
    if (!audio) return;
    playing ? audio.pause() : void audio.play();
  }

  function seek(sec: number) {
    if (audio) audio.currentTime = Math.min(duration, Math.max(0, sec));
  }

  function nudge(delta: number) {
    seek((audio?.currentTime ?? 0) + delta);
  }

  function onTimeUpdate() {
    if (!audio) return;
    current = audio.currentTime;
    // A-B 구간 반복. 저장되지 않는 일시적 재생 상태다.
    if (loopA !== null && loopB !== null && current >= loopB) audio.currentTime = loopA;
  }

  function markLoop() {
    const t = audio?.currentTime ?? 0;
    if (loopA === null || loopB !== null) {
      loopA = t;
      loopB = null;
    } else {
      loopB = t > loopA ? t : loopA + 1;
    }
  }

  function addBookmark() {
    if (!recording) return;
    onbookmark({ atSec: audio?.currentTime ?? 0, endSec: null, note: '' });
  }

  function onKeydown(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
    if (!recording) return;

    switch (e.key) {
      case ' ': e.preventDefault(); toggle(); break;
      case 'ArrowLeft': e.preventDefault(); nudge(e.shiftKey ? -10 : -5); break;
      case 'ArrowRight': e.preventDefault(); nudge(e.shiftKey ? 10 : 5); break;
      case 'ArrowUp': e.preventDefault(); volume = Math.min(1, volume + 0.05); break;
      case 'ArrowDown': e.preventDefault(); volume = Math.max(0, volume - 0.05); break;
      case 'm': case 'M': muted = !muted; break;
      case 'b': case 'B': addBookmark(); break;
    }
  }

  function fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if recording}
  <div class="bg-surface-100-900 border-surface-200-800 fixed inset-x-0 bottom-0 border-t p-3">
    <audio
      bind:this={audio}
      {src}
      bind:volume
      bind:muted
      bind:playbackRate={rate}
      onplay={() => (playing = true)}
      onpause={() => (playing = false)}
      ontimeupdate={onTimeUpdate}
    ></audio>

    <div class="mx-auto max-w-6xl space-y-2">
      <div class="flex items-baseline gap-3">
        <strong class="truncate">{recording.title}</strong>
        <span class="text-surface-500 shrink-0 text-sm tabular-nums">
          {fmt(current)} / {fmt(duration)}
        </span>
        {#if loopA !== null}
          <span class="badge preset-tonal-tertiary shrink-0">
            A-B {fmt(loopA)}{loopB !== null ? `–${fmt(loopB)}` : '…'}
          </span>
        {/if}
      </div>

      <Waveform {peaks} {progress} bookmarks={recording.bookmarks} durationSec={duration}
        onseek={(r) => seek(r * duration)} />

      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn btn-sm preset-tonal" onclick={() => nudge(-10)}>−10초</button>
        <button type="button" class="btn btn-sm preset-tonal" onclick={() => nudge(-5)}>−5초</button>
        <button type="button" class="btn preset-filled-primary-500" onclick={toggle}>
          {playing ? '일시정지' : '재생'}
        </button>
        <button type="button" class="btn btn-sm preset-tonal" onclick={() => nudge(5)}>+5초</button>
        <button type="button" class="btn btn-sm preset-tonal" onclick={() => nudge(10)}>+10초</button>

        <button type="button" class="btn btn-sm preset-tonal" onclick={markLoop}>
          {loopA === null ? 'A 지정' : loopB === null ? 'B 지정' : '구간 해제'}
        </button>
        <button type="button" class="btn btn-sm preset-tonal" onclick={addBookmark}>북마크</button>

        <label class="flex items-center gap-1 text-sm">
          <button type="button" class="btn btn-sm preset-tonal" onclick={() => (muted = !muted)}>
            {muted ? '음소거 해제' : '음소거'}
          </button>
          <input type="range" min="0" max="1" step="0.01" bind:value={volume} class="w-24" />
        </label>

        <label class="flex items-center gap-1 text-sm">
          배속
          <select class="select select-sm" bind:value={rate}>
            {#each [0.5, 0.75, 1, 1.25, 1.5, 2] as r (r)}<option value={r}>{r}×</option>{/each}
          </select>
        </label>

        <div class="ml-auto flex items-center gap-1">
          {#each available as f (f)}
            <button type="button"
              class="btn btn-sm {format === f ? 'preset-filled' : 'preset-tonal'}"
              onclick={() => switchFormat(f)}>
              {f === 'original' ? (recording.files.original.ext ?? '원본') : f}
            </button>
          {/each}
          <a class="btn btn-sm preset-tonal" href={src} download>다운로드</a>
        </div>
      </div>
    </div>
  </div>
{/if}
```

- [ ] **Step 3: 목록에 플레이어 연결**

`src/routes/+page.svelte`의 `<script>` 끝에 추가한다.

```ts
import Player from '$lib/components/Player.svelte';
import type { Bookmark } from '$lib/types';

let selectedId = $state<string | null>(null);
const selected = $derived(recordings.find((r) => r.id === selectedId) ?? null);

async function addBookmark(b: Omit<Bookmark, 'id'>) {
  if (!selected) return;
  const next = [...selected.bookmarks, { ...b, id: crypto.randomUUID() }];
  await send({ op: 'patch', id: selected.id, bookmarks: next });
}
```

제목 버튼의 `ondblclick` 옆에 `onclick`을 붙여 행을 고르게 한다.

```svelte
<button type="button" class="grow text-left"
  onclick={() => (selectedId = rec.id)}
  ondblclick={() => (editingId = rec.id)}>
  {rec.title}
</button>
```

닫는 `</div>` 바로 앞에 플레이어를 넣는다.

```svelte
<Player recording={selected} formats={['original', ...data.formats]} onbookmark={addBookmark} />
```

`api/recordings`의 `patch` 분기가 `bookmarks`를 받도록 `Body` 타입에 필드를 추가한다.

`src/routes/api/recordings/+server.ts`:

```ts
| { op: 'patch'; id: string; title?: string; description?: string; tags?: string[]; bookmarks?: Bookmark[] }
```

그리고 상단에 `import type { Bookmark } from '$lib/types';`를 추가한다.

- [ ] **Step 4: 수동 확인**

```bash
npm run dev
```

목록에서 항목을 클릭해 하단 플레이어가 뜨는지, 파형이 그려지고 클릭하면 점프하는지, `Space`·`←→`·`Shift+←→`·`↑↓`·`M`·`B`가 먹는지, mp3↔wav를 바꿔도 재생 위치가 유지되는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/components/ src/routes/
git commit -m "feat: 파형 재생기

파형 클릭 점프, 앞뒤 이동, 볼륨, 배속, A-B 구간 반복, 단축키.
포맷 전환 시 재생 위치를 유지해 mp3와 wav를 같은 지점에서 비교한다."
```

---

### Task 16: 북마크 메모와 목록

**Files:**
- Modify: `src/lib/components/Player.svelte`

**Interfaces:**
- Consumes: `Bookmark` (Task 1), `PATCH /api/recordings` (Task 12)
- Produces: 플레이어 안에 북마크 목록. `onbookmarkchange: (bookmarks: Bookmark[]) => void` prop 추가

- [ ] **Step 1: 북마크 편집 prop 추가**

`Player.svelte`의 props 선언을 바꾼다.

```ts
let {
  recording = null as Recording | null,
  formats = [] as string[],
  onbookmark = (_: Omit<Bookmark, 'id'>) => {},
  onbookmarkchange = (_: Bookmark[]) => {}
} = $props();
```

- [ ] **Step 2: 북마크 목록 마크업 추가**

`Player.svelte`의 컨트롤 줄 아래, `</div>`(max-w-6xl 닫는 것) 직전에 넣는다.

```svelte
{#if recording.bookmarks.length}
  <ul class="flex flex-wrap gap-2 pt-1">
    {#each recording.bookmarks.slice().sort((a, b) => a.atSec - b.atSec) as b (b.id)}
      <li class="chip preset-tonal-tertiary flex items-center gap-1">
        <button type="button" class="tabular-nums" onclick={() => seek(b.atSec)}>
          {fmt(b.atSec)}{b.endSec !== null ? `–${fmt(b.endSec)}` : ''}
        </button>
        <input
          class="input input-sm w-28"
          value={b.note}
          placeholder="메모"
          onblur={(e) =>
            onbookmarkchange(
              recording.bookmarks.map((x) =>
                x.id === b.id ? { ...x, note: e.currentTarget.value } : x
              )
            )}
        />
        <button type="button" aria-label="북마크 삭제"
          onclick={() => onbookmarkchange(recording.bookmarks.filter((x) => x.id !== b.id))}>
          ×
        </button>
      </li>
    {/each}
  </ul>
{/if}
```

- [ ] **Step 3: 구간 북마크 만들기 연결**

A‑B 구간이 잡혀 있으면 북마크 버튼이 구간 북마크를 만들게 `addBookmark`를 바꾼다.

```ts
function addBookmark() {
  if (!recording) return;
  const hasRange = loopA !== null && loopB !== null;
  onbookmark({
    atSec: hasRange ? loopA! : (audio?.currentTime ?? 0),
    endSec: hasRange ? loopB : null,
    note: ''
  });
}
```

- [ ] **Step 4: 목록 페이지에서 핸들러 연결**

`src/routes/+page.svelte`에 추가한다.

```ts
async function changeBookmarks(bookmarks: Bookmark[]) {
  if (!selected) return;
  await send({ op: 'patch', id: selected.id, bookmarks });
}
```

플레이어 사용부를 바꾼다.

```svelte
<Player
  recording={selected}
  formats={['original', ...data.formats]}
  onbookmark={addBookmark}
  onbookmarkchange={changeBookmarks}
/>
```

- [ ] **Step 5: 수동 확인**

```bash
npm run dev
```

`B`로 지점 북마크를 찍고 메모를 달아 새로고침해도 남아 있는지, A‑B를 지정한 뒤 북마크를 누르면 구간 북마크가 생기고 파형 위에 마커가 뜨는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/components/Player.svelte src/routes/+page.svelte
git commit -m "feat: 북마크 메모와 목록

A-B 구간이 잡혀 있으면 구간 북마크로, 아니면 지점 북마크로 만든다.
마커 클릭으로 점프하고 메모를 그 자리에서 고친다."
```

---

### Task 17: E2E 통합 테스트

**Files:**
- Create: `tests/e2e/import-flow.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: Task 1~16 전부
- Produces: 스캔 → 편집 → 변환 → 목록 → 재생 한 바퀴를 검증하는 E2E

- [ ] **Step 1: Playwright 설정 확인**

`playwright.config.ts`가 개발 서버를 띄우도록 되어 있는지 확인하고, `testDir`을 맞춘다.

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI
  },
  use: { baseURL: 'http://localhost:4173' }
});
```

- [ ] **Step 2: E2E 작성**

`tests/e2e/import-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const FIX_DB = path.resolve('tests/fixtures/CloudRecordings.db');
const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const QTA_NAME = '20260711 181530-1923A106.qta';

let srcDir: string;

test.beforeAll(async () => {
  srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-e2e-'));
  await fs.copyFile(SPATIAL, path.join(srcDir, QTA_NAME));
  await fs.copyFile(FIX_DB, path.join(srcDir, 'CloudRecordings.db'));
});

test.afterAll(async () => {
  await fs.rm(srcDir, { recursive: true, force: true });
  // 앱이 만든 런타임 데이터를 지워 다음 실행이 깨끗하게 시작하도록 한다
  await fs.rm(path.resolve('data'), { recursive: true, force: true });
  await fs.rm(path.resolve('media'), { recursive: true, force: true });
});

test('스캔 → 태그 입력 → 변환 → 목록 → 필터 → 재생', async ({ page }) => {
  await page.goto('/import');

  await page.getByPlaceholder('/Volumes/Storage/voice').fill(srcDir);
  await page.getByRole('button', { name: '스캔' }).click();

  // DB의 사용자 지정 제목이 자동으로 채워진다
  const titleInput = page.locator('tbody tr').first().locator('input[type="text"]').first();
  await expect(titleInput).toHaveValue('새로운 녹음 2');

  // 행에 태그를 붙인다
  await page.locator('tbody tr').first().getByPlaceholder('태그 입력 후 Enter').fill('데모');
  await page.locator('tbody tr').first().getByPlaceholder('태그 입력 후 Enter').press('Enter');

  await page.getByRole('button', { name: /저장 및 변환/ }).click();

  // 변환이 끝날 때까지 기다린다
  await expect(page.getByText(/완료 1 \/ 1/)).toBeVisible({ timeout: 60_000 });

  await page.goto('/');
  await expect(page.getByText('새로운 녹음 2')).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'mp3' })).toBeVisible();

  // 태그 필터
  await page.getByRole('button', { name: /^데모/ }).click();
  await expect(page.getByText('새로운 녹음 2')).toBeVisible();

  // 없는 제목으로 검색하면 사라진다
  await page.getByPlaceholder('제목 검색').fill('존재하지않는제목');
  await expect(page.getByText('조건에 맞는 녹음이 없습니다')).toBeVisible();
  await page.getByRole('button', { name: '초기화' }).click();

  // 재생기
  await page.getByRole('button', { name: '새로운 녹음 2' }).click();
  await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
  await expect(page.getByRole('slider', { name: '재생 위치' })).toBeVisible();

  // 포맷 전환 버튼이 원본·mp3·wav 셋 다 있다
  await expect(page.getByRole('button', { name: 'qta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'mp3', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'wav', exact: true })).toBeVisible();
});
```

- [ ] **Step 3: E2E 실행**

```bash
npx playwright install chromium
npx playwright test
```

Expected: PASS — 1 test

- [ ] **Step 4: 전체 테스트 확인**

```bash
npx vitest run && npx playwright test
```

Expected: 모든 단위 테스트와 E2E가 통과한다

- [ ] **Step 5: README 작성**

`README.md`:

````markdown
# ULS Player

음성 파일을 태그와 날짜로 정리하고, 파형이 있는 재생기로 듣는 로컬 웹 앱.

## 준비물

- Node 22 이상
- ffmpeg / ffprobe (`brew install ffmpeg`)

## 시작

```bash
npm install
cp .env.example .env
npm run dev
```

`http://localhost:5173`에서 연다.

## 사용

1. **가져오기** 화면에서 음성 파일이 있는 폴더 경로를 넣고 스캔한다
2. 애플 음성 메모 폴더라면 `CloudRecordings.db`에서 제목과 녹음 시각을 자동으로 채운다
3. 제목·설명·태그를 검토하고, 여러 행을 골라 태그를 한 번에 붙인다
4. **저장 및 변환**을 누르면 백그라운드에서 변환이 돌고 진행률이 실시간으로 표시된다

## 설정

`.env`로 조정한다. 자세한 항목은 `.env.example` 참고.

- `OUTPUT_FORMATS` — 만들 포맷 (기본 `mp3,wav`)
- `CONVERT_CONCURRENCY` — 동시 변환 수 (기본 4)
- `WAVEFORM_PEAKS` — 파형 해상도 (기본 2000)

## 단축키

| 키 | 동작 |
|---|---|
| `Space` | 재생 / 일시정지 |
| `←` `→` | 5초 이동 |
| `Shift` + `←` `→` | 10초 이동 |
| `↑` `↓` | 볼륨 |
| `M` | 음소거 |
| `B` | 북마크 |

## 테스트

```bash
npx vitest run      # 단위·통합
npx playwright test # E2E
```

## 설계 문서

`docs/superpowers/specs/2026-08-31-uls-player-design.md`
````

- [ ] **Step 6: 커밋**

```bash
git add tests/e2e/ playwright.config.ts README.md
git commit -m "test: 가져오기부터 재생까지 E2E

스캔에서 DB 제목이 채워지는지, 변환 후 세 포맷이 다 생기는지,
필터와 재생기가 붙는지 한 바퀴로 검증한다."
```

---

### Task 18: 작업 영속화와 디스크 여유 확인

**Files:**
- Create: `src/lib/server/jobs/persist.ts`
- Create: `src/lib/server/jobs/persist.test.ts`
- Create: `src/lib/server/disk.ts`
- Create: `src/lib/server/disk.test.ts`
- Modify: `src/lib/server/jobs/runner.ts` (`getQueue`에 복구 연결)
- Modify: `src/routes/import/+page.server.ts` (`enqueue`에 여유 확인 추가)

스펙 11절의 "서버 재시작 → `jobs.json`의 미완료 작업을 시작 시 복구"와 "디스크 부족 → 시작 자체를 거부" 두 항목을 채운다.

**Interfaces:**
- Consumes: `JobQueue` (Task 10), `updateJson`/`readJson` (Task 2), `AppConfig`·`JobItem`·`JobsFile` (Task 1)
- Produces:
  - `persistQueue(cfg: AppConfig, queue: JobQueue): void` — 큐 변경을 `jobs.json`에 반영
  - `loadUnfinished(cfg: AppConfig): Promise<JobItem[]>` — `pending`/`running` 상태로 남은 작업
  - `freeBytes(dirPath: string): Promise<number>`
  - `estimateBytes(cfg: AppConfig, sourceBytes: number[]): number`
  - `DiskShortage` 에러 클래스

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/disk.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config';
import { freeBytes, estimateBytes } from './disk';

describe('freeBytes', () => {
  it('임시 디렉터리의 여유 공간을 양수로 준다', async () => {
    expect(await freeBytes(os.tmpdir())).toBeGreaterThan(0);
  });

  it('아직 없는 경로는 존재하는 상위로 올라가서 잰다', async () => {
    // media/ 는 첫 변환 전까지 없다. 그래도 여유를 잴 수 있어야 한다.
    expect(await freeBytes(path.join(os.tmpdir(), 'not-created-yet', 'deeper'))).toBeGreaterThan(0);
  });
});

describe('estimateBytes', () => {
  it('원본 복사분을 포함한다', () => {
    const cfg = loadConfig({ OUTPUT_FORMATS: '' });
    // 포맷이 없으면 원본 복사분만 필요하다
    expect(estimateBytes(cfg, [1000, 2000])).toBe(3000);
  });

  it('mp3는 원본보다 작게, wav는 크게 잡는다', () => {
    const cfg = loadConfig({ OUTPUT_FORMATS: 'mp3,wav' });
    const only = loadConfig({ OUTPUT_FORMATS: 'mp3' });
    expect(estimateBytes(cfg, [1000])).toBeGreaterThan(estimateBytes(only, [1000]));
  });

  it('빈 목록은 0이다', () => {
    expect(estimateBytes(loadConfig({}), [])).toBe(0);
  });
});
```

`src/lib/server/jobs/persist.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, JobItem } from '$lib/types';
import { loadConfig } from '../config';
import { JobQueue } from './queue';
import { persistQueue, loadUnfinished } from './persist';

function item(id: string): JobItem {
  return {
    id, recordingId: `rec-${id}`, sourcePath: `/tmp/${id}.qta`, title: id,
    status: 'pending', formats: { mp3: 'pending' }, error: null
  };
}

let dir: string;
let cfg: AppConfig;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-persist-'));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data') });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('persistQueue', () => {
  it('큐 상태를 jobs.json에 남긴다', async () => {
    const q = new JobQueue(1, async () => ({ mp3: 'done' }));
    persistQueue(cfg, q);
    q.enqueue([item('a')]);
    await q.idle();
    // 구독 콜백이 비동기로 쓰므로 한 틱 기다린다
    await new Promise((r) => setTimeout(r, 50));

    const raw = JSON.parse(await fs.readFile(path.join(cfg.dataDir, 'jobs.json'), 'utf8'));
    expect(raw.items).toHaveLength(1);
    expect(raw.items[0].status).toBe('done');
  });
});

describe('loadUnfinished', () => {
  it('파일이 없으면 빈 배열이다', async () => {
    expect(await loadUnfinished(cfg)).toEqual([]);
  });

  it('완료된 작업은 빼고 미완료만 준다', async () => {
    await fs.mkdir(cfg.dataDir, { recursive: true });
    await fs.writeFile(
      path.join(cfg.dataDir, 'jobs.json'),
      JSON.stringify({
        version: 1,
        items: [
          { ...item('done'), status: 'done' },
          { ...item('failed'), status: 'failed' },
          { ...item('running'), status: 'running' },
          item('pending')
        ]
      })
    );
    const left = await loadUnfinished(cfg);
    expect(left.map((i) => i.id).sort()).toEqual(['pending', 'running']);
    // 중단된 running은 pending으로 되돌려 다시 돌게 한다
    expect(left.every((i) => i.status === 'pending')).toBe(true);
  });
});
```

`failed`는 복구 대상에서 뺀다. 재시도는 사용자가 화면에서 명시적으로 누르는 동작이다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/disk.test.ts src/lib/server/jobs/persist.test.ts
```

Expected: FAIL — `Failed to resolve import "./disk"` / `"./persist"`

- [ ] **Step 3: 디스크 모듈 구현**

`src/lib/server/disk.ts`:

```ts
import { statfs } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '$lib/types';

export class DiskShortage extends Error {
  constructor(
    readonly needBytes: number,
    readonly freeBytes: number
  ) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
    super(`디스크 여유가 부족합니다. 필요 약 ${gb(needBytes)}GB, 남은 공간 ${gb(freeBytes)}GB`);
    this.name = 'DiskShortage';
  }
}

/**
 * 여유 공간을 잰다. 경로가 아직 없으면 존재하는 가장 가까운 상위로 올라간다.
 * media/ 는 첫 변환 전까지 없을 수 있다.
 */
export async function freeBytes(dirPath: string): Promise<number> {
  let p = path.resolve(dirPath);
  for (;;) {
    try {
      const s = await statfs(p);
      return Number(s.bavail) * Number(s.bsize);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = path.dirname(p);
      if (parent === p) throw err;
      p = parent;
    }
  }
}

/**
 * 포맷별 대략적인 크기 배수. 원본 대비 비율이며 안전하게 넉넉히 잡는다.
 * 측정값: 19.8MB qta → mp3 6.3MB(0.32배), wav 44.1k/mono 23MB(1.16배).
 */
const SIZE_RATIO: Record<string, number> = { mp3: 0.5, wav: 1.5 };

/** 원본 복사분 + 포맷별 예상 크기의 합. */
export function estimateBytes(cfg: AppConfig, sourceBytes: number[]): number {
  const total = sourceBytes.reduce((a, b) => a + b, 0);
  const multiplier = cfg.formats.reduce((acc, f) => acc + (SIZE_RATIO[f.name] ?? 1), 1);
  return Math.round(total * multiplier);
}
```

- [ ] **Step 4: 작업 영속화 구현**

`src/lib/server/jobs/persist.ts`:

```ts
import path from 'node:path';
import type { AppConfig, JobItem, JobsFile } from '$lib/types';
import { readJson, updateJson } from '../store/atomic';
import type { JobQueue } from './queue';

const EMPTY: JobsFile = { version: 1, items: [] };

function file(cfg: AppConfig): string {
  return path.join(cfg.dataDir, 'jobs.json');
}

/** 큐가 바뀔 때마다 jobs.json에 스냅샷을 남긴다. */
export function persistQueue(cfg: AppConfig, queue: JobQueue): void {
  queue.subscribe((items) => {
    void updateJson<JobsFile>(file(cfg), (cur) => ({ ...cur, items }), EMPTY);
  });
}

/**
 * 재시작 시 이어서 돌릴 작업.
 * 중단된 running은 pending으로 되돌린다. failed는 사용자가 재시도를 눌러야 한다.
 */
export async function loadUnfinished(cfg: AppConfig): Promise<JobItem[]> {
  const { items } = await readJson<JobsFile>(file(cfg), EMPTY);
  return items
    .filter((i) => i.status === 'pending' || i.status === 'running')
    .map((i) => ({ ...i, status: 'pending' as const }));
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/disk.test.ts src/lib/server/jobs/persist.test.ts
```

Expected: PASS — 7 tests

- [ ] **Step 6: 큐 생성 시 복구 연결**

`src/lib/server/jobs/runner.ts`의 `getQueue`를 바꾼다.

```ts
import { persistQueue, loadUnfinished } from './persist';

let queue: JobQueue | null = null;

/**
 * 프로세스당 하나. 처음 만들 때 jobs.json의 미완료 작업을 이어받는다.
 *
 * 복구된 작업은 pendingRecordings에 원본 녹음 항목이 없으므로 변환만 다시 하고
 * 저장소 기록은 건너뛴다. 프로세스가 죽기 전 이미 기록됐거나, 기록 전이라면
 * 사용자가 다시 가져오면 된다.
 */
export function getQueue(cfg: AppConfig): JobQueue {
  if (!queue) {
    queue = new JobQueue(cfg.convertConcurrency, makeRunner(cfg));
    persistQueue(cfg, queue);
    void loadUnfinished(cfg).then((items) => {
      if (items.length) queue!.enqueue(items);
    });
  }
  return queue;
}
```

- [ ] **Step 7: 가져오기 액션에 여유 확인 추가**

`src/routes/import/+page.server.ts`의 `enqueue`를 바꾼다. 상단 임포트에 추가한다.

```ts
import { freeBytes, estimateBytes, DiskShortage } from '$lib/server/disk';
```

`enqueue` 안에서 `buildJobs` 호출 전에 넣는다.

```ts
// 변환을 시작하기 전에 여유 공간을 확인한다. 중간에 꽉 차면
// 반쯤 변환된 파일들이 남아 정리가 어렵다.
const need = estimateBytes(config, pending.map((p) => p.scan.bytes));
try {
  const free = await freeBytes(config.mediaDir);
  if (need > free) return fail(507, { message: new DiskShortage(need, free).message });
} catch {
  // 여유를 잴 수 없으면 막지 않고 진행한다
}
```

`freeBytes`가 없는 경로를 만나면 존재하는 상위로 올라가므로, `media/`가 아직 만들어지지 않았어도 그대로 넘기면 된다.

- [ ] **Step 8: 수동 확인**

```bash
npm run dev
```

가져오기에서 소량을 변환한 뒤 서버를 껐다 켠다.

```bash
cat data/jobs.json | head -20
```

Expected: 완료된 작업이 `done`으로 남아 있다. 변환 중간에 서버를 죽이면 재시작 후 남은 작업이 자동으로 이어서 돈다.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/server/disk.ts src/lib/server/disk.test.ts src/lib/server/jobs/ src/routes/import/
git commit -m "feat: 작업 영속화와 디스크 여유 확인

큐 스냅샷을 jobs.json에 남기고 재시작 시 미완료 작업을 이어받는다.
변환 시작 전 예상 용량과 여유 공간을 비교해 부족하면 거부한다."
```

---

### Task 19: 브라우저 업로드

**Files:**
- Modify: `src/routes/import/+page.server.ts` (`upload` 액션 추가)
- Modify: `src/routes/import/+page.svelte` (드래그앤드롭 영역)
- Create: `src/lib/server/upload.ts`
- Create: `src/lib/server/upload.test.ts`

스펙 8.1의 "폴더 경로 입력 **또는 드래그앤드롭**" 중 후자를 채운다. 업로드받은 파일을 임시 폴더에 쓰고 같은 `scanFolder`를 태우므로 이후 흐름은 그대로 재사용된다.

**Interfaces:**
- Consumes: `scanFolder` (Task 9), `AUDIO_EXTENSIONS` (Task 9), `AppConfig` (Task 1)
- Produces:
  - `saveUploads(cfg: AppConfig, files: File[]): Promise<string>` — 저장한 임시 폴더 경로
  - `UploadTooLarge` 에러 클래스

업로드된 파일은 `CloudRecordings.db`를 동반하지 않는 경우가 많다. 그때는 Task 9의 대체 경로(파일 메타 title)가 그대로 작동한다. DB를 함께 끌어다 놓으면 제목이 복원된다.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/server/upload.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '$lib/types';
import { loadConfig } from './config';
import { saveUploads, UploadTooLarge } from './upload';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');

let dir: string;
let cfg: AppConfig;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-upload-'));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data'), MEDIA_DIR: path.join(dir, 'media') });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function fileFrom(p: string, name: string): Promise<File> {
  return new File([await fs.readFile(p)], name);
}

describe('saveUploads', () => {
  it('오디오 파일을 임시 폴더에 쓴다', async () => {
    const out = await saveUploads(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    expect(await fs.readdir(out)).toEqual(['a.qta']);
  });

  it('CloudRecordings.db도 함께 받는다', async () => {
    const db = new File([Buffer.from('x')], 'CloudRecordings.db');
    const out = await saveUploads(cfg, [await fileFrom(SPATIAL, 'a.qta'), db]);
    expect((await fs.readdir(out)).sort()).toEqual(['CloudRecordings.db', 'a.qta']);
  });

  it('오디오도 DB도 아닌 파일은 버린다', async () => {
    const junk = new File([Buffer.from('x')], 'notes.txt');
    const out = await saveUploads(cfg, [await fileFrom(SPATIAL, 'a.qta'), junk]);
    expect(await fs.readdir(out)).toEqual(['a.qta']);
  });

  it('경로 구분자가 든 이름은 파일명만 남긴다', async () => {
    const out = await saveUploads(cfg, [await fileFrom(SPATIAL, '../../evil.qta')]);
    expect(await fs.readdir(out)).toEqual(['evil.qta']);
  });

  it('MAX_UPLOAD_MB를 넘으면 던진다', async () => {
    const small = loadConfig({ DATA_DIR: path.join(dir, 'd'), MAX_UPLOAD_MB: '0.001' });
    await expect(saveUploads(small, [await fileFrom(SPATIAL, 'a.qta')])).rejects.toThrow(
      UploadTooLarge
    );
  });

  it('받을 게 없으면 던진다', async () => {
    await expect(saveUploads(cfg, [])).rejects.toThrow(/오디오/);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/server/upload.test.ts
```

Expected: FAIL — `Failed to resolve import "./upload"`

- [ ] **Step 3: 구현**

`src/lib/server/upload.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '$lib/types';
import { AUDIO_EXTENSIONS } from './scan';

const DB_NAMES = new Set(['CloudRecordings.db', 'CloudRecordings.db-wal', 'CloudRecordings.db-shm']);

export class UploadTooLarge extends Error {
  constructor(name: string, limitMb: number) {
    super(`${name}이(가) 업로드 한도 ${limitMb}MB를 넘습니다`);
    this.name = 'UploadTooLarge';
  }
}

/**
 * 업로드받은 파일을 임시 폴더에 쓰고 그 경로를 준다.
 * 이후는 폴더 스캔과 같은 경로를 탄다.
 */
export async function saveUploads(cfg: AppConfig, files: File[]): Promise<string> {
  const limit = cfg.maxUploadMb * 1024 * 1024;

  const keep = files.filter((f) => {
    // 브라우저가 경로를 붙여 보내도 파일명만 쓴다
    const name = path.basename(f.name);
    return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()) || DB_NAMES.has(name);
  });

  const audio = keep.filter((f) => !DB_NAMES.has(path.basename(f.name)));
  if (audio.length === 0) throw new Error('오디오 파일이 없습니다');

  for (const f of keep) {
    if (f.size > limit) throw new UploadTooLarge(path.basename(f.name), cfg.maxUploadMb);
  }

  const dir = await fs.mkdtemp(path.join(cfg.dataDir, 'uploads-'));
  for (const f of keep) {
    const dest = path.join(dir, path.basename(f.name));
    await fs.writeFile(dest, Buffer.from(await f.arrayBuffer()));
  }
  return dir;
}
```

`fs.mkdtemp`가 `cfg.dataDir` 아래에 만들므로 상위 디렉터리를 먼저 보장해야 한다. 함수 첫 줄에 추가한다.

```ts
await fs.mkdir(cfg.dataDir, { recursive: true });
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/server/upload.test.ts
```

Expected: PASS — 6 tests

- [ ] **Step 5: 업로드 액션 추가**

`src/routes/import/+page.server.ts`의 `actions`에 추가한다. 상단 임포트도 함께 넣는다.

```ts
import { saveUploads, UploadTooLarge } from '$lib/server/upload';
```

```ts
  upload: async ({ request }) => {
    const form = await request.formData();
    const files = form.getAll('files').filter((v): v is File => v instanceof File);

    let folder: string;
    try {
      folder = await saveUploads(config, files);
    } catch (err) {
      const status = err instanceof UploadTooLarge ? 413 : 400;
      return fail(status, { message: (err as Error).message });
    }

    return { items: await scanFolder(config, folder) };
  },
```

업로드본은 `data/uploads-*`에 남지만, Task 11의 러너가 원본을 `media/original`로 복사하므로 변환이 끝난 뒤에는 지워도 된다. 지금은 남겨둔다 — 실패한 변환을 재시도할 때 원본이 필요하기 때문이다.

- [ ] **Step 6: 드래그앤드롭 영역 추가**

`src/routes/import/+page.svelte`의 스캔 폼 아래에 넣는다.

```svelte
<form
  method="POST"
  action="?/upload"
  enctype="multipart/form-data"
  use:enhance
  class="card preset-tonal p-4"
>
  <label class="flex flex-col gap-2">
    <span class="text-sm">또는 파일을 직접 올립니다 (CloudRecordings.db를 함께 올리면 제목이 복원됩니다)</span>
    <input
      type="file"
      name="files"
      class="input"
      multiple
      accept="audio/*,.qta,.m4a,.caf,.db"
      onchange={(e) => e.currentTarget.form?.requestSubmit()}
    />
  </label>
</form>
```

`onchange`에서 바로 제출하므로 버튼이 따로 필요 없다.

- [ ] **Step 7: 수동 확인**

```bash
npm run dev
```

`~/Dev/SIDE_PROJECT/_voice_sample`에서 `.qta` 두어 개와 `CloudRecordings.db`를 함께 골라 올린다.

Expected: 폴더 스캔과 같은 편집 테이블이 뜨고, DB를 같이 올렸으면 사용자 지정 제목이 채워져 있다. DB 없이 올리면 파일 메타의 위치 이름이 제목에 들어간다.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/server/upload.ts src/lib/server/upload.test.ts src/routes/import/
git commit -m "feat: 브라우저 업로드

업로드본을 임시 폴더에 쓰고 폴더 스캔과 같은 경로를 태운다.
CloudRecordings.db를 함께 올리면 제목이 복원된다."
```

---

## 자체 검토

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| 폴더 스캔 | Task 9, 13 |
| 브라우저 업로드 | Task 19 |
| CloudRecordings.db 제목 복원 | Task 5, 9 |
| env 지정 포맷 일괄 변환 | Task 1, 7, 11 |
| 원본 항상 복사 | Task 11 |
| 태그 일괄 편집 | Task 3, 13, 14 |
| 제목·태그 AND/OR·날짜 필터 | Task 4, 14 |
| 필터 상태 URL 반영 | Task 4, 14 |
| 파형 · 구간반복 · 배속 · 단축키 | Task 15 |
| 포맷 전환 시 재생 위치 유지 | Task 15 |
| 북마크 (지점/구간) | Task 16 |
| 백그라운드 큐 + SSE 진행률 | Task 10, 12, 13 |
| 실패한 것만 재시도 | Task 10, 13 |
| 소프트 삭제 | Task 3, 14 |
| 중복 감지 | Task 3, 9 |
| 테스트 (Vitest / Playwright) | Task 1~11, 17~19 |

스펙 11절 에러 처리 표의 대응:

| 스펙 항목 | 태스크 |
|---|---|
| 특정 파일 변환 실패 → 항목만 failed | Task 10 |
| mp3 성공 · wav 실패 → 실패 포맷만 재시도 | Task 10, 11 |
| 디코딩 가능한 스트림 없음 | Task 6 |
| 서버 재시작 → 미완료 작업 복구 | Task 18 |
| 디스크 부족 → 시작 거부 | Task 18 |
| 손상 파일 → 스캔에서 제외 | Task 9 |
| `CloudRecordings.db` 없음 → 파일명으로 진행 | Task 5, 9 |
| JSON 쓰기 원자성·직렬화 | Task 2 |

**남는 간극 하나**

Task 18의 재시작 복구는 변환 작업만 이어받는다. `pendingRecordings`(Task 11)가 인메모리라 프로세스가 죽으면 사라지므로, 복구된 작업은 파일을 다시 만들지만 저장소에는 기록되지 않는다. Task 18 Step 6의 주석에 이 동작을 명시해뒀다.

완전히 메우려면 `pendingRecordings`도 `jobs.json`에 함께 넣어야 하는데, 그러면 작업 큐가 녹음 항목까지 들고 있게 되어 `store`와 `jobs`의 경계가 흐려진다. 로컬 단일 사용자 환경에서 변환 도중 프로세스가 죽는 빈도를 감안하면, 사용자가 다시 가져오는 편이 낫다고 보고 현재 설계를 유지했다. 서버로 옮길 때 다시 볼 지점이다.

**플레이스홀더 점검**

TBD·TODO·"적절히 처리"류 표현 없음. 모든 코드 스텝에 실제 코드가 들어 있고, 테스트 스텝은 단언까지 적혀 있다.

**타입 일관성**

`AppConfig`·`FormatSpec`·`Recording`·`ScanItem`·`JobItem`·`Bookmark`는 Task 1에서 한 번 정의하고 이후 태스크가 그대로 쓴다.

`probe()`의 `audioStreamIndex`는 절대 스트림 인덱스이고, `convert()`와 `generatePeaks()`가 `-map 0:<index>`로 소비한다 — 세 곳의 의미가 일치한다. 오디오 상대 인덱스(`0:a:N`)와 섞이지 않는다.

`JobQueue` worker의 반환 타입 `Record<string, JobStatus>`는 Task 10의 정의와 Task 11 `makeRunner`의 반환이 일치한다.

`AUDIO_EXTENSIONS`는 Task 9에서 정의하고 Task 19가 재사용한다.

`send({ op: 'patch', ... })`가 넘기는 필드(`title`·`description`·`tags`·`bookmarks`)는 Task 3 `patch`의 `Patchable` 타입과 Task 12 `Body` 타입 양쪽에 모두 있다.

**타입 일관성**

`AppConfig`·`FormatSpec`·`Recording`·`ScanItem`·`JobItem`은 Task 1에서 한 번 정의하고 이후 태스크가 그대로 쓴다. `probe()`의 `audioStreamIndex`는 절대 인덱스이고 `convert()`·`generatePeaks()`가 `-map 0:<index>`로 소비한다 — 세 곳의 의미가 일치한다. `JobQueue`의 worker 반환 타입 `Record<string, JobStatus>`는 Task 10의 정의와 Task 11의 `makeRunner` 반환이 일치한다.
