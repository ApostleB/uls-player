# 데스크톱 패키징

## 만들기

    npm run dist:win

`release/`에 둘이 생긴다.

| 파일 | 쓰임 |
|---|---|
| `ULS-Player-<버전>-win.zip` | 풀어서 `ULS Player.exe` 실행 — **일상용 기본** |
| `ULS-Player-<버전>-portable.exe` | 설치 없이 그대로 실행 |

zip을 기본으로 앞세운 이유: 한 번 풀어 두면 그 뒤로는 exe를 바로 띄우는
것과 다르지 않으면서, portable이 매번 겪는 재추출 지연(아래)이 아예 없다.
평소에 쓸 사본이라면 zip을 풀어 두고 쓰는 편이 낫다.

**portable을 쓸 때 주의:** release/win-unpacked 실측 580MB를 NSIS
portable 템플릿이 실행할 때마다 임시 폴더에 통째로 풀었다가 종료 시
지운다. `splashImage`를 설정하지 않아 이 압축 해제 동안 화면에 정말
아무것도 뜨지 않는다(`SetSilent silent`) — 119MB짜리 `avcodec-63.dll` 백신
검사까지 겹치면 첫 창이 뜨기까지 수십 초가 걸릴 수 있다. **이 시간 동안
다시 더블클릭하지 않는다.** (electron-builder.yml의 `unpackDirName: true`
설정으로 실행마다 다른 임시 폴더를 쓰게 해 두어, 두 번 실행해도 서로의
압축 해제 폴더를 `RMDir /r`로 지워버리는 손상은 구조적으로 막혀 있다 —
다만 이 macOS 크로스 빌드 환경에서는 실제 Windows 이중 실행으로 직접
확인하지는 못했다. 그래도 무반응처럼 보이는 수십 초 자체는 여전히
남으므로, "느린데 아무것도 안 뜬다"는 것 자체를 미리 안내해 둔다.)

빌드에는 `ffmpeg/win/ffmpeg.exe`와 `ffmpeg/win/ffprobe.exe`가 있어야 한다.
저장소에 커밋하지 않으므로(100MB가 넘는다) 새 환경에서는 먼저 받아 둔다.

## 동봉 ffmpeg

`ffmpeg/win/`에는 다음이 들어 있다(실행 파일 2개 + 공유 라이브러리 DLL 7개,
총 9개 파일, 합계 약 182MB):

    ffmpeg.exe
    ffprobe.exe
    avcodec-63.dll
    avdevice-63.dll
    avfilter-12.dll
    avformat-63.dll
    avutil-61.dll
    swresample-7.dll
    swscale-10.dll

출처: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) 공식 GitHub
릴리스, `ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip` (2026-09-28 빌드), GPL
shared 빌드. 정확한 빌드 ID(바이너리에서 직접 추출, `strings -a
ffmpeg/win/avutil-61.dll | grep -oE 'n9\.[0-9]+[^ ]*'`로 확인 가능):
`n9.0.2-14-gebafaee10a-20260928`. `ffplay.exe`는 이 앱이 쓰지 않아 내려받은
뒤 제거했다.

**shared 빌드이므로 DLL 7개(실행 파일 2개와 합쳐 총 9개 파일)가 exe와 같은
폴더에 함께 있어야 실행된다.** 하나만 빠져도 Windows에서
`ffmpeg.exe`/`ffprobe.exe` 실행이 실패한다.

**주의:** BtbN 릴리스의 `latest` 태그는 새 빌드가 나올 때마다 같은 URL 위에서
덮어써진다 — 즉 URL만으로는 나중에 같은 바이너리를 재현할 수 없다. 같은
버전이 다시 필요하면 위 빌드 ID(`n9.0.2-14-gebafaee10a-20260928`)나 파일명
(`ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip`, 2026-09-28 빌드)을 GitHub
릴리스 페이지의 과거 에셋 목록이나 Actions 아카이브에서 직접 찾아야 한다.
재현성이 필요하면 이 바이너리를 별도 저장소나 아티팩트 스토리지에 보관해
두는 것을 고려한다.

## extraResources 배치

