# Electron Windows 패키징 설계

## 1. 목표

ULS Player를 Windows에서 **실행 파일 하나로 돌아가는 데스크톱 앱**으로 만든다. 서버를 세우거나 Node를 설치하지 않고, exe를 받아 두 번 누르면 켜진다.

기존 서버 배포(nginx + pm2)는 그대로 유지한다. 이 설계의 변경은 전부 기본값을 바꾸지 않는 방향이라, 서버 쪽 동작은 달라지지 않는다.

## 2. 왜 Electron인가 — 그리고 왜 VOCAL_CRM보다 손이 더 가는가

VOCAL_CRM은 Electron main + React 렌더러로 이미 자족적인 앱이라 electron-builder가 그대로 감쌌다. 이 앱은 다르다.

| | VOCAL_CRM | ULS Player |
|---|---|---|
| 구조 | Electron main + 렌더러 | SvelteKit **HTTP 서버**(adapter-node) |
| 네이티브 의존 | better-sqlite3 | better-sqlite3 **+ 외부 ffmpeg/ffprobe 프로세스** |
| 데이터 | userData 아래 sqlite 파일 하나 | `DATA_DIR`/`MEDIA_DIR` 아래 수 GB의 음원 |

즉 이 작업은 "앱을 감싸기"가 아니라 **서버 한 벌과 ffmpeg 두 개를 exe 안에 넣고, 셸이 그 생명주기를 관리하게 만들기**다.

검토한 대안 둘은 채택하지 않았다. Node SEA/pkg로 서버만 묶는 길은 네이티브 모듈(better-sqlite3)과 맞지 않고 콘솔 창이 뜬다. 서버 배포를 그대로 쓰는 길(패키징 안 함)은 비용이 0이지만, 서버에 접근할 수 없는 Windows 머신에서는 답이 되지 않는다.

**중요한 부수효과:** Electron에서는 "서버"가 사용자 머신 자체다. 서버 배포에서 골치였던 업로드 경로(멀티파트 바디를 통째로 메모리에 올리는 `request.formData()` 제약)가 필요 없어진다. `scan` 액션이 로컬 폴더를 직접 읽는 것이 자연스러운 가져오기 경로가 된다.

## 3. 프로세스 구조

```
Electron main (셸)  ─fork─▶  SvelteKit 서버         ─spawn─▶  ffmpeg / ffprobe
  창·생명주기·IPC             build/index.js
                              127.0.0.1:<빈 포트>
```

**서버 기동:** `child_process.fork(build/index.js, { execPath: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1', … } })`.

`ELECTRON_RUN_AS_NODE`는 Electron 바이너리를 순수 Node로 돌리는 공식 모드다. **node.exe를 따로 동봉할 필요가 없다** — 이미 들어 있는 Electron이 그 역할을 한다.

`utilityProcess.fork`라는 대안이 있지만 ESM 지원 여부가 확실치 않다. adapter-node의 `build/index.js`는 ESM이므로, 확인된 길을 택한다. **구현 첫 태스크에서 스파이크로 검증하고, 실패하면 그 자리에서 `utilityProcess`로 되돌린다** — 이 선택은 구조의 나머지에 영향을 주지 않는다.

**`build/`는 asar 밖(`extraResources`)에 둔다.** ESM 로더와 asar의 조합은 알려진 문제군이다. 통째로 밖에 두면 그 문제군을 통째로 피한다. 개인용 도구라 파일이 그대로 보이는 것은 문제가 되지 않는다.

## 4. 포트와 ORIGIN

포트를 고정하면 다른 프로그램이 그 포트를 쓸 때 앱이 아예 뜨지 않는다. `net.createServer().listen(0)`으로 빈 포트를 받아 즉시 닫고, 그 번호를 자식에게 넘긴다.

```
PORT   = <빈 포트>
ORIGIN = http://127.0.0.1:<빈 포트>
HOST   = 127.0.0.1
```

**ORIGIN은 반드시 실제 주소와 같아야 한다.** SvelteKit의 CSRF 검사가 form POST의 origin 헤더를 서버가 아는 자기 주소와 비교하는데, 어긋나면 가져오기 저장과 일괄 내려받기가 전부 403이 된다. 서버 배포에서 이미 겪은 실패다.

