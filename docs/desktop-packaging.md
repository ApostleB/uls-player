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

## 동봉 ffmpeg

`ffmpeg/win/`에는 다음이 들어 있다(실행 파일 2개 + 공유 라이브러리 DLL 9개,
합계 약 182MB):

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
shared 빌드. `ffplay.exe`는 이 앱이 쓰지 않아 내려받은 뒤 제거했다.

**shared 빌드이므로 DLL 9개가 exe와 같은 폴더에 함께 있어야 실행된다.** 하나만
빠져도 Windows에서 `ffmpeg.exe`/`ffprobe.exe` 실행이 실패한다.

**주의:** BtbN 릴리스의 `latest` 태그는 새 빌드가 나올 때마다 같은 URL 위에서
덮어써진다 — 즉 URL만으로는 나중에 같은 바이너리를 재현할 수 없다. 같은
버전이 다시 필요하면 위에 적은 파일명(`ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip`,
2026-09-28 빌드)을 GitHub 릴리스 페이지의 과거 에셋 목록이나 Actions 아카이브
에서 직접 찾아야 한다. 재현성이 필요하면 이 바이너리를 별도 저장소나
아티팩트 스토리지에 보관해 두는 것을 고려한다.

## extraResources 배치

`build/`, `node_modules/better-sqlite3`, `ffmpeg/win`는 asar 안에 들어가지
못하고(네이티브 모듈·ESM 로더·실행 파일이라는 이유는 `electron-builder.yml`의
주석 참고) `resources/`(즉 `process.resourcesPath`) 아래 그대로 복사된다.

    resources/build/index.js
    resources/build/client/...
    resources/node_modules/better-sqlite3/...   (win32-x64 prebuild만)
    resources/ffmpeg/win/ffmpeg.exe, ffprobe.exe, *.dll

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
