# ULS Player

애플 음성 메모(Voice Memos)로 녹음한 파일을 정리·재생하기 위한 로컬 1인용 웹 앱이다. 데이터베이스 없이 JSON 파일(`data/`)과 변환된 미디어(`media/`)만으로 동작한다.

- 폴더 경로를 스캔하거나 브라우저로 직접 파일을 업로드해서 가져온다
- `CloudRecordings.db`를 함께 올리면 애플이 자동 생성한 이름이 아니라 사용자가 직접 지었던 제목·녹음 시각을 복원한다
- 지정한 포맷(mp3, wav 등)으로 백그라운드 큐에서 일괄 변환하고, 원본도 함께 보관한다
- 제목 검색, 태그 AND/OR, 날짜 범위로 목록을 걸러낸다
- 파형이 있는 재생기로 들으며 구간에 북마크를 남긴다

설계 배경과 데이터 모델, 변환 파이프라인, 에러 처리 정책 같은 자세한 내용은 [`docs/superpowers/specs/2026-08-31-uls-player-design.md`](docs/superpowers/specs/2026-08-31-uls-player-design.md)를 참고한다.

## 요구 사항

- Node.js (package.json의 의존성 버전 기준 20 이상 권장)
- **ffmpeg / ffprobe** — 시스템에 설치돼 PATH에서 실행 가능해야 한다. 오디오 스트림 분석(`ffprobe`)과 포맷 변환·파형 생성(`ffmpeg`)에 직접 사용한다. macOS라면 `brew install ffmpeg`로 설치할 수 있다.

## 설치와 실행

```sh
npm install
cp .env.example .env   # 필요하면 아래 설정값을 조정
npm run dev             # http://localhost:5173, 파일 변경 시 자동 반영
```

프로덕션으로 띄우려면:

```sh
npm run build
npm run preview          # 또는 별도 Node 서버로 build 산출물을 서빙
```

`npm run check`로 svelte-check(타입 오류) 검사를 돌릴 수 있다.

## 환경 변수

`.env.example`을 복사해 `.env`로 쓴다(로컬 개발 기준. 배포 방식에 따라 실제 프로세스 환경 변수로 주입해도 된다). 아래는 그중에서도 자주 조정하게 되는 값이다 — 전체 목록은 `.env.example`과 `src/lib/server/config.ts`를 참고한다.

| 변수 | 기본값 | 의미 |
|---|---|---|
| `OUTPUT_FORMATS` | `mp3,wav` | 쉼표로 구분한 출력 포맷 목록. 여기 없는 포맷은 만들지 않는다. 현재 지원 포맷은 `mp3`, `wav`이고, 포맷별로 `<FORMAT>_CODEC` / `<FORMAT>_BITRATE` / `<FORMAT>_SAMPLE_RATE` / `<FORMAT>_CHANNELS`로 세부값을 덮어쓸 수 있다 |
| `CONVERT_CONCURRENCY` | `4` | 백그라운드 변환 큐의 동시 실행 개수. 로컬 머신의 코어 수에 맞춰 조정한다 |
| `WAVEFORM_PEAKS` | `2000` | 재생기 파형 하나당 생성하는 피크(진폭 샘플) 개수 — 값이 클수록 파형이 촘촘해지지만 생성·저장 비용이 늘어난다 |
| `MAX_UPLOAD_MB` | `500` | 브라우저 업로드 시 파일 **하나당** 최대 크기(MB) |
| `MAX_UPLOAD_TOTAL_MB` | `4096` | 업로드 요청 **전체 합**의 최대 크기(MB). 여러 파일을 한 번에 올릴 때(예: 애플 음성 메모 라이브러리 전체를 한 번에 마이그레이션) 이 한도로 서버 메모리를 보호한다 |

이 밖에 `DATA_DIR`(기본 `./data`)·`MEDIA_DIR`(기본 `./media`)로 JSON 저장소와 변환 결과물의 위치를 바꿀 수 있다.

## 키보드 단축키

재생기에 포커스가 있고(입력 필드에 포커스가 없을 때) 사용할 수 있다.

| 키 | 동작 |
|---|---|
| `Space` | 재생 / 일시정지 |
| `←` / `→` | 5초 뒤로 / 앞으로 |
| `Shift + ←` / `Shift + →` | 10초 뒤로 / 앞으로 |
| `↑` / `↓` | 볼륨 올리기 / 내리기 |
| `M` | 음소거 전환 |
| `B` | 현재 위치에 북마크 추가 |

입력 필드(검색창 등)에 포커스가 있을 때는 이 단축키들이 무시되고 평범한 타이핑으로 처리된다.

## 테스트

```sh
npx vitest run          # 단위·통합 테스트(Vitest) — 서버 로직과 컴포넌트를 함께 돈다
npx playwright test     # E2E 테스트(Playwright) — 실제 빌드를 띄워 브라우저로 시나리오를 재현한다
npm test                # 위 둘을 순서대로: 단위 테스트 → E2E 테스트
```

Playwright는 `DATA_DIR`·`MEDIA_DIR`를 실행마다 새로 만드는 임시 디렉터리로 돌리므로(`playwright.config.ts`), 로컬에 쌓아둔 실제 `data/`·`media/`는 건드리지 않는다.