포트를 확보한 뒤 자식이 실제로 bind하기까지 아주 짧은 경합 구간이 있다. 단일 인스턴스 잠금(6절)이 자기 자신과의 충돌을 막고, 남는 것은 그 사이 다른 프로그램이 같은 포트를 잡는 경우뿐이다 — 이 경우 기동 대기가 실패해 5절의 오류 대화상자로 이어진다.

`BODY_SIZE_LIMIT`은 `.env.example`과 같은 값(4GB)을 넘긴다. 데스크톱에서는 업로드 대신 `scan`을 쓰지만, 업로드 경로 자체는 살아 있으므로 서버와 같은 한도를 유지한다.

## 5. 기동 대기와 실패

창은 서버가 **응답한 뒤에** 만든다. `http://127.0.0.1:<port>/`를 200ms 간격으로 폴링하고, 응답하면 `BrowserWindow`를 만들어 그 주소를 연다.

15초 안에 응답이 없으면 `dialog.showErrorBox`로 알리고 종료한다. 흰 화면을 띄워놓고 방치하지 않기 위해서다.

자식이 예기치 않게 죽으면(`exit` 이벤트) 같은 방식으로 알리고 종료한다. 서버 없이 남은 창은 아무 일도 할 수 없다.

## 6. 단일 인스턴스 — 필수

`app.requestSingleInstanceLock()`을 얻지 못하면 즉시 종료하고, 기존 창을 앞으로 가져온다.

두 인스턴스가 뜨면 각자 잡 큐를 돌려 같은 `jobs.json`과 `recordings.json`을 덮어쓴다. `ecosystem.config.cjs`가 클러스터 모드를 금지한 이유와 **정확히 같은 손상**이다. 서버에서는 pm2 설정으로 막았고, 데스크톱에서는 여기서 막는다.

## 7. 종료 — Windows의 고아 ffmpeg

`before-quit`에서 서버 자식을 정리한다.

Windows에는 유닉스 같은 프로세스 그룹이 없어, 부모를 죽여도 **손자 ffmpeg가 살아남는다.** 앱을 닫아도 변환이 계속 돌며 `media/`에 파일을 쓴다 — 사용자에게는 보이지 않는 채로.

그래서 플랫폼별로 나눈다.

- Windows: `taskkill /PID <pid> /T /F` — `/T`가 자식 트리까지 함께 죽인다
- 그 외: `child.kill('SIGTERM')`

`taskkill` 인자 구성은 순수 함수로 분리해 테스트한다(12절).

## 8. ffmpeg 경로

`probe.ts`·`convert.ts`·`waveform.ts` 세 곳이 `'ffmpeg'`/`'ffprobe'`를 문자열 그대로 spawn한다. PATH에 기대는 구조라 동봉한 바이너리를 쓸 방법이 없다.

새 모듈 하나를 만든다.

```ts
// src/lib/server/media/binaries.ts
export const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
```

**`AppConfig`에 넣지 않는 이유:** `probe(filePath)`, `convert(input, output, streamIndex, spec)`, `generatePeaks(input, streamIndex, peaks)` 셋 다 `cfg`를 받지 않는다. config로 넘기려면 세 함수의 시그니처와 모든 호출부, 그리고 그 테스트들이 전부 따라 바뀐다. 얻는 것 없이 변경 면적만 넓어진다.

모듈 상수는 `config.ts`의 `export const config = loadConfig(process.env)`와 같은 패턴이라 이 코드베이스에 이미 있는 방식이다.

호출부 변경은 세 줄이고, 기본값이 `'ffmpeg'`이므로 **환경변수를 주지 않는 서버 배포는 아무것도 달라지지 않는다.**

동봉하는 바이너리는 `extraResources`의 `ffmpeg/win/` 아래 두고, main이 `process.resourcesPath` 기준으로 절대경로를 만들어 `FFMPEG_PATH`/`FFPROBE_PATH`로 넘긴다.

**크기:** `ffmpeg.exe`와 `ffprobe.exe` 정적 빌드 둘이면 150MB 안팎이다. VOCAL_CRM portable이 105MB였으므로 최종 exe는 **250~300MB**로 예상한다. 가능하면 공유 라이브러리 빌드를 써서 줄인다.

바이너리는 내려받아야 한다. **출처·파일명·크기를 사용자에게 알리고 허락을 받은 뒤에 받는다.**

## 9. 데이터 위치

main이 `app.getPath('userData')` 아래 `data/`와 `media/`를 만들어 `DATA_DIR`/`MEDIA_DIR`로 넘긴다. VOCAL_CRM과 같은 자리다.

