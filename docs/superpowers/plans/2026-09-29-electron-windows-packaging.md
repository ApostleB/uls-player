# Electron Windows 패키징 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SvelteKit 서버를 Electron 셸로 감싸, Windows에서 실행 파일 하나로 돌아가는 데스크톱 앱을 만든다.

**Architecture:** Electron main이 빈 포트를 고르고 `ELECTRON_RUN_AS_NODE`로 `build/index.js`를 fork한 뒤, 서버가 응답하면 창을 열어 `http://127.0.0.1:<port>`를 로드한다. 셸의 순수 로직(포트 고르기·env 조립·종료 명령)은 `src/lib/desktop/`에 두어 기존 vitest가 그대로 테스트하고, Electron API를 실제로 부르는 얇은 층만 `electron/`에 남긴다.

**Tech Stack:** Electron 44.4.5, electron-builder 26.15.3, TypeScript(tsc, 별도 tsconfig), Playwright `_electron`, vitest

**설계 문서:** `docs/superpowers/specs/2026-09-29-electron-windows-packaging-design.md`

## Global Constraints

- **서버 배포의 기본 동작을 바꾸지 않는다.** `FFMPEG`/`FFPROBE`의 기본값은 `'ffmpeg'`/`'ffprobe'`이며, 환경변수를 주지 않으면 지금과 완전히 동일하게 동작해야 한다.
- **`ORIGIN`은 항상 서버가 실제로 바인딩한 포트를 가리킨다.** 어긋나면 SvelteKit CSRF 검사가 가져오기 저장과 일괄 내려받기를 403으로 막는다.
- **`process.env`에 이미 있는 `DATA_DIR`/`MEDIA_DIR`/`FFMPEG_PATH`/`FFPROBE_PATH`를 셸이 덮어쓰지 않는다.** 셸이 넣는 것은 기본값일 뿐이다. 단 `HOST`/`PORT`/`ORIGIN`은 셸이 이긴다(포트가 동적이므로).
- **빈 문자열 환경변수는 "지정하지 않음"으로 본다.** `config.ts`의 `num()`이 이미 쓰는 규약이다.
- **단일 인스턴스 잠금은 필수다.** 두 인스턴스는 같은 `jobs.json`·`recordings.json`을 서로 덮어쓴다 — `ecosystem.config.cjs`가 클러스터 모드를 금지한 것과 같은 손상이다.
- **Windows 종료는 `taskkill /PID <pid> /T /F`다.** `/T`가 없으면 서버가 spawn한 ffmpeg가 고아로 남는다.
- **`build/`, `ffmpeg/win/`, `node_modules/better-sqlite3`는 asar 밖(`extraResources`)에 둔다.**
- **`dist-electron/package.json`에 `{"type":"commonjs"}`를 써 넣는다.** 루트 `package.json`의 `"type": "module"` 때문이다.
- 주석과 커밋 메시지는 **한국어**로 쓴다(이 저장소의 관례).
- 테스트는 `vite.config.ts`의 `expect: { requireAssertions: true }` 아래 돈다 — **단언 없는 테스트는 실패한다.**

## 이미 확인된 사실 (추측하지 말 것)

구현 전에 실측으로 확인한 것들이다. 다시 조사할 필요 없다.

| 사실 | 확인 방법 |
|---|---|
| `build/index.js`가 외부로 필요한 npm 패키지는 **`better-sqlite3` 하나뿐**이다. `archiver`는 rollup이 번들에 넣는다 | `build/`만 있는 빈 임시 디렉터리에서 실행 → `ERR_MODULE_NOT_FOUND: better-sqlite3`. `node_modules/better-sqlite3`만 복사하자 **HTTP 200** |
| `build/` 전체 크기는 2.4MB | `du -sh build/` |
| Electron 44.4.5 / electron-builder 26.15.3 조합으로 **이 맥에서 wine 없이** Windows exe 크로스 빌드가 된다 | `~/Dev/SIDE_PROJECT/VOCAL_CRM/release/VOCAL_CRM-0.1.0-portable.exe` (105MB)가 그렇게 만들어져 있다 |
| `waveform.ts`의 `generatePeaks`는 `ff.on('error', reject)`를 걸어둔다 | 자식에 `error`를 emit하면 프라미스가 거부된다 — 테스트에 쓸 수 있다 |
| `vi.mock('node:child_process')`로 `execFile`을 가짜로 바꾸면 `promisify`가 표준 콜백 규약(`(err, value)`)으로 동작한다 | `probe.duration.test.ts`가 이미 `cb(null, { stdout, stderr })`로 그렇게 쓴다 |

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/server/media/binaries.ts` | ffmpeg/ffprobe 실행 파일 경로를 env에서 한 번 읽는다 | 1 |
| `src/lib/desktop/port.ts` | OS에게 빈 TCP 포트를 받아온다 | 2 |
| `src/lib/desktop/env.ts` | 서버 자식에게 넘길 환경변수를 조립한다 | 2 |
| `src/lib/desktop/shutdown.ts` | 플랫폼별 종료 명령을 고른다 | 2 |
| `electron/main.ts` | 창·생명주기·서버 자식 관리. Electron API를 부르는 유일한 곳 | 3, 4 |
| `electron/preload.ts` | `window.ulsDesktop` 브리지 | 4 |
| `tsconfig.electron.json` | 셸을 CommonJS로 컴파일 | 3 |
| `scripts/write-cjs-marker.mjs` | `dist-electron/package.json` 생성 | 3 |
| `playwright.electron.config.ts` | Electron e2e 전용 설정(webServer 없음) | 3 |
| `tests/electron/*.spec.ts` | Electron e2e | 3, 4 |
| `electron-builder.yml` | Windows 패키징 | 5 |

`src/lib/desktop/`의 세 파일은 **Node 내장 모듈만 import한다.** SvelteKit의 `$lib`·`$app` 별칭을 쓰면 tsc 컴파일이 깨진다.

---

### Task 1: ffmpeg 실행 파일 경로

**Files:**
- Create: `src/lib/server/media/binaries.ts`
- Create: `src/lib/server/media/binaries.test.ts`
- Create: `src/lib/server/media/binaries.wiring.test.ts`
- Modify: `src/lib/server/media/probe.ts:39`
- Modify: `src/lib/server/media/convert.ts:48`
- Modify: `src/lib/server/media/waveform.ts:29`

**Interfaces:**
- Consumes: 없음
- Produces: `import { FFMPEG, FFPROBE } from '$lib/server/media/binaries'` — 둘 다 `string`

**배경:** 지금 세 파일이 `'ffmpeg'`/`'ffprobe'`를 문자열 그대로 spawn한다. PATH에 기대는 구조라 동봉한 바이너리를 쓸 방법이 없다. `AppConfig`에 넣지 않는 이유는 `probe(filePath)`·`convert(input, output, streamIndex, spec)`·`generatePeaks(input, streamIndex, peaks)` 셋 다 `cfg`를 받지 않기 때문이다 — config로 넘기려면 세 시그니처와 모든 호출부·테스트가 따라 바뀐다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/server/media/binaries.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

/**
 * binaries.ts는 모듈이 처음 평가될 때 env를 한 번 읽는다(config.ts의
 * 싱글턴과 같은 방식). 그래서 다른 env로 확인하려면 모듈 캐시를 비우고
 * 다시 import해야 한다.
 */