`build/`, `node_modules/better-sqlite3`, `ffmpeg/win`는 asar 안에 들어가지
못하고(네이티브 모듈·ESM 로더·실행 파일이라는 이유는 `electron-builder.yml`의
주석 참고) `resources/`(즉 `process.resourcesPath`) 아래 그대로 복사된다.
동봉 ffmpeg만 로컬 소스 폴더명(`ffmpeg/win`)과 패키지 안 배치 경로
(`ffmpeg/win32`)가 다르다 — `electron/main.ts`의 `binariesDir()`가
`process.platform`(Windows에서 `'win32'`) 기준으로 폴더를 찾기 때문이다.

    resources/build/index.js
    resources/build/client/...
    resources/node_modules/better-sqlite3/...   (win32-x64 prebuild만)
    resources/ffmpeg/win32/ffmpeg.exe, ffprobe.exe, *.dll

## 데이터가 쌓이는 곳

`%APPDATA%\uls-player\data` 와 `...\media`.

옮기려면 환경변수를 지정한다 — 셸이 넣는 것은 기본값일 뿐이라 이미 있는
값을 덮어쓰지 않는다.

    set DATA_DIR=D:\uls\data
    set MEDIA_DIR=D:\uls\media

**공백 주의:** cmd에서 `set VAR= 값`처럼 `=` 뒤에 공백을 하나라도 넣으면
그 공백이 값의 일부로 들어간다(`set DATA_DIR= D:\uls\data`는 실제로
` D:\uls\data`가 된다). `src/lib/desktop/env.ts`와 `src/lib/server/config.ts`
어느 쪽도 이 값을 trim하지 않으므로, 앞에 공백이 붙은 채로 그대로 경로가
되어 존재하지 않는 디렉터리를 가리키게 된다. `=` 바로 뒤에 값을 붙여 쓴다.

## 개발 중 실행

    npm run desktop

`app.isPackaged`가 false라 데이터가 `uls-player-dev` 폴더로 분리되고,
ffmpeg는 동봉본 대신 PATH의 것을 쓴다.

## e2e

    npm run test:e2e:electron

macOS에서 돈다. Windows 전용 부분(동봉 바이너리 경로, taskkill, exe 기동)은
여기서 검증되지 않는다 — 실제 Windows 머신에서 확인해야 한다.

## Windows 수동 검증 체크리스트

macOS e2e가 못 보는 표면(동봉 ffmpeg, win32-x64 네이티브 prebuild,
taskkill, exe 기동 자체)을 실제 Windows 머신에서 이 순서로 확인한다.
다음 버전에서 재검증할 사람도 이 목록을 그대로 따라가면 된다.

1. exe(또는 zip을 푼 `ULS Player.exe`)를 더블클릭하면 창이 뜬다.
2. 가져오기 페이지에서 찾아보기로 폴더를 고르면 스캔이 그 안의 파일을 찾는다.
3. 스캔 결과를 저장하면 변환이 돌고, 끝나면 녹음 목록에 나타난다.
4. 목록에서 골라 재생하면 소리가 난다.
5. 파일 하나를 내려받으면 `제목_날짜.확장자` 형태 파일명으로 저장된다.
6. 여러 개를 골라 일괄 내려받으면 zip 하나로 저장된다.
7. 변환이 도는 도중에 앱을 닫고, 작업 관리자에 `ffmpeg.exe`가 남아 있지
   않은지 본다(taskkill 정리가 실패하면 여기 남는다).

## 비정상 종료와 고아 서버

Electron main이 (강제 종료·크래시 등으로) 정상적인 `before-quit` 경로를
거치지 않고 죽으면, 그 서버 자식 프로세스는 정리되지 않은 채 남는다.
`app.requestSingleInstanceLock()`은 두 번째 **Electron** 인스턴스끼리만
막아 줄 뿐, 이미 떠 있는 고아 서버 프로세스는 막을 수 있는 대상이 아니다.

이 상태에서 앱을 다시 켜면, 새로 뜨는 서버가 같은 `DATA_DIR`을 가리키며
고아 서버와 동시에 `recordings.json`/`jobs.json`을 쓰게 된다 —
`ecosystem.config.cjs`가 pm2 클러스터 모드를 금지한 것과 정확히 같은
동시 기록자 손상이다. 이번 수정에서 코드로 막지는 않는다(정상 종료
경로가 아닌 죽음 자체를 감지하는 것은 별도 작업이 필요하다).

증상: 가져오기나 편집이 가끔 사라지거나 서로 덮어쓴 것처럼 보인다면,
작업 관리자에서 `ULS Player.exe`(또는 서버로 fork된 Node 프로세스)가
여러 개 떠 있는지 먼저 확인한다. 있다면 전부 종료하고 하나만 다시 켠다.
