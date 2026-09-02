import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// E2E 전용 DATA_DIR/MEDIA_DIR. 개발자가 로컬에서 쌓아둔 진짜 data/·media/를
// 절대 건드리지 않도록, 실행마다 새 임시 디렉터리를 만들어 웹서버 프로세스
// 에만 넘긴다. 이 모듈은 Playwright 프로세스가 살아있는 동안 한 번만
// 평가되므로(설정 로드 시점), 같은 실행 안의 모든 테스트 파일이 같은
// 디렉터리를 공유한다 — 그래야 "가져오기 → 목록 → 재생" 같은 여러 테스트에
// 걸친 시나리오가 서로 다른 서버 인스턴스를 보는 일이 없다.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uls-e2e-data-'));
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uls-e2e-media-'));

function cleanup() {
	for (const dir of [dataDir, mediaDir]) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// 정리 실패는 무시한다 — 어차피 OS 임시 디렉터리라 다음 재부팅에
			// 사라진다. 여기서 던지면 테스트 종료 자체를 방해한다.
		}
	}
}
process.on('exit', cleanup);

export default defineConfig({
	// 기존 컴포넌트 옆 e2e(*.e2e.ts)와 tests/e2e/ 아래 새 스펙(*.spec.ts)을
	// 둘 다 줍는다 — 하나로 좁히면 다른 쪽이 조용히 스캔에서 빠진다.
	testMatch: ['**/*.e2e.{ts,js}', 'tests/e2e/**/*.spec.{ts,js}'],
	timeout: 120_000,
	// 변환 완료를 기다리는 expect가 많다 — 기본 5초는 ffmpeg 작업 하나에도
	// 빠듯하다.
	expect: { timeout: 15_000 },
	fullyParallel: false,
	// 모든 스펙 파일이 위 dataDir/mediaDir(=하나의 웹서버 프로세스, 하나의
	// 인메모리 변환 큐)를 공유한다 — fullyParallel:false는 한 파일 "안"의
	// 테스트만 순차 실행을 보장할 뿐, 서로 다른 파일은 기본 워커 수만큼
	// 여전히 동시에 실행될 수 있다. 스펙 파일이 import-flow.spec.ts
	// 하나뿐이던 동안은 이게 드러나지 않았지만, upload-flow.spec.ts가
	// 생기면서 실제로 겪었다: 두 파일이 동시에 돌면 서로의 변환 잡이 같은
	// 큐에 섞이고 같은 recordings.json에 함께 쌓여, "목록에 정확히 N개
	// 보인다" 같은 카운트 기반 단언이 다른 파일이 방금 추가한 잡 때문에
	// 깨진다. workers를 1로 고정해 파일 간에도 항상 순차 실행되게 한다.
	workers: 1,
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		// 개발자가 이미 4173에 뭔가(수동 preview, 예전 데이터가 쌓인 서버 등)
		// 띄워 놓았을 수 있다. 그걸 재사용하면 이 스위트가 기대하는 "빈 변환
		// 큐로 시작"이 깨지고, DATA_DIR/MEDIA_DIR도 우리가 준 임시 디렉터리가
		// 아닌 그 서버의 것을 그대로 쓰게 된다. 항상 새로 띄운다.
		reuseExistingServer: false,
		timeout: 120_000,
		env: { DATA_DIR: dataDir, MEDIA_DIR: mediaDir }
	},
	use: { baseURL: 'http://localhost:4173' }
});