async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await import('./binaries');
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('ffmpeg 실행 파일 경로', () => {
  it('환경변수가 없으면 PATH에서 찾도록 이름만 쓴다', async () => {
    const { FFMPEG, FFPROBE } = await loadWith({
      FFMPEG_PATH: undefined,
      FFPROBE_PATH: undefined
    });
    expect(FFMPEG).toBe('ffmpeg');
    expect(FFPROBE).toBe('ffprobe');
  });

  it('FFMPEG_PATH가 있으면 그 경로를 쓴다', async () => {
    const { FFMPEG } = await loadWith({ FFMPEG_PATH: '/opt/bundled/ffmpeg' });
    expect(FFMPEG).toBe('/opt/bundled/ffmpeg');
  });

  it('FFPROBE_PATH가 있으면 그 경로를 쓴다', async () => {
    const { FFPROBE } = await loadWith({ FFPROBE_PATH: '/opt/bundled/ffprobe' });
    expect(FFPROBE).toBe('/opt/bundled/ffprobe');
  });

  it('빈 문자열은 지정하지 않은 것으로 본다', async () => {
    const { FFMPEG, FFPROBE } = await loadWith({ FFMPEG_PATH: '', FFPROBE_PATH: '   ' });
    expect(FFMPEG).toBe('ffmpeg');
    expect(FFPROBE).toBe('ffprobe');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/server/media/binaries.test.ts`
Expected: FAIL — `Failed to load url ./binaries`

- [ ] **Step 3: 모듈을 만든다**

`src/lib/server/media/binaries.ts`:

```ts
/**
 * ffmpeg·ffprobe 실행 파일의 경로.
 *
 * 기본값은 이름뿐이라 PATH에서 찾는다 — 서버 배포는 지금까지처럼
 * 시스템에 설치된 ffmpeg를 쓴다. Electron 패키지는 동봉한 바이너리의
 * 절대경로를 FFMPEG_PATH/FFPROBE_PATH로 넘긴다.
 *
 * AppConfig에 넣지 않은 이유: probe()·convert()·generatePeaks()가 모두
 * cfg를 받지 않는다. config로 넘기려면 세 시그니처와 모든 호출부·테스트가
 * 함께 바뀌는데, 얻는 것 없이 변경 면적만 넓어진다. 모듈 상수는
 * config.ts의 `export const config = loadConfig(process.env)`와 같은
 * 패턴이라 이 저장소에 이미 있는 방식이다.
 */
function fromEnv(key: string, fallback: string): string {
  const raw = process.env[key];
  // 빈 문자열을 "지정함"으로 받으면 spawn이 ENOENT로 죽는다.
  // config.ts의 num()이 쓰는 규약과 같게 맞춘다.
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

export const FFMPEG = fromEnv('FFMPEG_PATH', 'ffmpeg');
export const FFPROBE = fromEnv('FFPROBE_PATH', 'ffprobe');
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/server/media/binaries.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 호출부가 이 상수를 쓰는지 확인하는 테스트를 쓴다**

`src/lib/server/media/binaries.wiring.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

const execFileMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock, spawn: spawnMock }));

/** env를 바꾼 상태로 모듈을 새로 평가한다(binaries.ts가 import 시점에 읽으므로). */
async function loadWith<T>(specifier: string, env: Record<string, string>): Promise<T> {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return (await import(specifier)) as T;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** stdout/stderr를 가진 최소한의 가짜 자식. 바로 error를 내보내 끝낸다. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => child.emit('error', new Error('테스트용 즉시 실패')));
  return child;
}

beforeEach(() => {
  execFileMock.mockReset();
  spawnMock.mockReset();
});

describe('호출부가 동봉 바이너리 경로를 쓴다', () => {
  it('convert는 FFMPEG_PATH로 지정한 실행 파일을 부른다', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: unknown) => {
      (cb as (e: null, r: { stdout: string; stderr: string }) => void)(null, {
        stdout: '',
        stderr: ''
      });
    });
    const { convert } = await loadWith<typeof import('./convert')>('./convert', {
      FFMPEG_PATH: '/opt/bundled/ffmpeg'
    });
    await convert(
      path.join(os.tmpdir(), 'in.m4a'),
      path.join(os.tmpdir(), 'out.mp3'),
      0,
      { name: 'mp3', ext: 'mp3', codec: 'libmp3lame', bitrate: '192k', sampleRate: 44100, channels: 2 }
    );
    expect(execFileMock.mock.calls[0][0]).toBe('/opt/bundled/ffmpeg');
  });

  it('probe는 FFPROBE_PATH로 지정한 실행 파일을 부른다', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: unknown) => {
      (cb as (e: Error) => void)(new Error('테스트용 즉시 실패'));
    });
    const { probe } = await loadWith<typeof import('./probe')>('./probe', {
      FFPROBE_PATH: '/opt/bundled/ffprobe'
    });
    await expect(probe('/tmp/in.m4a')).rejects.toThrow('ffprobe 실패');
    expect(execFileMock.mock.calls[0][0]).toBe('/opt/bundled/ffprobe');
  });

  it('generatePeaks는 FFMPEG_PATH로 지정한 실행 파일을 부른다', async () => {
    spawnMock.mockImplementation(() => fakeChild());
    const { generatePeaks } = await loadWith<typeof import('./waveform')>('./waveform', {
      FFMPEG_PATH: '/opt/bundled/ffmpeg'
    });
    await expect(generatePeaks('/tmp/in.m4a', 0, 100)).rejects.toThrow('테스트용 즉시 실패');
    expect(spawnMock.mock.calls[0][0]).toBe('/opt/bundled/ffmpeg');
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/server/media/binaries.wiring.test.ts`
Expected: FAIL — 세 테스트 모두 `'ffmpeg'`/`'ffprobe'`를 받아 단언이 깨진다

- [ ] **Step 7: 세 호출부를 고친다**

`src/lib/server/media/probe.ts` — import를 더하고 39행의 `'ffprobe'`를 `FFPROBE`로 바꾼다:

```ts
import { FFPROBE } from './binaries';
// ...
    ({ stdout } = await run(FFPROBE, [
```

`src/lib/server/media/convert.ts` — import를 더하고 48행의 `'ffmpeg'`를 `FFMPEG`로 바꾼다:

```ts
import { FFMPEG } from './binaries';
// ...
    await run(FFMPEG, args);
```

`src/lib/server/media/waveform.ts` — import를 더하고 29행의 `'ffmpeg'`를 `FFMPEG`로 바꾼다:

```ts
import { FFMPEG } from './binaries';
// ...
    const ff = spawn(FFMPEG, [
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/server/media/`
Expected: PASS — 새 테스트 7개와 기존 media 테스트 전부

- [ ] **Step 9: 전체 단위 테스트를 돌린다**

Run: `npm run test:unit -- --run`
Expected: PASS — 기존 531개 + 새 7개

- [ ] **Step 10: 커밋**

```bash
git add src/lib/server/media/
git commit -m "feat: ffmpeg 실행 파일 경로를 환경변수로 지정할 수 있게 한다

동봉한 바이너리를 쓰려면 PATH 의존을 끊어야 한다. 기본값이 'ffmpeg'/
'ffprobe'라 환경변수를 주지 않는 서버 배포는 아무것도 달라지지 않는다.

AppConfig에 넣지 않은 이유는 binaries.ts 주석에 적었다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 셸의 순수 로직 — 포트·env·종료

**Files:**
- Create: `src/lib/desktop/port.ts`
- Create: `src/lib/desktop/port.test.ts`
- Create: `src/lib/desktop/env.ts`
- Create: `src/lib/desktop/env.test.ts`
- Create: `src/lib/desktop/shutdown.ts`
- Create: `src/lib/desktop/shutdown.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `findFreePort(): Promise<number>`
  - `buildServerEnv(o: ServerEnvOptions): NodeJS.ProcessEnv`, 여기서
    `ServerEnvOptions = { port: number; userDataDir: string; binariesDir: string | null; base: NodeJS.ProcessEnv; platform: NodeJS.Platform }`
  - `shutdownCommand(platform: NodeJS.Platform, pid: number): ShutdownCommand`, 여기서
    `ShutdownCommand = { kind: 'taskkill'; command: 'taskkill'; args: string[] } | { kind: 'signal'; signal: NodeJS.Signals }`

**중요:** 이 세 파일은 **Node 내장 모듈만 import한다.** `$lib`·`$app` 별칭을 쓰면 Task 3의 tsc 컴파일이 깨진다. `platform`을 인자로 받는 이유도 같다 — `process.platform`을 직접 읽으면 win32 분기를 macOS에서 테스트할 수 없다.

- [ ] **Step 1: 포트 테스트를 쓴다**

`src/lib/desktop/port.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { findFreePort } from './port';

/** 그 포트를 실제로 열어 보고 바로 닫는다. 열리면 정말 비어 있던 것이다. */
function bindOnce(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()));
  });
}

describe('빈 포트 고르기', () => {
  it('0이 아닌 포트 번호를 준다', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
  });

  it('돌려준 포트를 곧바로 바인딩할 수 있다 — 즉 잡고 있지 않다', async () => {
    const port = await findFreePort();
    await expect(bindOnce(port)).resolves.toBeUndefined();
  });

  it('연달아 불러도 매번 바인딩 가능한 포트를 준다', async () => {
    for (let i = 0; i < 3; i++) {
      const port = await findFreePort();
      await expect(bindOnce(port)).resolves.toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/desktop/port.test.ts`
Expected: FAIL — `Failed to load url ./port`

- [ ] **Step 3: 포트 모듈을 만든다**

`src/lib/desktop/port.ts`:

```ts
import net from 'node:net';

/**
 * OS에게 빈 TCP 포트를 하나 물어본다. 포트 0으로 바인딩하면 커널이
 * 사용 중이 아닌 번호를 골라 주므로, 그 번호를 읽고 바로 닫는다.
 *
 * 닫은 뒤 서버가 실제로 바인딩하기까지 짧은 경합 구간이 남는다. 그래도
 * 고정 포트보다 낫다: 고정 포트는 "누가 이미 쓰고 있으면 항상 실패"지만
 * 이쪽은 "그 찰나에 다른 프로그램이 같은 번호를 가져가면 실패"라 훨씬
 * 드물다. 실패하면 main의 기동 대기가 시간 초과로 걸러낸다.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('빈 포트를 알아내지 못했습니다')));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/desktop/port.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: env 테스트를 쓴다**

`src/lib/desktop/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildServerEnv } from './env';

const BASE = {
  port: 45678,
  userDataDir: '/Users/me/Library/Application Support/uls-player',
  binariesDir: null,
  base: {} as NodeJS.ProcessEnv,
  platform: 'darwin' as NodeJS.Platform
};

describe('서버 자식에게 넘길 환경변수', () => {
  it('ORIGIN이 PORT와 같은 포트를 가리킨다', () => {
    const env = buildServerEnv(BASE);
    expect(env.PORT).toBe('45678');
    expect(env.ORIGIN).toBe('http://127.0.0.1:45678');
  });

  it('바깥에서 못 붙도록 127.0.0.1에만 바인딩한다', () => {
    expect(buildServerEnv(BASE).HOST).toBe('127.0.0.1');
  });

  it('Electron 바이너리를 순수 Node로 돌리도록 표시한다', () => {
    expect(buildServerEnv(BASE).ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('DATA_DIR과 MEDIA_DIR을 userData 아래로 잡는다', () => {
    const env = buildServerEnv(BASE);
    expect(env.DATA_DIR).toBe(path.join(BASE.userDataDir, 'data'));
    expect(env.MEDIA_DIR).toBe(path.join(BASE.userDataDir, 'media'));
  });

  it('이미 지정된 DATA_DIR은 덮어쓰지 않는다', () => {
    const env = buildServerEnv({ ...BASE, base: { DATA_DIR: '/mnt/library/data' } });
    expect(env.DATA_DIR).toBe('/mnt/library/data');
  });

  it('이미 지정된 MEDIA_DIR은 덮어쓰지 않는다', () => {
    const env = buildServerEnv({ ...BASE, base: { MEDIA_DIR: '/mnt/library/media' } });
    expect(env.MEDIA_DIR).toBe('/mnt/library/media');
  });

  it('빈 문자열 DATA_DIR은 지정하지 않은 것으로 본다', () => {
    const env = buildServerEnv({ ...BASE, base: { DATA_DIR: '  ' } });
    expect(env.DATA_DIR).toBe(path.join(BASE.userDataDir, 'data'));
  });

  it('ORIGIN은 바깥 값이 있어도 셸이 이긴다 — 포트가 어긋나면 403이 된다', () => {
    const env = buildServerEnv({ ...BASE, base: { ORIGIN: 'https://example.com' } });
    expect(env.ORIGIN).toBe('http://127.0.0.1:45678');
  });

  it('동봉 폴더를 주면 Windows에서 .exe 확장자를 붙인다', () => {
    const env = buildServerEnv({
      ...BASE,
      platform: 'win32',
      binariesDir: 'C:\\app\\resources\\ffmpeg\\win'
    });
    expect(env.FFMPEG_PATH).toBe(path.join('C:\\app\\resources\\ffmpeg\\win', 'ffmpeg.exe'));
    expect(env.FFPROBE_PATH).toBe(path.join('C:\\app\\resources\\ffmpeg\\win', 'ffprobe.exe'));
  });

  it('동봉 폴더를 주면 그 외 플랫폼에서는 확장자를 붙이지 않는다', () => {
    const env = buildServerEnv({ ...BASE, binariesDir: '/app/resources/ffmpeg/darwin' });
    expect(env.FFMPEG_PATH).toBe('/app/resources/ffmpeg/darwin/ffmpeg');
  });

  it('동봉 폴더가 없으면 FFMPEG_PATH를 넣지 않는다 — PATH에 맡긴다', () => {
    const env = buildServerEnv(BASE);
    expect(env.FFMPEG_PATH).toBeUndefined();
    expect(env.FFPROBE_PATH).toBeUndefined();
  });

  it('이미 지정된 FFMPEG_PATH는 동봉 폴더보다 우선한다', () => {
    const env = buildServerEnv({
      ...BASE,
      binariesDir: '/app/resources/ffmpeg/darwin',
      base: { FFMPEG_PATH: '/opt/homebrew/bin/ffmpeg' }
    });
    expect(env.FFMPEG_PATH).toBe('/opt/homebrew/bin/ffmpeg');
  });

  it('업로드 본문 한도를 4GB로 올린다 — 기본값 512KB면 첫 파일부터 막힌다', () => {
    expect(buildServerEnv(BASE).BODY_SIZE_LIMIT).toBe(String(4 * 1024 ** 3));
  });

  it('바깥 환경변수를 그대로 물려준다', () => {
    const env = buildServerEnv({ ...BASE, base: { CONVERT_CONCURRENCY: '2' } });
    expect(env.CONVERT_CONCURRENCY).toBe('2');
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/desktop/env.test.ts`
Expected: FAIL — `Failed to load url ./env`

- [ ] **Step 7: env 모듈을 만든다**

`src/lib/desktop/env.ts`:

```ts
import path from 'node:path';

export interface ServerEnvOptions {
  /** 서버가 바인딩할 포트. ORIGIN도 이 포트를 가리킨다. */
  port: number;
  /** 앱 전용 데이터 폴더(Electron의 userData). data/·media/의 부모가 된다. */
  userDataDir: string;
  /** 동봉한 ffmpeg/ffprobe가 든 폴더. null이면 PATH에 맡긴다. */
  binariesDir: string | null;
  /** 기반이 되는 환경변수. 보통 process.env. */
  base: NodeJS.ProcessEnv;
  /** 실행 플랫폼. 인자로 받는 이유는 win32 분기를 macOS에서 테스트하기 위해서다. */
  platform: NodeJS.Platform;
}

/** adapter-node의 요청 본문 한도. 기본값 512KB면 업로드가 첫 파일부터 막힌다. */
const BODY_SIZE_LIMIT = String(4 * 1024 ** 3);

/** 빈 문자열은 "지정하지 않음"으로 본다 — config.ts의 num()과 같은 규약. */
function unset(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

/**
 * 서버 자식 프로세스에게 넘길 환경변수를 만든다.
 *
 * 규칙이 두 갈래다.
 *
 * - HOST/PORT/ORIGIN/ELECTRON_RUN_AS_NODE는 **셸이 이긴다.** 포트는 실행마다
 *   달라지고, ORIGIN이 실제 바인딩 주소와 어긋나면 SvelteKit의 CSRF 검사가
 *   form POST를 전부 403으로 막는다(가져오기 저장, 일괄 내려받기).
 * - DATA_DIR/MEDIA_DIR/FFMPEG_PATH/FFPROBE_PATH는 **바깥이 이긴다.** 셸이
 *   넣는 것은 기본값일 뿐이고, 사용자가 라이브러리를 다른 드라이브로
 *   옮기고 싶을 때 환경변수만으로 되게 둔다.
 */
export function buildServerEnv(o: ServerEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...o.base,
    ELECTRON_RUN_AS_NODE: '1',
    HOST: '127.0.0.1',
    PORT: String(o.port),
    ORIGIN: `http://127.0.0.1:${o.port}`,
    BODY_SIZE_LIMIT
  };

  if (unset(o.base.DATA_DIR)) env.DATA_DIR = path.join(o.userDataDir, 'data');
  if (unset(o.base.MEDIA_DIR)) env.MEDIA_DIR = path.join(o.userDataDir, 'media');

  if (o.binariesDir !== null) {
    const suffix = o.platform === 'win32' ? '.exe' : '';
    if (unset(o.base.FFMPEG_PATH)) {
      env.FFMPEG_PATH = path.join(o.binariesDir, `ffmpeg${suffix}`);
    }
    if (unset(o.base.FFPROBE_PATH)) {
      env.FFPROBE_PATH = path.join(o.binariesDir, `ffprobe${suffix}`);
    }
  }

  return env;
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/desktop/env.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 9: 종료 명령 테스트를 쓴다**

`src/lib/desktop/shutdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shutdownCommand } from './shutdown';

describe('서버 프로세스 종료 명령', () => {
  it('Windows에서는 자식 트리까지 함께 죽인다', () => {
    const cmd = shutdownCommand('win32', 4321);
    expect(cmd).toEqual({
      kind: 'taskkill',
      command: 'taskkill',
      args: ['/PID', '4321', '/T', '/F']
    });
  });

  it('Windows 인자에 /T가 반드시 들어간다 — 없으면 ffmpeg가 고아로 남는다', () => {
    const cmd = shutdownCommand('win32', 1);
    expect(cmd.kind === 'taskkill' && cmd.args).toContain('/T');
  });

  it('macOS에서는 SIGTERM을 보낸다', () => {
    expect(shutdownCommand('darwin', 4321)).toEqual({ kind: 'signal', signal: 'SIGTERM' });
  });

  it('Linux에서는 SIGTERM을 보낸다', () => {
    expect(shutdownCommand('linux', 4321)).toEqual({ kind: 'signal', signal: 'SIGTERM' });
  });
});
```

- [ ] **Step 10: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/desktop/shutdown.test.ts`
Expected: FAIL — `Failed to load url ./shutdown`

- [ ] **Step 11: 종료 모듈을 만든다**

`src/lib/desktop/shutdown.ts`:

```ts
export type ShutdownCommand =
  | { kind: 'taskkill'; command: 'taskkill'; args: string[] }
  | { kind: 'signal'; signal: NodeJS.Signals };

/**
 * 서버 자식 프로세스를 어떻게 죽일지 고른다.
 *
 * Windows에는 유닉스 같은 프로세스 그룹이 없어, 부모만 죽이면 서버가
 * spawn한 ffmpeg가 살아남는다 — 앱을 닫아도 변환이 계속 돌며 media/에
 * 파일을 쓴다. 사용자에게는 보이지 않는 채로. taskkill의 /T가 자식
 * 트리까지 함께 죽인다.
 */
export function shutdownCommand(platform: NodeJS.Platform, pid: number): ShutdownCommand {
  if (platform === 'win32') {
    return { kind: 'taskkill', command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
  }
  return { kind: 'signal', signal: 'SIGTERM' };
}
```

- [ ] **Step 12: 전체 단위 테스트를 돌린다**

Run: `npm run test:unit -- --run`
Expected: PASS — 기존 + Task 1의 7개 + 이번 21개

- [ ] **Step 13: 커밋**

```bash
git add src/lib/desktop/
git commit -m "feat: Electron 셸의 순수 로직 — 포트·env·종료 명령

Electron API를 부르지 않는 부분만 먼저 떼어낸다. src/lib/desktop에 두면
기존 vitest server 프로젝트가 그대로 주워 단위 테스트가 붙는다.

platform을 인자로 받는 이유는 win32 분기(taskkill /T)를 macOS에서
검증하기 위해서다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Electron 셸과 기동 e2e

**Files:**
- Create: `electron/main.ts`
- Create: `tsconfig.electron.json`
- Create: `scripts/write-cjs-marker.mjs`
- Create: `playwright.electron.config.ts`
- Create: `tests/electron/launch.spec.ts`
- Modify: `package.json` (`main` 필드, scripts, devDependencies)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `findFreePort()`, `buildServerEnv()`, `shutdownCommand()` (Task 2)
- Produces: `npm run desktop`으로 실행되는 앱. `npm run desktop:build`가 `dist-electron/electron/main.js`를 만든다.

- [ ] **Step 1: Electron과 electron-builder를 설치한다**

```bash
npm i -D electron@^44.4.5 electron-builder@^26.15.3
```

Expected: 설치 성공. Electron이 postinstall에서 플랫폼 바이너리를 받는다(수백 MB, 몇 분 걸릴 수 있다).

- [ ] **Step 2: .gitignore에 빌드 산출물을 더한다**

`.gitignore`의 `/build` 아래에 붙인다:

```
/dist-electron
/release
# 동봉용 ffmpeg 바이너리 — 100MB가 넘어 커밋하지 않는다(Task 5)
/ffmpeg
```

- [ ] **Step 3: tsconfig.electron.json을 만든다**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "rootDir": ".",
    "outDir": "dist-electron",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "sourceMap": true
  },
  "include": ["electron/**/*.ts", "src/lib/desktop/**/*.ts"],
  "exclude": ["src/lib/desktop/**/*.test.ts"]
}
```

`rootDir`가 `.`이므로 출력은 `dist-electron/electron/main.js`와 `dist-electron/src/lib/desktop/*.js`가 된다.

- [ ] **Step 4: CommonJS 표시 스크립트를 만든다**

`scripts/write-cjs-marker.mjs`:

```js
/**
 * 루트 package.json에 "type": "module"이 있어서, 그대로 두면 Node가
 * dist-electron 아래의 .js를 ESM으로 읽는다. tsc가 낸 것은 CommonJS다.
 *
 * "가장 가까운 package.json이 이긴다"는 Node의 규칙을 이용해 이 디렉터리
 * 하나만 CommonJS로 되돌린다. 샌드박스 preload가 ESM을 지원하지 않으므로
 * CommonJS 출력은 선택이 아니라 요구사항이다.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist-electron');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
);
console.log('dist-electron/package.json 작성: {"type":"commonjs"}');
```

- [ ] **Step 5: package.json에 main과 스크립트를 더한다**

`"private": true` 아래에 `main`을 더한다:

```json
"main": "dist-electron/electron/main.js",
```

`scripts`에 넷을 더한다:

```json
"desktop:build": "npm run build && tsc -p tsconfig.electron.json && node scripts/write-cjs-marker.mjs",
"desktop": "npm run desktop:build && electron .",
"test:e2e:electron": "npm run desktop:build && playwright test -c playwright.electron.config.ts",
"dist:win": "npm run desktop:build && electron-builder --win --publish never"
```

- [ ] **Step 6: main.ts를 쓴다**

`electron/main.ts`:

```ts
import { app, BrowserWindow, dialog, shell } from 'electron';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { buildServerEnv } from '../src/lib/desktop/env';
import { findFreePort } from '../src/lib/desktop/port';
import { shutdownCommand } from '../src/lib/desktop/shutdown';

/** 서버가 응답할 때까지 기다리는 최대 시간. */
const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// 개발 중에는 실제 데이터와 섞이지 않게 별도 폴더를 쓴다.
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'uls-player-dev'));
}

/**
 * 패키지에서는 build/가 asar 밖(extraResources)에 있다. ESM 로더와 asar의
 * 조합이 알려진 문제군이라 통째로 밖에 뒀다 — 설계 문서 3절.
 */
function serverEntry(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(root, 'build', 'index.js');
}

/** 동봉한 ffmpeg 폴더. 개발 중에는 null이라 PATH의 ffmpeg를 쓴다. */
function binariesDir(): string | null {
  if (!app.isPackaged) return null;
  return path.join(process.resourcesPath, 'ffmpeg', 'win');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(): Promise<number> {
  const port = await findFreePort();
  const env = buildServerEnv({
    port,
    userDataDir: app.getPath('userData'),
    binariesDir: binariesDir(),
    base: process.env,
    platform: process.platform
  });

  // execPath를 Electron 바이너리로 두고 env의 ELECTRON_RUN_AS_NODE=1을
  // 함께 넘기면, 그 바이너리가 순수 Node로 동작한다 — node.exe를 따로
  // 동봉할 필요가 없다.
  const child = fork(serverEntry(), [], {
    execPath: process.execPath,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  child.stdout?.on('data', (c: Buffer) => process.stdout.write(`[서버] ${c}`));
  child.stderr?.on('data', (c: Buffer) => process.stderr.write(`[서버] ${c}`));
  child.on('exit', onServerExit);
  serverProcess = child;

  // e2e가 종료 정리를 검증할 때 이 pid를 읽는다(tests/electron/launch.spec.ts).
  // 진단용이기도 하다 — 문제가 생겼을 때 어느 프로세스를 봐야 하는지 알려준다.
  process.env.ULS_SERVER_PID = String(child.pid);

  return port;
}

async function waitForServer(port: number): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      // 5xx도 "떴다"로 본다 — 포트가 응답하는 것이 여기서 확인할 전부다.
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      // 아직 안 떴다.
    }
    if (Date.now() > deadline) {
      throw new Error(`서버가 ${STARTUP_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다`);
    }
    await delay(POLL_INTERVAL_MS);
  }
}

function stopServer(): void {
  const proc = serverProcess;
  if (proc === null || proc.exitCode !== null || proc.signalCode !== null) return;
  serverProcess = null;
  // 우리가 죽이는 것은 오류가 아니다 — 오류 대화상자가 뜨지 않게 뗀다.
  proc.off('exit', onServerExit);

  const cmd = shutdownCommand(process.platform, proc.pid as number);
  if (cmd.kind === 'taskkill') {
    execFile(cmd.command, cmd.args, () => {
      // 이미 죽었으면 taskkill이 실패한다. 종료 중이므로 무시한다.
    });
  } else {
    proc.kill(cmd.signal);
  }
}

function onServerExit(code: number | null, signal: NodeJS.Signals | null): void {
  serverProcess = null;
  fail('서버가 예기치 않게 종료되었습니다', `종료 코드 ${code}, 신호 ${signal}`);
}

function fail(title: string, detail: string): void {
  dialog.showErrorBox(title, detail);
  stopServer();
  app.exit(1);
}

function createWindow(port: number): void {
  const origin = `http://127.0.0.1:${port}`;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'ULS Player',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 앱 바깥으로 나가는 이동은 창이 아니라 기본 브라우저가 받는다.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(origin);
}

async function main(): Promise<void> {
  await app.whenReady();
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

// 두 인스턴스가 뜨면 각자 잡 큐를 돌려 같은 recordings.json을 서로
// 덮어쓴다 — ecosystem.config.cjs가 클러스터 모드를 금지한 것과 같은
// 손상이다. 서버에서는 pm2 설정으로, 데스크톱에서는 여기서 막는다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', stopServer);
  void main();
}
```

- [ ] **Step 7: 빌드하고 직접 띄워 본다**

Run: `npm run desktop`
Expected: Electron 창이 뜨고 "ULS Player" 제목과 녹음 목록/가져오기 링크가 보인다. 터미널에 `[서버] Listening on http://127.0.0.1:<포트>`가 찍힌다. 창을 닫으면 앱이 끝난다.

문제가 있으면 여기서 멈추고 고친다 — 다음 단계의 e2e는 이게 되는 것을 전제한다.

- [ ] **Step 8: Playwright Electron 설정을 만든다**

`playwright.electron.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

/**
 * Electron 앱 e2e 전용 설정.
 *
 * 기존 playwright.config.ts와 파일을 분리한 이유: 그쪽의 webServer(4173
 * preview)는 설정 최상위 항목이라 프로젝트별로 끌 수 없다. 같은 설정에
 * Electron 스펙을 얹으면 쓰지도 않을 preview 서버를 매번 띄운다 —
 * Electron 앱은 자기 서버를 데리고 온다.
 */
export default defineConfig({
  testDir: 'tests/electron',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // 앱 인스턴스가 여럿 뜨면 단일 인스턴스 잠금에 걸려 두 번째가 즉시 죽는다.
  workers: 1
});
```

- [ ] **Step 9: 기동 e2e를 쓴다**

`tests/electron/launch.spec.ts`:

```ts
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
  await app.firstWindow();
  const pid = Number(await app.evaluate(() => process.env.ULS_SERVER_PID));
  expect(pid).toBeGreaterThan(0);
  expect(isAlive(pid)).toBe(true);

  await app.close();

  // 종료 정리를 지우면 서버가 계속 살아 있어 이 단언이 깨진다.
  await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);
});
```

- [ ] **Step 10: e2e를 돌린다**

Run: `npm run test:e2e:electron`
Expected: PASS (2 tests)

- [ ] **Step 11: 기존 테스트가 깨지지 않았는지 확인한다**

Run: `npm run test:unit -- --run`
Expected: PASS

- [ ] **Step 12: 커밋**

```bash
git add electron/ tsconfig.electron.json scripts/write-cjs-marker.mjs \
        playwright.electron.config.ts tests/electron/ package.json package-lock.json .gitignore
git commit -m "feat: SvelteKit 서버를 감싸는 Electron 셸

빈 포트를 골라 ELECTRON_RUN_AS_NODE로 build/index.js를 fork하고, 서버가
응답한 뒤에 창을 연다. 흰 화면을 띄워놓고 방치하지 않기 위해서다.

단일 인스턴스 잠금은 선택이 아니다 — 두 인스턴스는 같은 JSON 저장소를
서로 덮어쓴다.

dist-electron/package.json에 {\"type\":\"commonjs\"}를 써 넣는 이유는
루트 package.json의 \"type\": \"module\" 때문이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 네이티브 폴더 선택

**Files:**
- Create: `electron/preload.ts`
- Create: `tests/electron/folder-picker.spec.ts`
- Modify: `electron/main.ts` (ipcMain 핸들러, `webPreferences.preload`)
- Modify: `src/app.d.ts` (`Window.ulsDesktop` 타입)
- Modify: `src/routes/import/+page.svelte:215-228`

**Interfaces:**
- Consumes: Task 3의 `electron/main.ts`
- Produces: 렌더러에서 `window.ulsDesktop?.pickFolder(): Promise<string | null>`

**배경:** 지금 가져오기 화면은 경로를 직접 타이핑한다(`src/routes/import/+page.svelte:216-228`). 데스크톱에서는 서버가 사용자 머신 자체이므로 네이티브 폴더 선택이 자연스럽다. **브라우저로 열면 지금과 완전히 같아야 한다** — 서버 배포에 영향이 없어야 한다.

- [ ] **Step 1: preload를 쓴다**

`electron/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';

/**
 * 렌더러에 노출하는 것은 이 하나뿐이다.
 *
 * 페이지는 우리가 띄운 서버에서 오지만, 노출 면적은 최소로 둔다 —
 * 폴더 하나를 고르는 데 더 필요한 것이 없다.
 */
contextBridge.exposeInMainWorld('ulsDesktop', {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('uls:pick-folder')
});
```

- [ ] **Step 2: main에 핸들러를 더한다**

`electron/main.ts`의 import에 `ipcMain`을 더한다:

```ts
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
```

`createWindow`의 `webPreferences`에 preload를 더한다:

```ts
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 컴파일 결과가 dist-electron/electron/ 안에 나란히 놓인다.
      preload: path.join(__dirname, 'preload.js')
    }
```

`main()` 안, `await app.whenReady();` 바로 다음 줄에 핸들러를 등록한다:

```ts
  ipcMain.handle('uls:pick-folder', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
```

- [ ] **Step 3: Window 타입을 넓힌다**

`src/app.d.ts`의 `declare global` 안에 더한다:

```ts
	interface Window {
		/**
		 * Electron 셸에서만 존재한다. 브라우저로 열면 undefined이므로,
		 * 쓰는 쪽은 반드시 존재를 먼저 확인해야 한다.
		 */
		ulsDesktop?: {
			pickFolder(): Promise<string | null>;
		};
	}
```

- [ ] **Step 4: 가져오기 화면에 버튼을 더한다**

`src/routes/import/+page.svelte`의 `<script>`에 상태 하나를 더한다(`let folder = $state('');` 근처):

```ts
  // Electron 셸에서만 true. 브라우저에서는 마크업이 지금과 완전히 같다.
  let hasDesktopPicker = $state(false);
  onMount(() => {
    hasDesktopPicker = typeof window !== 'undefined' && window.ulsDesktop !== undefined;
  });

  async function pickFolder() {
    const picked = await window.ulsDesktop?.pickFolder();
    if (picked !== null && picked !== undefined) folder = picked;
  }
```

`216-228`행의 폼을 바꾼다 — `bind:value={folder}`를 더하고, 버튼을 조건부로 넣는다:

```svelte
  <form method="POST" action="?/scan" use:enhance class="flex gap-2">
    <!-- 이 스캔은 서버가 자기 파일시스템의 폴더를 읽는다. placeholder에
         macOS 경로(/Volumes/…)를 박아두면, 서버에 배포해 쓸 때 사용자가
         자기 노트북 경로를 넣고 ENOENT를 보게 된다 — 실제로 그렇게
         헤맸다. 브라우저에서 올릴 때는 아래 업로드 영역을 쓴다.

         데스크톱 앱에서는 서버가 이 컴퓨터 자체라, 타이핑 대신 네이티브
         폴더 선택으로 고른다. 입력 칸은 그대로 둔다 — 버튼은 그 칸을
         채우는 보조 수단이지 대체물이 아니다. -->
    <input
      name="folder"
      bind:value={folder}
      class="input"
      aria-label="스캔할 서버 폴더 경로"
      placeholder="서버에 있는 폴더 경로 (내 컴퓨터의 파일은 아래에서 올립니다)"
      required
    />
    {#if hasDesktopPicker}
      <button type="button" class="btn preset-tonal whitespace-nowrap" onclick={pickFolder}>
        찾아보기
      </button>
    {/if}
    <button type="submit" class="btn preset-filled">스캔</button>
  </form>
```

- [ ] **Step 5: 폴더 선택 e2e를 쓴다**

`tests/electron/folder-picker.spec.ts`:

```ts
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
```

`page.goto`가 상대 경로를 못 쓰므로 현재 URL에서 origin을 만들어 붙인다 — 포트가 실행마다 다르기 때문이다.

- [ ] **Step 6: e2e를 돌린다**

Run: `npm run test:e2e:electron`
Expected: PASS (4 tests — Task 3의 2개 + 이번 2개)

- [ ] **Step 7: 브라우저에서 아무것도 안 바뀌었는지 확인한다**

Run: `npm run test:e2e`
Expected: PASS — 기존 e2e(33개)가 그대로 통과한다. `window.ulsDesktop`이 없으므로 찾아보기 버튼이 없고, 기존 스펙의 선택자는 영향을 받지 않는다.

- [ ] **Step 8: 커밋**

```bash
git add electron/ src/app.d.ts src/routes/import/+page.svelte tests/electron/
git commit -m "feat: 데스크톱에서 네이티브 폴더 선택으로 스캔 경로를 고른다

데스크톱에서는 서버가 이 컴퓨터 자체라 경로를 타이핑할 이유가 없다.
preload가 노출하는 것은 pickFolder 하나뿐이다.

입력 칸은 그대로 둔다 — 버튼은 그 칸을 채우는 보조 수단이다. 브라우저로
열면 window.ulsDesktop이 없어 버튼이 그려지지 않고, 화면은 지금과
완전히 같다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Windows 패키징

**Files:**
- Create: `electron-builder.yml`
- Create: `docs/desktop-packaging.md`
- Modify: `.gitignore` (Task 3에서 이미 `/ffmpeg` 추가됨 — 확인만)

**Interfaces:**
- Consumes: Task 1-4 전부
- Produces: `release/ULS-Player-0.0.1-portable.exe`, `release/ULS-Player-0.0.1-win.zip`

**확인된 전제:** `build/index.js`가 외부로 필요한 npm 패키지는 **`better-sqlite3` 하나뿐**이다(`archiver`는 rollup이 번들에 넣는다). 실측으로 확인했다 — `build/`만 있는 빈 디렉터리에서는 `ERR_MODULE_NOT_FOUND: better-sqlite3`로 죽고, `node_modules/better-sqlite3`만 복사하면 HTTP 200으로 뜬다. 그래서 `better-sqlite3`를 `resources/node_modules/`에 함께 넣는다 — `resources/build/index.js`에서 Node의 모듈 해석이 `resources/node_modules`를 먼저 본다.

- [ ] **Step 1: ffmpeg Windows 바이너리를 받는다 — 사용자 허락 필요**

**이 단계는 외부에서 파일을 내려받는다. 먼저 사용자에게 출처·파일명·크기를 알리고 허락을 받는다.** 허락 없이 받지 않는다.

받을 것: Windows x64용 `ffmpeg.exe`와 `ffprobe.exe`. 가능하면 공유 라이브러리(shared) 빌드를 골라 크기를 줄인다.

배치 위치:

```
ffmpeg/win/ffmpeg.exe
ffmpeg/win/ffprobe.exe
ffmpeg/win/*.dll        (shared 빌드일 때만)
```

배치 후 확인:

```bash
ls -la ffmpeg/win/ && du -sh ffmpeg/win/
```
Expected: `ffmpeg.exe`와 `ffprobe.exe`가 있고, 합계가 표시된다.

- [ ] **Step 2: electron-builder.yml을 쓴다**

```yaml
# Windows 배포 파일 2개를 만든다. 실행: npm run dist:win
appId: com.ulsplayer.app
productName: ULS Player
directories:
  output: release

files:
  - dist-electron/**
  - package.json

# asar 안에 들어가면 안 되는 것들.
extraResources:
  # SvelteKit 서버. ESM 로더와 asar의 조합이 알려진 문제군이라 밖에 둔다.
  - from: build
    to: build
  # better-sqlite3는 네이티브 모듈이라 rollup이 번들에 넣지 못한다 —
  # build/index.js가 런타임에 import한다(실측 확인). resources/node_modules에
  # 두면 resources/build/index.js에서 Node의 모듈 해석이 여기를 찾는다.
  # archiver는 번들에 들어가므로 따로 넣을 필요가 없다.
  - from: node_modules/better-sqlite3
    to: node_modules/better-sqlite3
    filter:
      - '**/*'
      - '!{deps,src,build}/**'
      - '!prebuilds/{darwin-arm64,darwin-x64,linux-arm64,linux-x64,linuxmusl-arm64,linuxmusl-x64,win32-arm64}.node'
  # 동봉 ffmpeg. 실행 가능해야 하므로 asar 밖이어야 한다.
  - from: ffmpeg/win
    to: ffmpeg/win

# N-API 바이너리라 Electron용으로 다시 빌드하지 않는다.
npmRebuild: false

win:
  target:
    - target: portable
      arch: [x64]
    - target: zip
      arch: [x64]
  # productName에 공백이 있어 파일명은 따로 정한다.
  artifactName: ULS-Player-${version}-win.${ext}

portable:
  artifactName: ULS-Player-${version}-portable.${ext}
```

- [ ] **Step 3: 빌드한다**

Run: `npm run dist:win`
Expected: `release/ULS-Player-0.0.1-portable.exe`와 `release/ULS-Player-0.0.1-win.zip`이 생긴다. 실패하면 로그의 원인을 고친다 — 추측으로 설정을 바꾸지 않는다.

- [ ] **Step 4: 산출물 구조를 확인한다**

```bash
ls -lh release/
unzip -l release/ULS-Player-0.0.1-win.zip | grep -E 'resources/(build/index.js|ffmpeg/win/ffmpeg.exe|ffmpeg/win/ffprobe.exe|node_modules/better-sqlite3/package.json)'
unzip -l release/ULS-Player-0.0.1-win.zip | grep -c 'resources/build/client/'
```

Expected:
- `portable.exe`와 `win.zip` 둘 다 존재
- grep이 네 줄 모두 찾는다 — `resources/build/index.js`, `ffmpeg.exe`, `ffprobe.exe`, `better-sqlite3/package.json`
- 마지막 명령이 0보다 큰 수를 낸다(클라이언트 자산이 들어 있다)

하나라도 빠지면 `extraResources` 설정을 고치고 Step 3으로 돌아간다.

- [ ] **Step 5: win32-x64 prebuild가 남아 있는지 확인한다**

```bash
unzip -l release/ULS-Player-0.0.1-win.zip | grep 'better-sqlite3/prebuilds/'
```

Expected: `win32-x64.node`만 보인다. darwin/linux 것이 함께 들어 있으면 `filter`가 안 먹은 것이므로 고친다.

- [ ] **Step 6: 배포 문서를 쓴다**

`docs/desktop-packaging.md`:

```markdown
# 데스크톱 패키징

## 만들기

    npm run dist:win

`release/`에 둘이 생긴다.

| 파일 | 쓰임 |
|---|---|
| `ULS-Player-<버전>-portable.exe` | 설치 없이 그대로 실행 |
| `ULS-Player-<버전>-win.zip` | 풀어서 `ULS Player.exe` 실행 |

빌드에는 `ffmpeg/win/ffmpeg.exe`와 `ffmpeg/win/ffprobe.exe`가 있어야 한다.
저장소에 커밋하지 않으므로(100MB가 넘는다) 새 환경에서는 먼저 받아 둔다.

## 데이터가 쌓이는 곳

`%APPDATA%\uls-player\data` 와 `...\media`.

옮기려면 환경변수를 지정한다 — 셸이 넣는 것은 기본값일 뿐이라 이미 있는
값을 덮어쓰지 않는다.

    set DATA_DIR=D:\uls\data
    set MEDIA_DIR=D:\uls\media

## 개발 중 실행

    npm run desktop

`app.isPackaged`가 false라 데이터가 `uls-player-dev` 폴더로 분리되고,
ffmpeg는 동봉본 대신 PATH의 것을 쓴다.

## e2e

    npm run test:e2e:electron

macOS에서 돈다. Windows 전용 부분(동봉 바이너리 경로, taskkill, exe 기동)은
여기서 검증되지 않는다 — 실제 Windows 머신에서 확인해야 한다.
```

- [ ] **Step 7: 전체 테스트를 돌린다**

Run: `npm run test:unit -- --run && npm run test:e2e && npm run test:e2e:electron`
Expected: 셋 다 PASS

- [ ] **Step 8: 커밋**

```bash
git add electron-builder.yml docs/desktop-packaging.md .gitignore
git commit -m "feat: Windows portable exe 패키징

build/, better-sqlite3, ffmpeg를 asar 밖 extraResources에 둔다.

better-sqlite3를 따로 넣는 이유는 실측으로 확인했다: build/만 있는 빈
디렉터리에서 서버를 띄우면 better-sqlite3 하나만 ERR_MODULE_NOT_FOUND로
죽고, 그것만 넣으면 뜬다. archiver는 rollup이 번들에 넣는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: 사용자에게 exe를 전달하고 Windows 검증을 요청한다**

`release/ULS-Player-0.0.1-portable.exe`를 사용자에게 전달하고 다음을 확인해 달라고 요청한다.

1. exe를 두 번 눌러 창이 뜬다
2. 가져오기 → 찾아보기로 폴더를 고른다 → 스캔이 파일을 찾는다
3. 저장하면 변환이 돌고 목록에 나타난다
4. 재생된다
5. 파일 하나를 내려받으면 `제목_날짜.확장자`로 저장된다
6. 여러 개를 골라 일괄 내려받으면 zip이 저장된다
7. 변환 도중에 앱을 닫고, 작업 관리자에 `ffmpeg.exe`가 남지 않는지 본다

실패하면 증상과 로그를 받아 고친다.

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 절 | Task |
|---|---|
| 3. 프로세스 구조 (fork, ELECTRON_RUN_AS_NODE, build/ asar 밖) | 3, 5 |
| 4. 포트와 ORIGIN | 2 (`env.ts`), 3 (`startServer`) |
| 5. 기동 대기와 실패 | 3 (`waitForServer`, `fail`) |
| 6. 단일 인스턴스 | 3 |
| 7. 종료 / 고아 ffmpeg | 2 (`shutdown.ts`), 3 (`stopServer`) |
| 8. ffmpeg 경로 | 1, 5 |
| 9. 데이터 위치 + env 우선순위 | 2 (`env.ts`), 3 (`userData`) |
| 10. 폴더 선택 | 4 |
| 11. 창 보안 | 3 (`will-navigate`, `setWindowOpenHandler`, sandbox) |
| 12. 테스트 | 각 Task의 테스트 단계 |
| 13. 빌드 | 3 (tsc·마커·Playwright 설정), 5 (electron-builder) |

스펙 12절의 "다운로드 저장 대화상자"는 Task 5 Step 9의 수동 검증 5·6번으로 들어간다. 별도 코드가 없으므로 자동 테스트를 만들지 않는다.

**2. 플레이스홀더 점검**

"적절히 처리한다" 류 없음. 모든 코드 단계에 실제 코드가 들어 있다. Task 5 Step 1의 ffmpeg 출처는 의도적으로 비워 둔 것이 아니라, **사용자 허락이 필요한 단계**라서 실행 시점에 정한다 — 단계 자체에 그렇게 적었다.

**3. 타입 일관성**

- `findFreePort(): Promise<number>` — Task 2 정의, Task 3 사용 ✓
- `buildServerEnv(o: ServerEnvOptions)` — 필드 5개(`port`, `userDataDir`, `binariesDir`, `base`, `platform`), Task 3의 호출이 다섯 개를 모두 넘긴다 ✓
- `shutdownCommand(platform, pid): ShutdownCommand` — `kind: 'taskkill' | 'signal'`, Task 3의 `stopServer`가 두 갈래를 모두 처리한다 ✓
- `FFMPEG`/`FFPROBE` — Task 1 정의, Task 1 Step 7의 세 호출부가 사용 ✓
- `window.ulsDesktop?.pickFolder()` — Task 4의 preload·`app.d.ts`·Svelte 페이지에서 같은 이름과 반환 타입 ✓
- IPC 채널 이름 `'uls:pick-folder'` — preload와 main에서 동일 ✓
