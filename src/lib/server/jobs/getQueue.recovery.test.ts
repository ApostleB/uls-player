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

      // getQueue()는 손상된 jobs.json을 각자 읽는 독립된 비동기 체인을
      // 두 개 예약한다 — loadUnfinished(cfg).then(...)의 onRejected(복구
      // 실패, "jobs.json을 읽을 수 없어 이전 작업을 복구하지 못했습니다")와
      // sweepStaleStaging(cfg)의 catch(스테이징 정리 건너뜀, "잡 목록을
      // 읽을 수 없어 시작 시점 업로드 스테이징 정리를 건너뜁니다"). 둘 다
      // console.error를 부르지만 완료 순서는 보장되지 않는다 — 어느 쪽이
      // 먼저 파일을 읽고 파싱에 실패하는지는 매 실행의 스케줄링에 달려
      // 있다. 예전엔 consoleSpy.mock.calls[0][0]("첫 번째 호출")로
      // 판정했는데, 이게 바로 이 순서 비결정성에 걸려 있었다 — sweep의
      // 실패가 먼저 index 0을 차지하면 그 메시지엔 "jobs.json"이라는
      // 문자열이 없어(대신 "잡 목록"이라고 쓴다) 단언이 깨졌다. 그래서
      // "몇 번째 호출인가"가 아니라 "jobs.json을 언급하는 호출이
      // 존재하는가"를 기다린다 — 이 프로젝트의 다른 곳들이 고정 sleep을
      // 관찰 가능한 조건에 대한 폴링으로 바꾼 것과 같은 이유다.
      await vi.waitFor(() => {
        const found = consoleSpy.mock.calls.some((c) => String(c[0]).includes('jobs.json'));
        expect(found).toBe(true);
      }, { timeout: 5000 });

      // 복구 실패를 조용히 완전히 무시하진 않는다 — 어느 파일이 문제인지
      // 콘솔에 남아야 한다. index가 아니라 실제로 그 내용을 담은 호출을
      // 찾아서 검증한다 — 몇 번째로 도착했는지는 이 단언과 무관하다.
      const recoveryCall = consoleSpy.mock.calls.find((c) => String(c[0]).includes('jobs.json'));
      expect(recoveryCall).toBeDefined();
      expect(String(recoveryCall![0])).toContain('jobs.json');

      // sweepStaleStaging도 같은 손상된 jobs.json을 읽다 독립적으로
      // 실패한다 — loadUnfinished의 복구 실패를 가려서는 안 되는, 그
      // 자체로 의미 있는 동작이다(시작 시점 업로드 스테이징 정리를
      // 건너뛴다는 사실이 조용히 사라지면 안 된다). 두 체인 모두 "내
      // 할 일을 못 했다"고 각자 보고해야 정상이므로 이것도 따로
      // 기다려서 확인한다.
      await vi.waitFor(() => {
        const found = consoleSpy.mock.calls.some((c) =>
          String(c[0]).includes('잡 목록을 읽을 수 없어 시작 시점 업로드 스테이징 정리를 건너뜁니다')
        );
        expect(found).toBe(true);
      }, { timeout: 5000 });
      const sweepCall = consoleSpy.mock.calls.find((c) =>
        String(c[0]).includes('잡 목록을 읽을 수 없어 시작 시점 업로드 스테이징 정리를 건너뜁니다')
      );
      expect(sweepCall).toBeDefined();

      // 콘솔 로그가 catch/then 체인 안에서 실제로 남았다는 건 그 거부가
      // 처리됐다는 뜻이다 — 이 시점까지 처리되지 않은 거부가 없었는지는
      // 이제(타이머가 아니라 저 조건들이 실제로 성립한 뒤에) 확인해야
      // 의미가 있다.
      expect(unhandled).toEqual([]);

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
