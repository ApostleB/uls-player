# 변환·기동 속도 개선과 같은 포맷 복사 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원본이 이미 출력 포맷이면 변환 대신 복사하고, mp3 인코더 레벨을 설정으로 고르게 하며, 데스크톱 앱의 동시 변환 수를 코어에 맞추고, 창을 서버보다 먼저 띄우고, 배포물의 언어 파일을 줄인다.

**Architecture:** 복사 판정은 ffprobe가 본 컨테이너와 코덱으로 하는 순수 함수 하나로 떼고, 러너의 포맷별 루프가 그 결과에 따라 `convert` 대신 파일을 복사한다. mp3 레벨은 기존 `MP3_BITRATE`와 같은 방식의 환경변수다. 동시 변환 수와 창 순서는 Electron 셸만 바꾸고 서버 배포의 기본 동작은 그대로 둔다.

**Tech Stack:** SvelteKit 2 / Svelte 5, Node, ffmpeg/ffprobe, Electron 44, electron-builder 26, vitest, Playwright `_electron`

**설계 문서:** `docs/superpowers/specs/2026-09-30-conversion-startup-speed-design.md`

## Global Constraints

- **복사 판정은 컨테이너와 코덱 둘 다로 한다.** mp3 출력 ← `formatName === 'mp3'` 이고 `codecName === 'mp3'`. wav 출력 ← `formatName === 'wav'` 이고 `codecName`이 `'pcm_'`로 시작. 그 밖의 출력 포맷은 **항상 변환**한다.
- **복사는 출력 설정보다 우선한다.** 원본이 같은 포맷이면 비트레이트·샘플레이트·채널 설정을 따르지 않고 원본 바이트 그대로 복사한다(사용자 결정).
- **`MP3_COMPRESSION_LEVEL`은 0~9의 정수다.** 비어 있거나 없으면 `null`. 그 밖의 값은 기동 시 `Error`로 거부한다. `null`이면 `convert`는 `-compression_level`을 **넘기지 않는다** — 지금과 똑같은 인코딩이다.
- **서버 배포의 기본 동작 중 바뀌는 것은 복사 규칙 하나뿐이다.** `CONVERT_CONCURRENCY` 기본값 4와 mp3 인코더 설정은 그대로다.
- **데스크톱의 `CONVERT_CONCURRENCY` 기본값은 `max(1, cpuCount − 1)`이다.** 바깥 환경변수에 값이 있으면 그 값이 이긴다. 빈 문자열은 지정하지 않은 것으로 본다.
- **로딩 화면 배경색:** 어두운 테마 `#121212`, 밝은 테마 `#fcfcfc`. 앱 테마(Skeleton cerberus)의 body 배경인 `surface-950`(`oklch(0.18 0 0)`)과 `surface-50`(`oklch(0.99 0 0)`)을 sRGB로 바꾼 값이다.
- **로딩 화면에는 heading 요소(`h1`~`h6`)를 쓰지 않는다.** 기존 e2e가 `getByRole('heading', { name: 'ULS Player' })`로 앱 화면이 떴는지 판단하는데, 로딩 화면에 같은 이름의 heading이 있으면 그 단언이 로딩 화면에서 통과해 버린다.
- `electron-builder.yml`의 `electronLanguages`는 `[ko, en-US]`.
- 주석과 커밋 메시지는 **한국어**로 쓴다. 주석은 "무엇을"이 아니라 "왜"를 — 어떤 실패를 막으려는지를 적는다.
- 테스트는 `vite.config.ts`의 `expect: { requireAssertions: true }` 아래 돈다 — **단언 없는 테스트는 실패한다.**
- 커밋 트레일러: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## 이미 확인된 사실 (다시 조사하지 말 것)