**받아들인 절충:** 11GB 규모의 라이브러리가 C드라이브 Roaming 프로필에 쌓인다. 도메인 환경에서는 로밍 동기화 대상이 되기도 한다. exe 옆 폴더(`PORTABLE_EXECUTABLE_DIR`)를 쓰면 이 문제가 없지만 Program Files 아래에서는 쓰기 권한이 없어 실패한다 — 권한 문제가 없는 쪽을 택했다.

나중에 옮길 수 있도록 **이미 `process.env`에 `DATA_DIR`/`MEDIA_DIR`이 있으면 main은 덮어쓰지 않는다.** 셸이 넣는 것은 기본값일 뿐이고, 사용자가 명시한 값이 이긴다. 설정 화면은 만들지 않는다(14절).

개발 중에는 `app.isPackaged`가 false일 때 `userData`를 `join(app.getPath('appData'), 'uls-player-dev')`로 돌려, 실제 데이터와 섞이지 않게 한다. VOCAL_CRM이 쓰는 방식과 같다.

## 10. 폴더 선택

preload가 `contextBridge.exposeInMainWorld`로 딱 하나를 노출한다.

```ts
window.ulsDesktop.pickFolder(): Promise<string | null>
```

main이 `dialog.showOpenDialog({ properties: ['openDirectory'] })`를 띄우고, 고른 경로를 돌려준다. 취소하면 `null`.

가져오기 페이지는 **`window.ulsDesktop`이 있을 때만** 찾아보기 버튼을 그린다. 브라우저로 열면 지금과 완전히 같은 화면이다 — 서버 배포에 영향이 없다.

경로 입력 칸은 그대로 둔다. 버튼은 그 칸을 채우는 보조 수단이지 대체물이 아니다. 붙여넣기로 쓰던 방식이 계속 통해야 한다.

## 11. 창 보안

```
contextIsolation: true
nodeIntegration:  false
sandbox:          true
```

페이지를 `http://127.0.0.1:<port>`에서 불러오므로 `will-navigate`로 그 origin 밖 이동을 막고, `setWindowOpenHandler`로 새 창을 막되 외부 링크는 `shell.openExternal`로 보낸다.

`/api/download`의 zip은 Electron 기본 동작으로 저장 대화상자가 뜬다. 별도 처리를 하지 않되, Windows 수동 검증 항목에 넣는다.

## 12. 테스트

| 층 | 확인 | 깨뜨리는 변경 |
|---|---|---|
| 단위 | `FFMPEG`/`FFPROBE` 기본값이 `'ffmpeg'`/`'ffprobe'` | `?? 'ffmpeg'` 제거 시 실패 |
| 단위 | `FFMPEG_PATH`가 있으면 그 값을 쓴다 | env 읽기 제거 시 실패 |
| 단위 | 빈 포트 선택이 1024 이상의 수를 준다 | 고정 포트로 바꾸면 실패 |
| 단위 | 종료 명령이 Windows에서 `taskkill /PID <pid> /T /F` | `/T` 빠지면 실패 |
| 단위 | 종료 명령이 그 외 플랫폼에서 SIGTERM | 플랫폼 분기 제거 시 실패 |
| 단위 | 서버 env 조립에서 `ORIGIN`이 `PORT`와 같은 포트를 가리킨다 | 포트가 어긋나면 실패 |
| e2e (macOS) | 앱이 뜨고 창이 녹음 목록을 그린다 | 기동 대기 제거 시 흰 화면으로 실패 |
| e2e (macOS) | `pickFolder` IPC가 고른 경로를 돌려준다 | preload 노출 제거 시 실패 |
| e2e (macOS) | 앱을 닫으면 서버 자식이 남지 않는다 | 정리 제거 시 실패 |
| 수동 (Windows) | 가져오기 → 변환 → 재생 → 내려받기 | — |

e2e는 Playwright의 Electron 지원(`_electron`)으로 macOS에서 돌린다. 기존 `test:e2e`(vite preview 4173)는 건드리지 않고, 별도 설정 파일로 분리한다(13절).

e2e는 앱을 띄울 때 `DATA_DIR`/`MEDIA_DIR`을 임시 디렉터리로 넘긴다 — 개발자의 실제 라이브러리를 건드리지 않기 위해서이고, 동시에 9절의 "환경변수가 셸의 기본값을 이긴다"를 실제로 검증하는 경로이기도 하다.

