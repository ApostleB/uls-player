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

**portable을 쓸 때 주의:** release/win-unpacked 실측 533MB(언어 파일을
`ko`·`en-US`만 남기기 전에는 580MB였다 — `electronLanguages` 설정으로
`locales/`가 48MB에서 1.3MB로 줄었다)를 NSIS
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

**mp3는 CBR일 때만 복사한다.** VBR mp3를 복사하면 재생기의 탐색이
부정확해진다 — 10분짜리 VBR로 실측한 결과 Electron은 최대 1.3초, Firefox는
최대 22초 어긋났다. VBR은 지금처럼 192k CBR로 다시 인코딩해 탐색 오차를
없앤다. 판정은 mp3 첫 프레임의 Xing/VBRI(VBR)·Info(CBR) 태그로 한다
(`src/lib/server/media/mp3Header.ts`).

**알려진 한계:** 64비트 float wav(`pcm_f64le`)는 코덱이 `pcm_`로 시작해
복사 대상이지만, 데스크톱 앱(Chromium)은 이 포맷을 재생하지 못해 wav 탭이
빈 화면으로 남는다. 사용자가 받아들인 결정이다 — 이런 원본은 드물고, 다른
포맷 탭(mp3)은 영향받지 않는다.

### 측정

12코어 Apple M4 Pro, 원본 24개(`scripts/bench-convert.sh`):

| 설정 | 시간 |
|---|---|
| 동시 4, 기본 (변경 전) | 11.6초 |
| 동시 11, 기본 (데스크톱 기본값) | 9.4초 |
| 동시 11, 레벨 7 | 6.9초 |

mp3 원본 하나: 다시 인코딩 1.5초 → 복사 0.004초(사실상 즉시).

이 수치는 앱이 아니라 앱의 파이프라인을 흉내 낸 ffmpeg 실행으로 잰 것이다.
Windows에서는 ffmpeg를 실행할 때마다 DLL을 불러오는 비용이 더해져 더 느릴
수 있다.

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