| 사실 | 확인 방법 |
|---|---|
| ffprobe의 `format.format_name`: mp3 파일 `mp3`, wav 파일 `wav`, QTA `mov,mp4,m4a,3gp,3g2,mj2`, AIFF `aiff` | 실제 파일로 측정 |
| 이름만 `.mp3`로 바꾼 AAC(MP4 컨테이너)는 `format_name`이 `mov,mp4,m4a,3gp,3g2,mj2`, 코덱 `aac` | 실제 파일로 측정 |
| AIFF의 코덱은 `pcm_s16be` — 코덱만 보면 PCM이다 | 실제 파일로 측정 |
| `ProbeResult`에는 이미 `codecName`(선택된 오디오 스트림의 코덱)이 있다. 컨테이너 이름만 없다 | `src/lib/server/media/probe.ts:14-23` |
| `ProbeResult` 리터럴을 직접 만드는 코드는 저장소에 없다 — 필드를 더해도 다른 파일이 깨지지 않는다 | `grep -rn "codecName:" src tests` |
| `FormatSpec` 리터럴은 `src/lib/server/config.ts`의 `FORMAT_DEFAULTS`와 `src/lib/server/media/binaries.wiring.test.ts:60` 두 곳뿐이다 | `grep -rn "sampleRate:" src tests` |
| `runner.test.ts`는 `../media/convert`를 `vi.fn(actual.convert)`로 감싸 두고 `beforeEach`에서 `mockReset`한다 — 테스트 안에서 `vi.mocked(convertModule.convert).mock.calls`로 어떤 포맷에 불렸는지 셀 수 있다 | `src/lib/server/jobs/runner.test.ts:21-28, 52-54` |
| 테스트 픽스처는 `tests/fixtures/audio/spatial.qta`(aac 2ch + apple_apac 4ch)와 `plain.m4a` 둘뿐이다. mp3·wav 원본은 테스트 안에서 ffmpeg로 만든다 | `ls tests/fixtures/audio/` |
| 설치된 Electron에 `webContents.navigationHistory.getAllEntries()`가 있다 | `node_modules/electron/electron.d.ts:10240` |
| mp3 인코딩(현재 설정)은 파일당 1.78초, `compression_level 7`이면 0.81초. 24개 배치: 동시 4 → 15.1초, 동시 12 → 9.9초 | 이 맥(12코어)에서 측정 |

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/server/media/probe.ts` | `ProbeResult.formatName` 추가 | 1 |
| `src/lib/server/media/sameFormat.ts` (신규) | "원본이 이미 이 출력 포맷인가" 판정 | 1 |
| `src/lib/server/jobs/runner.ts` | 판정이 맞으면 변환 대신 복사 | 1 |
| `src/lib/types.ts` | `FormatSpec.compressionLevel` | 2 |
| `src/lib/server/config.ts` | `${포맷}_COMPRESSION_LEVEL` 읽기·검증 | 2 |
| `src/lib/server/media/convert.ts` | 레벨이 있으면 `-compression_level` 전달 | 2 |
| `src/lib/desktop/env.ts` | `CONVERT_CONCURRENCY` 기본값 | 3 |
| `electron/main.ts` | 코어 수 전달(3), 창 먼저 띄우기(4) | 3, 4 |
| `electron-builder.yml` | `electronLanguages` | 5 |
| `scripts/bench-convert.sh` (신규) | 변환 처리량 측정 도구 | 5 |
| `docs/desktop-packaging.md` | 설정과 측정 결과 | 5 |

---

### Task 1: 원본이 이미 출력 포맷이면 복사

**Files:**
- Modify: `src/lib/server/media/probe.ts:13-23` (ProbeResult), `:31-34` (RawProbe), `:76-84` (return)
- Create: `src/lib/server/media/sameFormat.ts`
- Create: `src/lib/server/media/sameFormat.test.ts`
- Modify: `src/lib/server/media/probe.test.ts` (테스트 하나 추가)
- Modify: `src/lib/server/jobs/runner.ts` (포맷별 루프의 `convert` 호출부)
- Modify: `src/lib/server/jobs/runner.test.ts` (describe 하나 추가)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `ProbeResult.formatName: string` — ffprobe의 `format.format_name` 그대로
  - `isSameFormat(outputFormat: string, source: { formatName: string; codecName: string }): boolean` from `src/lib/server/media/sameFormat.ts`

- [ ] **Step 1: probe가 컨테이너 이름을 돌려주는지 확인하는 테스트를 쓴다**

`src/lib/server/media/probe.test.ts`의 `describe('probe', …)` 안, 첫 `it` 바로 다음에 더한다:

```ts
  it('컨테이너 이름을 돌려준다 — 복사 판정이 확장자 대신 이것을 본다', async () => {
    expect((await probe(SPATIAL)).formatName).toBe('mov,mp4,m4a,3gp,3g2,mj2');
    expect((await probe(PLAIN)).formatName).toBe('mov,mp4,m4a,3gp,3g2,mj2');
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/server/media/probe.test.ts`
Expected: FAIL — `expected undefined to be 'mov,mp4,m4a,3gp,3g2,mj2'`

- [ ] **Step 3: probe에 formatName을 더한다**

`src/lib/server/media/probe.ts`의 `ProbeResult`에서 `channels: number;` 다음에:

```ts
  /**
   * ffprobe의 format.format_name. 예: 'mp3', 'wav', 'aiff',
   * 'mov,mp4,m4a,3gp,3g2,mj2'. 확장자는 거짓말을 할 수 있어서, 원본이
   * 이미 출력 포맷인지 판정할 때 이것을 본다(sameFormat.ts).
   */
  formatName: string;
```

`RawProbe`의 `format` 타입을 바꾼다:

```ts
interface RawProbe {
  streams?: RawStream[];
  format?: { duration?: string; format_name?: string; tags?: Record<string, string> };
}
```

return 객체의 `channels: usable.channels ?? 0` 다음에:

```ts
    channels: usable.channels ?? 0,
    formatName: raw.format?.format_name ?? ''
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/server/media/probe.test.ts`
Expected: PASS

- [ ] **Step 5: 판정 함수 테스트를 쓴다**

`src/lib/server/media/sameFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isSameFormat } from './sameFormat';

const QTA = { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', codecName: 'aac' };

describe('원본이 이미 출력 포맷인가', () => {
  it('mp3 컨테이너의 mp3 코덱은 mp3다', () => {
    expect(isSameFormat('mp3', { formatName: 'mp3', codecName: 'mp3' })).toBe(true);
  });

  it('이름만 .mp3인 AAC는 mp3가 아니다 — 확장자가 아니라 내용으로 판정한다', () => {
    expect(isSameFormat('mp3', { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', codecName: 'aac' })).toBe(
      false
    );
  });

  it('MP4 컨테이너에 든 mp3 코덱은 mp3가 아니다 — 복사하면 .mp3 이름의 MP4가 된다', () => {
    expect(isSameFormat('mp3', { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', codecName: 'mp3' })).toBe(
      false
    );
  });

  it('wav 컨테이너의 PCM은 비트 깊이와 무관하게 wav다', () => {
    expect(isSameFormat('wav', { formatName: 'wav', codecName: 'pcm_s16le' })).toBe(true);
    expect(isSameFormat('wav', { formatName: 'wav', codecName: 'pcm_s24le' })).toBe(true);
  });

  it('AIFF의 PCM은 wav가 아니다 — 코덱만 보면 .wav 이름의 AIFF가 된다', () => {
    expect(isSameFormat('wav', { formatName: 'aiff', codecName: 'pcm_s16be' })).toBe(false);
  });

  it('wav 컨테이너라도 PCM이 아니면 wav로 복사하지 않는다', () => {
    expect(isSameFormat('wav', { formatName: 'wav', codecName: 'adpcm_ms' })).toBe(false);
  });

  it('QTA의 AAC는 mp3도 wav도 아니다', () => {
    expect(isSameFormat('mp3', QTA)).toBe(false);
    expect(isSameFormat('wav', QTA)).toBe(false);
  });

  it('규칙이 없는 출력 포맷은 항상 변환한다', () => {
    expect(isSameFormat('flac', { formatName: 'flac', codecName: 'flac' })).toBe(false);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/server/media/sameFormat.test.ts`
Expected: FAIL — `Failed to load url ./sameFormat`

- [ ] **Step 7: 판정 함수를 만든다**

`src/lib/server/media/sameFormat.ts`:

```ts
import type { ProbeResult } from './probe';

type Source = Pick<ProbeResult, 'formatName' | 'codecName'>;

/**
 * 출력 포맷별 "원본이 이미 이 포맷이다"의 조건.
 *
 * 컨테이너와 코덱을 **둘 다** 본다. 하나만 보면 틀린다:
 * - 확장자(=컨테이너 추정)만 보면, 이름만 .mp3인 AAC가 "mp3"로 복사돼
 *   재생되지 않는 파일이 생긴다.
 * - 코덱만 보면, AIFF(pcm_s16be)가 .wav 이름으로 복사돼 실제로는
 *   AIFF인 "wav"가 생긴다.
 *
 * 여기 없는 포맷은 항상 변환한다 — 모르는 것을 복사해서 잘못된 파일을
 * 만드는 것보다, 한 번 더 인코딩하는 편이 안전하다.
 */
const RULES: Record<string, (s: Source) => boolean> = {
  mp3: (s) => s.formatName === 'mp3' && s.codecName === 'mp3',
  wav: (s) => s.formatName === 'wav' && s.codecName.startsWith('pcm_')
};

export function isSameFormat(outputFormat: string, source: Source): boolean {
  const rule = RULES[outputFormat];
  return rule ? rule(source) : false;
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/server/media/sameFormat.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 9: 러너 테스트를 쓴다**

`src/lib/server/jobs/runner.test.ts` 맨 위 import 블록에 더한다:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
```

그리고 파일 맨 끝에 describe 하나를 더한다:

```ts
describe('원본이 이미 출력 포맷이면', () => {
  const exec = promisify(execFile);

  /**
   * SPATIAL의 첫 오디오 스트림(aac)을 원하는 포맷으로 바꿔 원본 폴더를 하나
   * 만들고 스캔한다. 픽스처에 mp3·wav 원본이 없어서 테스트 안에서 만든다.
   */
  async function makeSource(name: string, codecArgs: string[]): Promise<ScanItem> {
    const folder = path.join(dir, `src-${path.parse(name).name}`);
    await fs.mkdir(folder, { recursive: true });
    await exec('ffmpeg', ['-v', 'error', '-i', SPATIAL, '-map', '0:a:0', ...codecArgs, path.join(folder, name)]);
    const items = await scanFolder(cfg, folder);
    return items[0];
  }

  async function runOne(item: ScanItem) {
    const { recordings, jobs } = buildJobs(cfg, [{ scan: item, title: 't', description: '', tags: [] }]);
    const q = new JobQueue(1, makeRunner(cfg));
    q.enqueue(jobs);
    await q.idle();
    return { id: recordings[0].id, status: q.snapshot()[0].status };
  }

  /** 이번 실행에서 convert가 어떤 출력 포맷에 불렸는지. */
  function convertedFormats(): string[] {
    return vi.mocked(convertModule.convert).mock.calls.map((c) => c[3].name);
  }

  it('mp3 원본은 mp3 출력을 다시 인코딩하지 않고 원본 그대로 복사한다', async () => {
    // 설정은 192k다. 128k 원본을 다시 인코딩했다면 바이트가 달라진다.
    const item = await makeSource('a.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k']);
    const { id, status } = await runOne(item);

    expect(status).toBe('done');
    const original = await fs.readFile(path.join(cfg.mediaDir, 'original', `${id}.mp3`));
    const out = await fs.readFile(path.join(cfg.mediaDir, 'mp3', `${id}.mp3`));
    expect(out.equals(original)).toBe(true);
    expect(convertedFormats()).toEqual(['wav']);
  });

  it('PCM wav 원본은 설정과 다른 규격이어도 wav로 복사하고, mp3는 변환한다', async () => {
    // 설정은 44.1kHz 모노 16비트다. 48kHz 스테레오 24비트를 그대로 둬야 한다.
    const item = await makeSource('b.wav', ['-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2']);
    const { id, status } = await runOne(item);

    expect(status).toBe('done');
    const original = await fs.readFile(path.join(cfg.mediaDir, 'original', `${id}.wav`));
    const out = await fs.readFile(path.join(cfg.mediaDir, 'wav', `${id}.wav`));
    expect(out.equals(original)).toBe(true);
    expect(convertedFormats()).toEqual(['mp3']);
  });

  it('QTA 원본은 지금처럼 두 포맷 모두 변환한다', async () => {
    const { status } = await runOne(scan[0]);

    expect(status).toBe('done');
    expect(convertedFormats()).toEqual(['mp3', 'wav']);
  });
});
```

- [ ] **Step 10: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/server/jobs/runner.test.ts`
Expected: FAIL — mp3·wav 두 테스트에서 `convertedFormats()`가 `['mp3', 'wav']`이고 바이트 비교가 `false`. QTA 테스트는 통과한다.

- [ ] **Step 11: 러너에 복사 분기를 넣는다**

`src/lib/server/jobs/runner.ts`의 import에 더한다:

```ts
import { isSameFormat } from '../media/sameFormat';
```

`makeRunner` 위(파일 안 적당한 곳, 모듈 최상위)에 함수 하나를 더한다:

```ts
/**
 * 원본이 이미 출력 포맷일 때 변환 대신 쓴다.
 *
 * convert가 실패 시 잘린 출력을 지우는 것과 같은 이유로, 복사가 도중에
 * 실패해도 반쪽 파일을 남기지 않는다 — 남기면 다음 재시도의 done 판정이
 * 그 파일을 멀쩡하다고 믿는다.
 */
async function copyAsFormat(original: string, out: string, format: string): Promise<void> {
  await fs.mkdir(path.dirname(out), { recursive: true });
  try {
    await fs.copyFile(original, out);
  } catch (err) {
    await fs.rm(out, { force: true });
    throw new Error(`복사 실패 (${format}): ${(err as Error).message}`);
  }
}
```

포맷별 루프의 이 부분을:

```ts
      try {
        await convert(originalPath, out, meta.audioStreamIndex, spec);
        files[spec.name] = { bytes: (await fs.stat(out)).size };
```

이렇게 바꾼다:

```ts
      try {
        if (isSameFormat(spec.name, meta)) {
          // 원본이 이미 이 포맷이다. 다시 인코딩하면 손실 압축을 한 번 더
          // 거쳐 음질만 잃고 시간을 쓴다. 출력 설정(비트레이트·샘플레이트·
          // 채널)보다 우선한다 — 사용자 결정이다(설계 문서 3절).
          await copyAsFormat(originalPath, out, spec.name);
        } else {
          await convert(originalPath, out, meta.audioStreamIndex, spec);
        }
        files[spec.name] = { bytes: (await fs.stat(out)).size };
```

`catch` 블록과 그 아래는 그대로 둔다 — 복사 실패도 변환 실패와 똑같이 그 포맷만 `failed`로 남긴다.

- [ ] **Step 12: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/server/jobs/runner.test.ts`
Expected: PASS — 기존 15개 + 새 3개

- [ ] **Step 13: 전체 단위 테스트와 타입 검사**

Run: `npm run test:unit -- --run && npm run check`
Expected: 둘 다 통과

- [ ] **Step 14: 커밋**

```bash
git add src/lib/server/media/probe.ts src/lib/server/media/probe.test.ts \
        src/lib/server/media/sameFormat.ts src/lib/server/media/sameFormat.test.ts \
        src/lib/server/jobs/runner.ts src/lib/server/jobs/runner.test.ts
git commit -m "feat: 원본이 이미 출력 포맷이면 변환하지 않고 복사한다

mp3 원본을 mp3로 다시 인코딩하면 손실 압축을 한 번 더 거쳐 음질만
잃는다. wav도 마찬가지로 시간만 쓴다.

판정은 확장자가 아니라 ffprobe가 본 컨테이너와 코덱 둘 다로 한다.
AIFF는 코덱이 pcm이어도 컨테이너가 aiff라 wav로 복사하지 않고, 이름만
.mp3인 AAC도 복사하지 않는다 — 둘 다 실제 파일로 확인했다.

복사는 출력 설정보다 우선한다(사용자 결정).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: mp3 인코더 레벨 설정

**Files:**
- Modify: `src/lib/types.ts:60-67` (FormatSpec)
- Modify: `src/lib/server/config.ts:5-8` (FORMAT_DEFAULTS), `:12-17` 부근 (파서 추가), `:35-42` (loadConfig의 포맷 매핑)
- Modify: `src/lib/server/config.test.ts` (테스트 추가)
- Modify: `src/lib/server/media/convert.ts` (인자 구성)
- Create: `src/lib/server/media/convert.args.test.ts`
- Modify: `src/lib/server/media/binaries.wiring.test.ts:60` (FormatSpec 리터럴)
- Modify: `.env.example`

**Interfaces:**
- Consumes: 없음 (Task 1과 독립)
- Produces: `FormatSpec.compressionLevel: number | null`

- [ ] **Step 1: 설정 테스트를 쓴다**

`src/lib/server/config.test.ts`의 `describe('loadConfig', …)` 끝에 더한다:

```ts
  it('mp3 인코더 레벨은 지정하지 않으면 null이다 — 지금과 같은 인코딩', () => {
    const cfg = loadConfig({});
    for (const f of cfg.formats) expect(f.compressionLevel).toBeNull();
  });

  it('MP3_COMPRESSION_LEVEL을 읽는다', () => {
    const mp3 = loadConfig({ MP3_COMPRESSION_LEVEL: '7' }).formats.find((f) => f.name === 'mp3')!;
    expect(mp3.compressionLevel).toBe(7);
  });

  it('빈 MP3_COMPRESSION_LEVEL은 지정하지 않은 것으로 본다', () => {
    const mp3 = loadConfig({ MP3_COMPRESSION_LEVEL: '  ' }).formats.find((f) => f.name === 'mp3')!;
    expect(mp3.compressionLevel).toBeNull();
  });

  // 조용히 무시하면 사용자는 설정이 먹은 줄 믿고 느린 변환을 계속 본다.
  it.each(['10', '-1', 'abc', '3.5'])('MP3_COMPRESSION_LEVEL=%s는 기동 시 거부한다', (v) => {
    expect(() => loadConfig({ MP3_COMPRESSION_LEVEL: v })).toThrow(/0~9/);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/server/config.test.ts`
Expected: FAIL — `compressionLevel`이 `undefined`, 그리고 거부 테스트 4개가 던지지 않음

- [ ] **Step 3: FormatSpec에 필드를 더한다**

`src/lib/types.ts`의 `FormatSpec`에서 `channels: number | null;` 다음에:

```ts
  /**
   * LAME의 인코딩 알고리즘 정밀도(0~9, 클수록 빠르고 덜 정밀).
   * null이면 ffmpeg에 넘기지 않아 인코더 기본값을 쓴다.
   */
  compressionLevel: number | null;
```

- [ ] **Step 4: 설정에서 읽고 검증한다**

`src/lib/server/config.ts`의 `FORMAT_DEFAULTS`를:

```ts
const FORMAT_DEFAULTS: Record<string, Omit<FormatSpec, 'name'>> = {
  mp3: { ext: 'mp3', codec: 'libmp3lame', bitrate: '192k', sampleRate: 44100, channels: 2, compressionLevel: null },
  wav: { ext: 'wav', codec: 'pcm_s16le', bitrate: null, sampleRate: 44100, channels: 1, compressionLevel: null }
};
```

`num()` 함수 바로 아래에 더한다:

```ts
/**
 * 인코더 레벨(0~9의 정수). 비어 있으면 null.
 *
 * 범위를 벗어난 값을 조용히 무시하거나 잘라 쓰면, 사용자는 설정이 먹은
 * 줄 믿은 채 느린 변환을 계속 보게 된다. 다른 설정 오류처럼 기동 시
 * 거부한다.
 */
function level(env: Env, key: string): number | null {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 9) {
    throw new Error(`${key}는 0~9의 정수여야 합니다: ${raw}`);
  }
  return n;
}
```

`loadConfig`의 포맷 매핑에서 `channels: …` 줄 다음에:

```ts
      channels: base.channels === null ? null : num(env, `${up}_CHANNELS`, base.channels),
      compressionLevel: level(env, `${up}_COMPRESSION_LEVEL`) ?? base.compressionLevel
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/server/config.test.ts`
Expected: PASS

- [ ] **Step 6: convert 인자 테스트를 쓴다**

`src/lib/server/media/convert.args.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import type { FormatSpec } from '$lib/types';

/**
 * convert가 ffmpeg에 넘기는 인자만 본다. 실제 인코딩 결과는 convert.test.ts가
 * 진짜 ffmpeg로 확인한다 — 여기서는 "레벨이 null이면 플래그가 아예 없다"를
 * 고정하는 것이 목적이다. 그게 서버 배포의 인코딩이 바뀌지 않았다는 보증이다.
 */
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import { convert } from './convert';

const MP3: FormatSpec = {
  name: 'mp3',
  ext: 'mp3',
  codec: 'libmp3lame',
  bitrate: '192k',
  sampleRate: 44100,
  channels: 2,
  compressionLevel: null
};
const OUT = path.join(os.tmpdir(), 'uls-convert-args', 'out.mp3');

beforeEach(() => {
  execFileMock.mockReset();
  execFileMock.mockImplementation((_cmd: string, _args: string[], cb: unknown) => {
    (cb as (e: null, r: { stdout: string; stderr: string }) => void)(null, { stdout: '', stderr: '' });
  });
});

function argsOfFirstCall(): string[] {
  return execFileMock.mock.calls[0][1] as string[];
}

describe('convert의 인코더 레벨 인자', () => {
  it('레벨이 null이면 -compression_level을 넘기지 않는다', async () => {
    await convert('/tmp/in.qta', OUT, 0, MP3);
    expect(argsOfFirstCall()).not.toContain('-compression_level');
  });

  it('레벨이 있으면 출력 경로 앞에 -compression_level N을 넣는다', async () => {
    await convert('/tmp/in.qta', OUT, 0, { ...MP3, compressionLevel: 7 });
    const args = argsOfFirstCall();
    const i = args.indexOf('-compression_level');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('7');
    // ffmpeg는 출력 파일 뒤의 옵션을 그 출력에 적용하지 않는다.
    expect(i).toBeLessThan(args.indexOf(OUT));
  });

  it('레벨 0도 넘긴다 — 0을 "없음"으로 취급하지 않는다', async () => {
    await convert('/tmp/in.qta', OUT, 0, { ...MP3, compressionLevel: 0 });
    const args = argsOfFirstCall();
    expect(args[args.indexOf('-compression_level') + 1]).toBe('0');
  });
});
```

- [ ] **Step 7: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/server/media/convert.args.test.ts`
Expected: FAIL — 두 번째·세 번째 테스트에서 `-compression_level`을 찾지 못함

- [ ] **Step 8: convert에 인자를 더한다**

`src/lib/server/media/convert.ts`에서 `channels` 블록이 끝난 뒤, `args.push(output);` **바로 앞**에:

```ts
  // null과 0을 구분한다 — 0은 "가장 정밀하게"라는 유효한 값이다.
  // null이면 넘기지 않아 인코더 기본값을 쓴다. 그래야 설정하지 않은 서버
  // 배포의 인코딩이 이 변경 전과 똑같다.
  if (spec.compressionLevel !== null) {
    args.push('-compression_level', String(spec.compressionLevel));
  }
```

- [ ] **Step 9: FormatSpec 리터럴을 고친다**

`src/lib/server/media/binaries.wiring.test.ts:60`의 리터럴에 필드를 더한다:

```ts
      { name: 'mp3', ext: 'mp3', codec: 'libmp3lame', bitrate: '192k', sampleRate: 44100, channels: 2, compressionLevel: null }
```

- [ ] **Step 10: .env.example에 문서화한다**

`.env.example`의 `MP3_CHANNELS=2` 다음 줄에:

```
# LAME 인코딩 알고리즘 정밀도(0~9, 클수록 빠르고 덜 정밀). 비워 두면
# 인코더 기본값을 쓴다. 7이면 mp3 인코딩이 약 2.2배 빠르다(3분 40초
# 녹음 기준 1.78초 → 0.81초). 192kbps에서는 귀로 구분하기 어렵다.
# MP3_COMPRESSION_LEVEL=7
```

- [ ] **Step 11: 통과와 회귀를 확인한다**

Run: `npm run test:unit -- --run && npm run check`
Expected: 둘 다 통과. `convert.test.ts`의 실제 ffmpeg 테스트가 그대로 통과해야 한다(기본값이 null이라 인자가 바뀌지 않았다).

- [ ] **Step 12: 커밋**

```bash
git add src/lib/types.ts src/lib/server/config.ts src/lib/server/config.test.ts \
        src/lib/server/media/convert.ts src/lib/server/media/convert.args.test.ts \
        src/lib/server/media/binaries.wiring.test.ts .env.example
git commit -m "feat: mp3 인코더 레벨을 MP3_COMPRESSION_LEVEL로 고른다

mp3 인코딩이 파일당 변환 시간의 80%다. 레벨 7이면 약 2.2배 빨라진다.

기본값은 null이라 ffmpeg에 플래그를 넘기지 않는다 — 설정하지 않으면
지금과 똑같이 인코딩된다(사용자 결정). 범위를 벗어난 값은 기동 시
거부한다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 데스크톱 동시 변환 수

**Files:**
- Modify: `src/lib/desktop/env.ts` (ServerEnvOptions, buildServerEnv, 머리 주석)
- Modify: `src/lib/desktop/env.test.ts` (BASE, 테스트 추가)
- Modify: `electron/main.ts:1-7` (import), `:93-99` (buildServerEnv 호출)

**Interfaces:**
- Consumes: 없음
- Produces: `ServerEnvOptions.cpuCount: number` — `buildServerEnv`의 필수 인자가 하나 는다

- [ ] **Step 1: 테스트를 쓴다**

`src/lib/desktop/env.test.ts`의 `BASE`에 필드를 더한다:

```ts
const BASE = {
  port: 45678,
  userDataDir: '/Users/me/Library/Application Support/uls-player',
  binariesDir: null,
  base: {} as NodeJS.ProcessEnv,
  platform: 'darwin' as NodeJS.Platform,
  cpuCount: 12
};
```

`describe` 끝에 더한다:

```ts
  it('동시 변환 수를 코어 수보다 하나 적게 잡는다 — 하나는 재생과 화면에 남긴다', () => {
    expect(buildServerEnv(BASE).CONVERT_CONCURRENCY).toBe('11');
  });

  it('코어가 하나뿐이어도 동시 변환 수는 1이다', () => {
    expect(buildServerEnv({ ...BASE, cpuCount: 1 }).CONVERT_CONCURRENCY).toBe('1');
  });

  it('코어가 둘이면 동시 변환 수는 1이다', () => {
    expect(buildServerEnv({ ...BASE, cpuCount: 2 }).CONVERT_CONCURRENCY).toBe('1');
  });

  it('이미 지정된 CONVERT_CONCURRENCY는 덮어쓰지 않는다', () => {
    const env = buildServerEnv({ ...BASE, base: { CONVERT_CONCURRENCY: '3' } });
    expect(env.CONVERT_CONCURRENCY).toBe('3');
  });

  it('빈 CONVERT_CONCURRENCY는 지정하지 않은 것으로 본다', () => {
    const env = buildServerEnv({ ...BASE, base: { CONVERT_CONCURRENCY: '' } });
    expect(env.CONVERT_CONCURRENCY).toBe('11');
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/desktop/env.test.ts`
Expected: FAIL — 새 테스트 5개 중 "덮어쓰지 않는다"를 뺀 4개가 `undefined`를 받음

- [ ] **Step 3: env.ts를 고친다**

`ServerEnvOptions`의 `platform` 다음에:

```ts
  /**
   * 이 기계의 논리 코어 수. 인자로 받는 이유는 platform과 같다 —
   * os.availableParallelism()을 직접 부르면 1코어나 64코어 경우를
   * 테스트할 수 없다.
   */
  cpuCount: number;
```

`buildServerEnv`의 머리 주석에서 "바깥이 이긴다" 목록을 고친다:

```ts
 * - DATA_DIR/MEDIA_DIR/FFMPEG_PATH/FFPROBE_PATH/CONVERT_CONCURRENCY는
 *   **바깥이 이긴다.** 셸이 넣는 것은 기본값일 뿐이고, 사용자가 라이브러리를
 *   다른 드라이브로 옮기거나 변환 부하를 조절하고 싶을 때 환경변수만으로
 *   되게 둔다.
```

`binariesDir` 블록 다음, `return env;` 앞에:

```ts
  // 서버 배포의 기본값(4)은 코어 수와 무관하게 고정이라, 12코어 PC에서
  // 코어의 1/3만 쓰고 있었다. libmp3lame은 프로세스당 코어 하나를 쓰므로
  // ffmpeg N개가 코어 N개를 쓴다 — 하나를 남겨야 변환 중에도 재생과
  // 화면이 끊기지 않는다. 서버 배포는 몇 코어인지, 무엇이 함께 도는지
  // 모르므로 건드리지 않는다. 이건 데스크톱 셸이 넘기는 기본값이다.
  if (unset(o.base.CONVERT_CONCURRENCY)) {
    env.CONVERT_CONCURRENCY = String(Math.max(1, o.cpuCount - 1));
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/desktop/env.test.ts`
Expected: PASS — 기존 14개 + 새 5개

- [ ] **Step 5: main.ts가 코어 수를 넘기게 한다**

`electron/main.ts`의 import에 더한다:

```ts
import os from 'node:os';
```

`startServer()`의 `buildServerEnv({ … })` 호출에서 `platform: process.platform` 다음에:

```ts
    platform: process.platform,
    cpuCount: os.availableParallelism()
```

- [ ] **Step 6: 셸 컴파일과 e2e를 확인한다**

Run: `npm run test:unit -- --run && npm run test:e2e:electron`
Expected: 단위 전부 통과, Electron e2e 4개 통과. `tsc -p tsconfig.electron.json`이 `desktop:build` 안에서 돌므로 `cpuCount` 누락이 있으면 여기서 잡힌다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/desktop/env.ts src/lib/desktop/env.test.ts electron/main.ts
git commit -m "feat: 데스크톱은 동시 변환 수를 코어 수에 맞춘다

서버 기본값 4는 코어 수와 무관해 12코어 PC에서 코어의 1/3만 썼다.
24개 배치 기준 동시 4 → 15.1초, 동시 12 → 9.9초.

코어 하나는 재생과 화면에 남긴다. 서버 배포의 기본값은 그대로다 —
이건 셸이 넘기는 기본값이고 사용자가 지정한 값이 이긴다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 창 먼저 띄우기

**Files:**
- Modify: `electron/main.ts` (import, 로딩 페이지, createWindow 분리, main 순서, 종료 중 표시)
- Create: `tests/electron/loading.spec.ts`

**Interfaces:**
- Consumes: Task 3의 `electron/main.ts`
- Produces: 없음 (셸 내부 변경)

**배경:** 지금 `main()`은 `startServer()` → `waitForServer()` → `createWindow(port)` 순서다. 서버 기동과 Chromium 창 생성 비용이 차례로 쌓이고, 그동안 화면에 아무것도 없다. 창을 먼저 만들어 로딩 화면을 띄우고, 동시에 서버를 띄운 뒤, 서버가 응답하면 창을 앱 주소로 옮긴다.

**새로 생기는 경우 하나:** 예전에는 서버가 뜨기 전에 창이 없었으니 사용자가 그 사이에 창을 닫을 수 없었다. 이제는 로딩 중에 닫을 수 있다. 그러면 `window-all-closed` → `app.quit()` → `before-quit` → `stopServer()`가 서버를 죽이는데, 아직 돌고 있던 `waitForServer()`가 나중에 실패로 끝나 **종료 중인 앱에 오류 대화상자를 띄우면 안 된다.** 종료 중 표시를 하나 둔다.

- [ ] **Step 1: e2e를 쓴다**

`tests/electron/loading.spec.ts`:

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:e2e:electron`
Expected: 새 테스트 FAIL — `urls[0]`이 `http://127.0.0.1:…/`라 `data:` 정규식에 맞지 않음. 기존 4개는 통과.

- [ ] **Step 3: main.ts를 고친다 — import와 상수**

`electron/main.ts`의 electron import에 `nativeTheme`을 더한다:

```ts
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
```

`let mainWindow: BrowserWindow | null = null;` 다음에 더한다:

```ts
/**
 * 앱 주소. 서버가 응답하기 전까지는 null이다 — 그동안 창에는 로딩 화면만
 * 떠 있고, 이 값이 없으면 탐색 가드가 모든 이동을 바깥으로 본다.
 */
let appOrigin: string | null = null;

/**
 * 앱이 끝나는 중인가. 로딩 중에 사용자가 창을 닫으면 before-quit가 서버를
 * 죽이는데, 그때 돌고 있던 waitForServer가 나중에 실패로 끝나 종료 중인
 * 앱에 오류 대화상자를 띄우면 안 된다. 창을 서버보다 먼저 띄우면서 새로
 * 생긴 경우다 — 예전에는 서버가 뜨기 전에 닫을 창이 없었다.
 */
let quitting = false;

/**
 * 로딩 화면의 배경색. 앱 테마(Skeleton cerberus)의 body 배경과 같게 맞춘다 —
 * surface-950(oklch 0.18)과 surface-50(oklch 0.99)을 sRGB로 바꾼 값이다.
 * 다르면 로딩 화면에서 앱으로 넘어가는 순간 색이 번쩍인다.
 */
const THEME_BG = { dark: '#121212', light: '#fcfcfc' } as const;
```

- [ ] **Step 4: 로딩 페이지 함수를 더한다**

`isInternal` 함수 다음에:

```ts
/**
 * 서버가 뜨기 전에 보여줄 화면. 파일을 따로 두지 않고 data: URL로 띄운다.
 *
 * heading 요소를 쓰지 않는다 — e2e가 getByRole('heading', { name: 'ULS Player' })로
 * 앱 화면이 떴는지 판단하는데, 여기 같은 이름의 heading이 있으면 그 단언이
 * 로딩 화면에서 통과해 버린다.
 */
function loadingPage(dark: boolean): string {
  const bg = dark ? THEME_BG.dark : THEME_BG.light;
  const fg = dark ? '#e5e5e5' : '#262626';
  const html =
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>ULS Player</title>' +
    `<style>html,body{margin:0;height:100%;background:${bg};color:${fg};` +
    'font-family:system-ui,sans-serif}body{display:grid;place-items:center}' +
    '.name{font-size:20px;font-weight:600;margin-bottom:8px;text-align:center}' +
    '.hint{font-size:14px;opacity:.6;text-align:center}</style></head>' +
    '<body><div><div class="name">ULS Player</div><div class="hint">여는 중…</div></div></body></html>';
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
```

- [ ] **Step 5: fail()이 종료 중에는 아무것도 하지 않게 한다**

`fail` 함수 맨 앞에:

```ts
function fail(title: string, detail: string): void {
  // 사용자가 로딩 중에 창을 닫아 이미 끝나는 중이면, 그 때문에 죽은
  // 서버를 "실패"로 알릴 이유가 없다.
  if (quitting) return;
  dialog.showErrorBox(title, detail);
  stopServer();
  app.exit(1);
}
```

- [ ] **Step 6: createWindow를 둘로 나눈다**

지금의 `createWindow(port: number)` 함수 전체를 아래 두 함수로 바꾼다:

```ts
/**
 * 창을 만들고 로딩 화면을 띄운다. 서버를 기다리지 않는다.
 *
 * 예전에는 서버가 응답한 뒤에야 창을 만들어, 서버 기동과 Chromium 창
 * 생성 비용이 차례로 쌓였고 그동안 화면에 아무것도 없었다(설계 문서 6절).
 */
function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // 창이 그려지기 전 한 프레임이라도 흰색이 보이지 않게 테마 배경을 준다.
    backgroundColor: dark ? THEME_BG.dark : THEME_BG.light,
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
  // appOrigin이 아직 없으면(로딩 중) 모든 이동을 바깥으로 본다 — 로딩
  // 화면에는 링크가 없으니 실제로 일어날 일은 없다.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (appOrigin !== null && isInternal(url, appOrigin)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (appOrigin === null || !isInternal(url, appOrigin)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(loadingPage(dark));
}

/**
 * 서버가 응답하면 창을 앱으로 옮긴다. loadURL은 프로그램이 부르는 이동이라
 * will-navigate 가드를 거치지 않는다.
 */
function showApp(port: number): void {
  appOrigin = `http://127.0.0.1:${port}`;
  // 로딩 중에 사용자가 창을 닫았으면 옮길 창이 없다.
  if (mainWindow === null) return;
  void mainWindow.loadURL(appOrigin);
}
```

- [ ] **Step 7: main()의 순서를 바꾼다**

`main()`에서 `ipcMain.handle(…)` 블록 다음 부분을:

```ts
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
```

이렇게 바꾼다:

```ts
  // 창을 먼저 만들고 서버를 띄운다. createWindow는 동기로 돌아오고 창
  // 생성은 그 뒤에서 이어지므로, 두 비용이 겹친다.
  createWindow();
  let port: number;
  try {
    port = await startServer();
    await waitForServer(port);
  } catch (err) {
    fail('서버를 시작하지 못했습니다', (err as Error).message);
    return;
  }
  showApp(port);
}
```

- [ ] **Step 8: before-quit에서 종료 중 표시를 켠다**

파일 끝의 `app.on('before-quit', stopServer);`를:

```ts
  app.on('before-quit', () => {
    quitting = true;
    stopServer();
  });
```

- [ ] **Step 9: e2e를 돌린다**

Run: `npm run test:e2e:electron`
Expected: 5개 모두 통과 — 기존 `launch.spec.ts` 2개, `folder-picker.spec.ts` 2개, 새 `loading.spec.ts` 1개

기존 `folder-picker.spec.ts`는 `page.url()`로 앱 주소를 만들어 `/import`로 간다. 로딩 화면이 먼저 뜨더라도 그 테스트는 heading이 보인 **뒤에** `page.url()`을 읽으므로 앱 주소를 얻는다 — 통과해야 정상이다. 실패하면 추측으로 고치지 말고 증상을 보고할 것.

- [ ] **Step 10: 단위 테스트와 타입 검사**

Run: `npm run test:unit -- --run && npm run check`
Expected: 둘 다 통과

- [ ] **Step 11: 커밋**

```bash
git add electron/main.ts tests/electron/loading.spec.ts
git commit -m "feat: 서버를 기다리지 않고 창과 로딩 화면을 먼저 띄운다

셸이 서버 응답을 기다린 뒤에야 창을 만들어, 서버 기동과 Chromium 창
생성 비용이 차례로 쌓였고 그동안 화면에 아무것도 없었다. 이제 둘을
함께 시작하고, 서버가 응답하면 창을 앱으로 옮긴다.

로딩 화면 배경은 앱 테마의 body 배경과 같게 맞춰 넘어갈 때 번쩍이지
않는다. 로딩 중에 창을 닫으면 그 때문에 죽은 서버를 실패로 알리지
않는다 — 창을 먼저 띄우면서 새로 생긴 경우다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 언어 파일 정리, 측정, 문서

**Files:**
- Modify: `electron-builder.yml`
- Create: `scripts/bench-convert.sh`
- Modify: `docs/desktop-packaging.md` (절 하나 추가)

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: `release/` 산출물, 측정 수치

- [ ] **Step 1: 언어 파일을 줄인다**

`electron-builder.yml`에서 `productName: ULS Player` 다음 줄에:

```yaml
# 이 앱은 한국어 화면 하나뿐인데 Electron은 언어 파일 48MB를 통째로 싣는다.
# portable exe는 켤 때마다 이걸 풀고, Windows Defender는 새 파일로 보고 매번
# 검사한다. en-US는 Chromium이 한국어 리소스를 못 찾을 때의 대비로 남긴다.
electronLanguages: [ko, en-US]
```

- [ ] **Step 2: 측정 도구를 만든다**

`scripts/bench-convert.sh`:

```bash
#!/usr/bin/env bash
# 변환 처리량 측정. 앱의 파일당 파이프라인(mp3 인코딩 → wav 인코딩 → 파형
# 디코드)을 ffmpeg로 그대로 흉내 내, 동시 수와 인코더 레벨에 따른 시간을
# 잰다. 앱 자체가 아니라 흉내이므로 수치는 "이 설정에서 ffmpeg가 이만큼
# 걸린다"로 읽는다 — 설정을 바꿀 때 전후를 비교하는 용도다.
#
# 쓰는 법: scripts/bench-convert.sh <폴더> <동시 수> [mp3 레벨]
#   예) scripts/bench-convert.sh media/original 4
#       scripts/bench-convert.sh media/original 11 7
#
# macOS·Linux용이다. 폴더의 오디오 파일 앞 24개를 쓴다.
set -euo pipefail

DIR="${1:?폴더를 지정하세요}"
JOBS="${2:?동시 수를 지정하세요}"
LEVEL="${3:-}"
COUNT=24

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

find "$DIR" -maxdepth 1 -type f \( -name '*.qta' -o -name '*.m4a' -o -name '*.mp3' -o -name '*.wav' \) \
  | sort | head -n "$COUNT" > "$OUT/list"
N=$(wc -l < "$OUT/list" | tr -d ' ')
[ "$N" -gt 0 ] || { echo "오디오 파일이 없습니다: $DIR" >&2; exit 1; }

export OUT LEVEL
one() {
  f="$1"; o="$OUT/$(basename "$f")"
  # 앱의 기본 설정과 같은 값이다(src/lib/server/config.ts의 FORMAT_DEFAULTS).
  # 레벨 인자를 배열로 만들지 않는 이유: macOS 기본 bash(3.2)는 set -u
  # 상태에서 빈 배열을 펼치면 "unbound variable"로 죽는다.
  if [ -n "$LEVEL" ]; then
    ffmpeg -y -v error -i "$f" -map 0:a:0 -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 \
      -compression_level "$LEVEL" "$o.mp3"
  else
    ffmpeg -y -v error -i "$f" -map 0:a:0 -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 "$o.mp3"
  fi
  ffmpeg -y -v error -i "$f" -map 0:a:0 -c:a pcm_s16le -ar 44100 -ac 1 "$o.wav"
  ffmpeg -v error -i "$f" -map 0:a:0 -ac 1 -ar 8000 -f s16le - > /dev/null
}
export -f one

# 시각은 python3로 잰다. macOS의 date는 %N(나노초)을 모르면서도 종료 코드
# 0으로 "N"을 그대로 찍어, `date … || 대안` 식의 폴백이 걸리지 않는다.
now() { python3 -c 'import time; print(time.time())'; }

START=$(now)
xargs -P "$JOBS" -I{} bash -c 'one "$@"' _ {} < "$OUT/list"
END=$(now)

python3 -c "print('파일 $N개, 동시 $JOBS, 레벨 ${LEVEL:-기본}: %.1f초' % ($END - $START))"
```

실행 권한을 준다: `chmod +x scripts/bench-convert.sh`

한 번 돌려 출력 형식을 확인한다: `scripts/bench-convert.sh media/original 4` → `파일 24개, 동시 4, 레벨 기본: 15.1초` 꼴이어야 한다.

- [ ] **Step 3: 전후를 잰다**

이 맥의 코어 수를 확인하고(`sysctl -n hw.ncpu`, macOS) 그 값에서 1을 뺀 수를 "데스크톱 기본값"으로 쓴다. 12코어면 11이다.

```bash
scripts/bench-convert.sh media/original 4        # 변경 전 (서버 기본값)
scripts/bench-convert.sh media/original 11       # 변경 후 데스크톱 기본값
scripts/bench-convert.sh media/original 11 7     # MP3_COMPRESSION_LEVEL=7을 켰을 때
```

`media/original`에 파일이 없으면 `~/Dev/SIDE_PROJECT/_voice_sample`을 쓴다. **세 수치와 코어 수, 파일 수를 그대로 기록해 둔다** — Step 5에서 문서에 넣는다.

복사 경로도 잰다. mp3 원본 하나를 만들어, 다시 인코딩할 때와 복사할 때를 비교한다:

```bash
T=$(mktemp -d)
ffmpeg -v error -i "$(ls media/original/*.qta | head -1)" -map 0:a:0 -c:a libmp3lame -b:a 128k "$T/src.mp3"
time ffmpeg -y -v error -i "$T/src.mp3" -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 "$T/re.mp3"
time cp "$T/src.mp3" "$T/copy.mp3"
rm -rf "$T"
```

- [ ] **Step 4: 패키징하고 언어 파일을 확인한다**

Run: `npm run dist:win`
Expected: 성공. 오래 걸린다(수 분).

```bash
ls release/win-unpacked/locales/
du -sh release/win-unpacked/locales release/win-unpacked
ls -lh release/*.exe release/*.zip
```

Expected: `locales/`에 `ko.pak`과 `en-US.pak`만 있다. 전체 크기가 이전(580MB)보다 약 46MB 준다. 새 산출물 크기를 기록해 둔다.

`locales/`에 다른 파일이 남아 있으면 `electronLanguages` 값을 electron-builder 26의 스키마(`node_modules/app-builder-lib/scheme.json`에서 `electronLanguages`)와 대조해 고친다. 추측으로 고치지 말 것.

- [ ] **Step 5: 문서에 설정과 수치를 남긴다**

`docs/desktop-packaging.md`의 `## 데이터가 쌓이는 곳` 절 **앞**에 새 절을 더한다. 대괄호 자리에는 Step 3·4에서 **실제로 잰 값**을 넣는다 — 계획서의 예시 수치를 옮겨 적지 말 것:

```markdown
## 변환 속도

### 무엇이 시간을 쓰는가

파일 하나를 가져오면 ffmpeg가 네 번 돈다 — ffprobe, mp3 인코딩, wav 인코딩,
파형용 디코드. 이 중 **mp3 인코딩이 파일당 시간의 약 80%**다.

### 설정

| 환경변수 | 기본값 | 효과 |
|---|---|---|
| `CONVERT_CONCURRENCY` | 서버 4 / 데스크톱 코어 수 − 1 | 동시에 도는 변환 수 |
| `MP3_COMPRESSION_LEVEL` | 비어 있음(인코더 기본값) | 0~9. 클수록 빠르고 덜 정밀. 7이면 mp3 인코딩 약 2.2배 |

원본이 이미 mp3(또는 PCM wav)이면 그 포맷은 인코딩하지 않고 원본을 복사한다.
출력 설정(비트레이트·샘플레이트·채널)보다 우선한다.

### 측정

[코어 수]코어 [기종], 원본 [파일 수]개(`scripts/bench-convert.sh`):

| 설정 | 시간 |
|---|---|
| 동시 4, 기본 (변경 전) | [측정값]초 |
| 동시 [코어−1], 기본 (데스크톱 기본값) | [측정값]초 |
| 동시 [코어−1], 레벨 7 | [측정값]초 |

mp3 원본 하나: 다시 인코딩 [측정값]초 → 복사 [측정값]초.

이 수치는 앱이 아니라 앱의 파이프라인을 흉내 낸 ffmpeg 실행으로 잰 것이다.
Windows에서는 ffmpeg를 실행할 때마다 DLL을 불러오는 비용이 더해져 더 느릴
수 있다.
```

그리고 `## 만들기` 절의 산출물 크기가 적혀 있으면 Step 4에서 잰 새 크기로 고친다.

- [ ] **Step 6: 전체 검증**

Run: `npm test && npm run check`
Expected: 단위, Electron e2e(5개), 브라우저 e2e(33개), 타입 검사 모두 통과

- [ ] **Step 7: 커밋**

```bash
git add electron-builder.yml scripts/bench-convert.sh docs/desktop-packaging.md
git commit -m "feat: 언어 파일을 한국어·영어만 남기고, 변환 속도를 재는 도구를 둔다

이 앱은 한국어 화면 하나뿐인데 Electron 언어 파일 48MB를 통째로 실었다.
portable exe는 켤 때마다 이걸 풀고 Defender가 매번 검사한다.

bench-convert.sh는 앱의 파일당 파이프라인을 ffmpeg로 흉내 내 동시 수와
인코더 레벨별 시간을 잰다. 다음 작업(ffmpeg 직접 빌드)의 전후 비교에도
쓴다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 절 | Task |
|---|---|
| 3. 같은 포맷 복사 — 판정 기준(컨테이너+코덱), 설정보다 우선, 재시도 규칙 유지 | 1 |
| 3. `ProbeResult.formatName` 추가 | 1 (Step 3) |
| 4. `FormatSpec.compressionLevel`, `MP3_COMPRESSION_LEVEL`, 기본 null, 0~9 검증 | 2 |
| 5. 데스크톱 `CONVERT_CONCURRENCY = max(1, 코어−1)`, 바깥이 이김, 서버 불변, cpuCount 인자 | 3 |
| 6. 창 먼저, 로딩 화면(data: URL), 테마 배경색, 실패 처리 유지, 보안 설정 유지 | 4 |
| 7. `electronLanguages: [ko, en-US]` | 5 |
| 8. 테스트 표의 모든 행 | 1(판정 6행, 러너 2행), 2(설정 2행, 변환 2행), 3(셸 env 2행), 4(e2e), 5(패키징) |
| 8. 변경 전후 측정을 문서에 남긴다 | 5 (Step 3, 5) |

스펙 6절에 없던 것 하나가 계획에 들어갔다 — **로딩 중에 창을 닫는 경우**(Task 4의 `quitting`). 창을 서버보다 먼저 띄우면서 새로 생긴 경우라 이 설계의 직접적인 귀결이다.

**2. 플레이스홀더 점검**

Task 5 Step 5의 대괄호는 의도적이다 — 측정값은 실행해야만 나온다. 단계 자체에 "실제로 잰 값을 넣고 예시를 옮기지 말 것"을 명시했다. 그 밖에 "적절히 처리한다" 류는 없다.

**3. 타입 일관성**

- `ProbeResult.formatName: string` — Task 1 Step 3 정의, `isSameFormat`의 `Source` 타입이 `Pick<ProbeResult, 'formatName' | 'codecName'>`로 받는다 ✓
- `isSameFormat(outputFormat: string, source)` — 러너가 `isSameFormat(spec.name, meta)`로 부른다. `meta`는 `ProbeResult`라 `Pick`을 만족한다 ✓
- `FormatSpec.compressionLevel: number | null` — Task 2 Step 3 정의, `FORMAT_DEFAULTS`·`loadConfig`·`convert`·`binaries.wiring.test.ts` 리터럴·`convert.args.test.ts` 리터럴이 모두 채운다 ✓
- `ServerEnvOptions.cpuCount: number` — Task 3 정의, `env.test.ts`의 `BASE`와 `main.ts`의 호출이 채운다 ✓
- Task 4의 `createWindow()`는 인자가 없고 `showApp(port: number)`가 새로 생긴다. `main()`만 둘을 부른다 ✓
