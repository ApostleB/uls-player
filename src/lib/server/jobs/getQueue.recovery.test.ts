import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, ScanItem } from '$lib/types';
import { loadConfig } from '../config';
import { scanFolder } from '../scan';
import { buildJobs, getQueue } from './runner';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');
const QTA_NAME = '20260711 181530-1923A106.qta';

let dir: string;
let src: string;
let cfg: AppConfig;
let scan: ScanItem[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-getqueue-recovery-'));
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

/**
 * 코드 리뷰 Finding 2(CRITICAL): getQueue의 `loadUnfinished(cfg).then(...)`에
 * onRejected가 없었다. jobs.json이 손상돼 있으면(JSON 파싱 실패 등 ENOENT가
 * 아닌 사유) readJson이 그대로 던지고 loadUnfinished도 그대로 던진다 —
 * updateJson과 달리 readJson엔 atomic.ts의 chains 같은, 반환된 프로미스를
 * 내부적으로 흡수하는 장치가 없다(직접 검증: 같은 모양의 최소 재현으로
 * 실제 프로세스가 코드 1로 죽는 것을 확인했다 — 아래 "관련 조사 노트"
 * 참고). 그 상태로 처리되지 않은 거부가 되면, 재시작 뒤 이 지연 프로미스가
 * 해소되는 시점(사실상 첫 요청 직후)에 프로세스가 죽는다.
 *
 * getQueue는 프로세스당 싱글턴이라(모듈 최상단 let queue) 다른 테스트와
 * 섞이면 안 된다 — vitest는 기본적으로 테스트 파일마다 모듈 레지스트리를
 * 새로 만들어주므로(이 프로젝트는 isolate를 끄지 않았다), 이 파일을 따로
 * 두는 것만으로 다른 파일의 getQueue 싱글턴과 격리된다. runner.test.ts와
 * 같은 파일에 두고 vi.resetModules()로 흉내내는 방법도 있었지만, 그
 * 파일은 여러 vi.mock 팩토리와 파일 전역 mockReset 규약에 이미 얽혀 있어
 * 거기 손대면 다른 15개 테스트의 안정성을 해칠 위험이 있었다.
 */
describe('getQueue — jobs.json 복구 실패 내성', () => {
  it('jobs.json이 손상돼 있어도 처리되지 않은 거부 없이 빈 채로 시작하고, 새 작업은 정상적으로 받는다', async () => {
    await fs.mkdir(cfg.dataDir, { recursive: true });
    await fs.writeFile(path.join(cfg.dataDir, 'jobs.json'), '{이건 JSON이 아니다');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const q = getQueue(cfg);

      // loadUnfinished의 실패 처리는 getQueue 안에서 .then()으로 비동기
      // 예약된다 — 마이크로태스크·다음 틱이 돌 시간을 준다.
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);

      // 복구 실패를 조용히 완전히 무시하진 않는다 — 어느 파일이 문제인지
      // 콘솔에 남아야 한다.
      expect(consoleSpy).toHaveBeenCalled();
      expect(String(consoleSpy.mock.calls[0][0])).toContain('jobs.json');

      // 복구는 실패했지만 큐 자체는 여전히 새 작업을 정상적으로 받을 수
      // 있어야 한다 — "복구를 포기했을 뿐 서버는 계속 쓸 수 있다"는 게
      // 이 수정의 핵심이다.
      const { jobs } = buildJobs(cfg, [
        { scan: scan[0], title: '복구 실패 후 새 작업', description: '', tags: [] }
      ]);
      q.enqueue(jobs);
      await q.idle();
      expect(q.snapshot().find((j) => j.id === jobs[0].id)?.status).toBe('done');
    } finally {
      process.off('unhandledRejection', onUnhandled);
      consoleSpy.mockRestore();
    }
  });
});