**Windows 전용 부분(동봉 바이너리 경로, `taskkill`, exe 기동)은 macOS에서 검증할 수 없다.** 사용자가 실제 머신에서 확인하고, 실패하면 로그를 받아 고친다.

## 13. 빌드

셸의 코드는 두 군데로 나뉜다.

| 위치 | 무엇 | 왜 거기인가 |
|---|---|---|
| `src/lib/desktop/*.ts` | 순수 함수 — 포트 고르기, env 조립, 종료 명령 | 기존 vitest `server` 프로젝트가 `src/**/*.test.ts`를 이미 줍는다. 테스트 설정을 새로 만들지 않아도 셸 로직이 단위 테스트를 받는다 |
| `electron/*.ts` | Electron API를 실제로 부르는 얇은 층 | 단위 테스트가 불가능한 부분만 남긴다 |

둘 다 `tsconfig.electron.json`으로 컴파일해 `dist-electron/`에 낸다 (`module: commonjs`, `rootDir: "."`). `package.json`의 `main`은 `dist-electron/electron/main.js`를 가리킨다.

**`"type": "module"` 문제와 그 해법:** 이 저장소의 `package.json`에는 `"type": "module"`이 있어서, 그냥 두면 Node가 `dist-electron/**/*.js`를 ESM으로 읽고 CommonJS 출력과 충돌한다. 빌드 마지막에 `dist-electron/package.json`에 `{"type":"commonjs"}` 한 줄을 써 넣어 그 디렉터리만 CommonJS로 되돌린다. 가장 가까운 `package.json`이 이긴다는 Node의 규칙을 그대로 쓰는 것이다. VOCAL_CRM에는 `"type": "module"`이 없어 이 문제가 없었다.

출력이 CommonJS인 것은 sandbox preload의 요구사항이기도 하다 — 샌드박스 preload는 ESM을 지원하지 않는다.

렌더러가 SvelteKit 서버이므로 electron-vite의 렌더러 파이프라인은 할 일이 없다. 200줄짜리 셸 하나를 위해 새 번들러를 들이지 않고, 이미 있는 typescript를 쓴다.

**e2e는 별도 Playwright 설정 파일(`playwright.electron.config.ts`)을 쓴다.** 기존 `playwright.config.ts`의 `webServer`는 설정 최상위 항목이라 프로젝트별로 끌 수 없다 — 같은 설정에 Electron 스펙을 얹으면 쓰지도 않을 preview 서버(4173)를 매번 띄운다. Electron 앱은 자기 서버를 데리고 오므로 그 서버가 필요 없다.

```
npm run dist:win
  = vite build              (SvelteKit → build/)
  + tsc -p tsconfig.electron.json   (셸 → dist-electron/)
  + electron-builder --win --publish never
```

`electron-builder.yml`은 VOCAL_CRM의 것을 따른다 — win `portable` + `zip`, 같은 `artifactName` 규칙, better-sqlite3는 `win32-x64.node` prebuild만 남기고 `npmRebuild: false` + `asarUnpack`.

`files`에는 `dist-electron/**`와 `package.json`이 들어간다. `extraResources`에는 `build/`와 `ffmpeg/win/` — 둘 다 asar 밖이라야 한다(`build/`는 3절의 ESM 이유로, 바이너리는 실행 가능해야 하므로).

**better-sqlite3는 Windows에서 쓸 일이 없어도 동봉한다.** Apple의 `CloudRecordings.db`를 읽는 용도뿐이지만, 그 모듈을 import하는 경로가 서버에 살아 있으므로 빼면 로드가 실패한다.

크로스 빌드는 확인됐다 — VOCAL_CRM의 `release/*.exe`가 wine 없이 이 맥에서 만들어져 있다.

## 14. 이 문서가 다루지 않는 것

- **자동 업데이트**와 **코드 서명** — 개인용 도구이고 배포 채널이 없다
- **macOS 앱 빌드** — 같은 셸로 가능하지만 mac용 ffmpeg를 또 동봉해야 한다. 필요해지면 그때
- **트레이 아이콘·시작 시 자동 실행** — 요청에 없다
- **데이터 폴더 설정 화면** — 환경변수로 충분하다(9절)
- **`scripts/sync-voice-memos.sh`의 Windows 대응** — rsync와 Apple 경로를 전제한 스크립트다. 데스크톱에서는 폴더 선택(10절)이 그 자리를 대신한다
- **최다 재생 카드·파일 상세정보·음원 편집** — 각각 별도 스펙
