import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, JobItem, JobStatus, JobsFile } from '$lib/types';
import { loadConfig } from './config';
import {
  saveUploads,
  UploadTooLarge,
  safeDest,
  isUploadStaging,
  scheduleStagingCleanup,
  sweepStaleStaging
} from './upload';
import { scanFolder } from './scan';
import { JobQueue } from './jobs/queue';
import { jobsFilePath } from './jobs/persist';
import { updateJson } from './store/atomic';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');

let dir: string;
let cfg: AppConfig;

// saveUploads가 실제로 쓰는 임시 폴더는 cfg.dataDir 아래가 아니라
// os.tmpdir() 바로 아래다(upload.ts의 주석 참고) — 그래서 dir(=cfg.dataDir의
// 부모)을 지우는 것만으로는 saveUploads가 반환한 폴더가 함께 지워지지
// 않는다. 여기서 명시적으로 추적해서 지우지 않으면 테스트를 돌릴 때마다
// 개발자의 실제 OS 임시 디렉터리에 uls-upload-* 폴더가 하나씩 영원히
// 쌓인다 — 실제로 이 테스트 초안을 쓰는 동안 정리 없이 여러 번 돌려서
// 60개 넘게 쌓인 걸 발견하고 고쳤다.
const created: string[] = [];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-upload-test-'));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data'), MEDIA_DIR: path.join(dir, 'media') });
  created.length = 0;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await Promise.all(created.map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function fileFrom(p: string, name: string): Promise<File> {
  return new File([await fs.readFile(p)], name);
}

/** saveUploads를 호출하고 성공하면 반환된 폴더를 정리 대상으로 추적한다. */
async function save(cfgArg: AppConfig, files: File[]): Promise<string> {
  const out = await saveUploads(cfgArg, files);
  created.push(out);
  return out;
}

describe('saveUploads', () => {
  it('오디오 파일을 임시 폴더에 쓴다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    expect(await fs.readdir(out)).toEqual(['a.qta']);
  });

  it('CloudRecordings.db도 함께 받는다', async () => {
    const db = new File([Buffer.from('x')], 'CloudRecordings.db');
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta'), db]);
    expect((await fs.readdir(out)).sort()).toEqual(['CloudRecordings.db', 'a.qta']);
  });

  it('오디오도 DB도 아닌 파일은 버린다', async () => {
    const junk = new File([Buffer.from('x')], 'notes.txt');
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta'), junk]);
    expect(await fs.readdir(out)).toEqual(['a.qta']);
  });

  it('경로 구분자가 든 이름은 파일명만 남긴다 (그리고 실제로 상위 폴더로 새지 않는다)', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, '../../evil.qta')]);
    expect(await fs.readdir(out)).toEqual(['evil.qta']);
    // path.basename만 믿지 않는다 — 취약했다면 evil.qta가 out이 아니라
    // out의 조부모 디렉터리에 만들어졌을 것이다. 그 자리에 아무것도
    // 없어야 실제로 탈출하지 않았다는 증거가 된다.
    const escaped = path.join(out, '..', '..', 'evil.qta');
    await expect(fs.access(escaped)).rejects.toThrow();
  });

  it('절대 경로로 온 이름도 파일명만 남긴다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, '/etc/evil.qta')]);
    expect(await fs.readdir(out)).toEqual(['evil.qta']);
    await expect(fs.access('/etc/evil.qta')).rejects.toThrow();
  });

  it('점만 있는 이름(.. 등)은 확장자가 없어 버려진다', async () => {
    // ".."의 path.basename은 ".."고 extname은 ''다 — 우리가 아는 오디오
    // 확장자도 DB 파일명도 아니므로 다른 정크 파일과 똑같이 걸러진다.
    // 여기서 걸러지지 않으면 path.join(dir, '..')가 dir의 부모를
    // 가리키게 되므로, 이 필터가 두 번째 방어선(safeDest) 앞의 첫
    // 방어선이다.
    const dots = new File([Buffer.from('x')], '..');
    const singleDot = new File([Buffer.from('x')], '.');
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta'), dots, singleDot]);
    expect(await fs.readdir(out)).toEqual(['a.qta']);
  });

  it('sanitise 후 이름이 겹치는 두 파일을 둘 다 보존한다', async () => {
    // 서로 다른 폴더에 있던 동명 파일 두 개를 함께 올리는 상황을
    // 흉내낸다. path.basename을 거치면 둘 다 "evil.qta"가 된다.
    const a = new File([Buffer.from('AAAA')], 'sub1/evil.qta');
    const b = new File([Buffer.from('BBBB')], 'sub2/evil.qta');
    const out = await save(cfg, [a, b]);
    const names = (await fs.readdir(out)).sort();
    expect(names).toHaveLength(2);
    expect(names).toContain('evil.qta');
    const contents = await Promise.all(
      names.map((n) => fs.readFile(path.join(out, n), 'utf8'))
    );
    // 겹쳤다고 뒤의 파일이 앞의 파일을 덮어써 하나가 사라지면 안 된다 —
    // 두 내용이 모두 살아 있어야 한다.
    expect(contents.sort()).toEqual(['AAAA', 'BBBB']);
  });

  it('크기가 0인 파일도 그대로 받는다', async () => {
    const empty = new File([], 'empty.qta');
    const out = await save(cfg, [empty]);
    expect(await fs.readdir(out)).toEqual(['empty.qta']);
    expect((await fs.stat(path.join(out, 'empty.qta'))).size).toBe(0);
  });

  it('MAX_UPLOAD_MB를 넘으면 던진다', async () => {
    const small = loadConfig({ DATA_DIR: path.join(dir, 'd'), MAX_UPLOAD_MB: '0.001' });
    await expect(saveUploads(small, [await fileFrom(SPATIAL, 'a.qta')])).rejects.toThrow(
      UploadTooLarge
    );
  });

  it('받을 게 없으면 던진다', async () => {
    await expect(saveUploads(cfg, [])).rejects.toThrow(/오디오/);
  });
});

describe('safeDest', () => {
  // safeDest는 호출자가 이미 basename을 거쳤다는 걸 전제하지 않는 순수
  // 함수로 검증한다 — "basename을 거치면 도달 불가능하다"는 주장은 이
  // 코드가 항상 POSIX에서만 돈다고 가정할 때만 성립하고(path.basename은
  // 실행 OS에 따라 POSIX/win32 규칙이 바뀐다), 그 가정이 배포 환경이
  // 바뀌는 순간 깨지기 쉽다. saveUploads를 거치지 않고 이 함수를 직접
  // 호출해서, 호출자가 무엇을 넘기든 자기 방어가 성립함을 보인다.
  it('구분자를 포함한 이름은 던진다', () => {
    expect(() => safeDest(dir, '../x.qta')).toThrow();
  });

  it('".."만 있는 이름도 던진다', () => {
    expect(() => safeDest(dir, '..')).toThrow();
  });

  it('구분자가 없는 평범한 이름은 dir 아래 경로를 그대로 돌려준다', () => {
    expect(safeDest(dir, 'a.qta')).toBe(path.join(dir, 'a.qta'));
  });
});

describe('isUploadStaging', () => {
  it('saveUploads가 만든 폴더는 true다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    expect(isUploadStaging(out)).toBe(true);
  });

  it('사용자가 직접 가리킨 실제 폴더는 false다 — enqueue가 실수로 지우면 안 된다', () => {
    // dir 자체는 이 테스트 파일의 mkdtemp 접두사('uls-upload-test-')가
    // 우연히 STAGING_PREFIX('uls-upload-')로 시작해 이 검사엔 부적합하다
    // (그건 saveUploads가 만든 폴더가 아니라 이 테스트의 격리용 샌드박스일
    // 뿐이다) — 아예 다른 접두사의 실제 사용자 폴더를 흉내낸 경로로 검사한다.
    expect(isUploadStaging(path.join(os.tmpdir(), 'not-an-upload-folder'))).toBe(false);
    expect(isUploadStaging('/Volumes/Storage/voice')).toBe(false);
  });
});

/** fs.rm이 fire-and-forget이라(scheduleStagingCleanup 참고) idle() 직후에는
 * 아직 디스크에서 안 지워졌을 수 있다 — 실제로 없어질 때까지 짧게 반복
 * 확인한다. 순수 microtask가 아니라 실제 파일시스템 I/O를 기다리는 것이므로
 * setImmediate 한 번으로는 부족하다. */
async function waitUntilGone(p: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      await fs.access(p);
    } catch {
      return;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`${p}가 ${timeoutMs}ms 안에 지워지지 않았다`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function job(id: string, sourcePath: string): JobItem {
  return {
    id,
    recordingId: `rec-${id}`,
    sourcePath,
    title: id,
    status: 'pending',
    formats: { mp3: 'pending' },
    error: null
  };
}

describe('scheduleStagingCleanup', () => {
  it('배치의 잡이 전부 done이 되면 스테이징 폴더를 지운다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    const q = new JobQueue(1, async () => ({ mp3: 'done' as JobStatus }));
    scheduleStagingCleanup(q, out, ['j1']);
    q.enqueue([job('j1', path.join(out, 'a.qta'))]);
    await q.idle();
    await waitUntilGone(out);
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('실패한 잡이 있으면 지우지 않는다 — 재시도가 sourcePath를 다시 읽을 수 있다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    const q = new JobQueue(1, async () => {
      throw new Error('boom');
    });
    scheduleStagingCleanup(q, out, ['j1']);
    q.enqueue([job('j1', path.join(out, 'a.qta'))]);
    await q.idle();
    // rm 자체가 아예 호출되지 않는 경로라 레이스가 없다 — 바로 확인해도 된다.
    await expect(fs.access(out)).resolves.toBeUndefined();
  });

  it('실패했던 잡이 재시도로 done이 되면 그제서야 지운다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    let attempt = 0;
    const q = new JobQueue(1, async () => {
      attempt++;
      if (attempt === 1) throw new Error('boom');
      return { mp3: 'done' as JobStatus };
    });
    scheduleStagingCleanup(q, out, ['j1']);
    q.enqueue([job('j1', path.join(out, 'a.qta'))]);
    await q.idle();
    await expect(fs.access(out)).resolves.toBeUndefined();

    q.retryFailed();
    await q.idle();
    await waitUntilGone(out);
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('업로드 스테이징 폴더가 아니면 구독조차 하지 않는다', () => {
    const q = new JobQueue(1, async () => ({ mp3: 'done' as JobStatus }));
    const subscribeSpy = vi.spyOn(q, 'subscribe');
    scheduleStagingCleanup(q, '/Volumes/Storage/voice', ['j1']);
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  // Finding 1(치명): 이전 버전은 "이번에 넘긴 잡이 전부 done"이면
  // fs.rm(folder, {recursive:true})로 폴더 전체를 지웠다. 한 번 업로드로
  // 여러 파일을 같은 folder에 쓴 뒤 사용자가 일부만 먼저 선택해 저장하는
  // 것은 실제로 지원되는 흐름이다(+page.svelte, enhance의
  // update({reset:false})가 정확히 이걸 위해 있다) — 그 상태에서 폴더
  // 전체가 지워지면 아직 저장 안 한 나머지 파일까지 함께 사라져서, 두
  // 번째 enqueue가 재스캔할 대상 자체가 없어진다. 세 파일을 스테이징하고
  // 그중 하나만 골라 enqueue한 뒤, 나머지 둘과 폴더 자체가 살아있는지,
  // 그리고 그 폴더가 여전히 재스캔 가능한 상태인지(=두 번째 enqueue가
  // 기댈 수 있는 것)를 함께 확인한다.
  it('일부 파일만 선택해 저장해도 나머지 파일과 폴더는 살아남는다(부분 배치)', async () => {
    const out = await save(cfg, [
      await fileFrom(SPATIAL, 'a.qta'),
      await fileFrom(SPATIAL, 'b.qta'),
      await fileFrom(SPATIAL, 'c.qta')
    ]);
    const q = new JobQueue(1, async () => ({ mp3: 'done' as JobStatus }));
    // 사용자가 세 개 중 a.qta 하나만 먼저 골라 저장한 상황을 흉내낸다.
    scheduleStagingCleanup(q, out, ['j1']);
    q.enqueue([job('j1', path.join(out, 'a.qta'))]);
    await q.idle();

    // a.qta의 파일만 지워지고, 아직 저장하지 않은 b.qta·c.qta는
    // 그대로 남아 있어야 한다.
    await waitUntilGone(path.join(out, 'a.qta'));
    const remaining = (await fs.readdir(out)).sort();
    expect(remaining).toEqual(['b.qta', 'c.qta']);

    // enqueue 액션은 내부적으로 scanFolder(cfg, folder)를 다시 불러
    // sourceName으로 맞춰 붙인다(routes/import/+page.server.ts) — 그게
    // 여전히 성공하고 남은 두 파일을 정확히 찾아내는지가 "두 번째
    // enqueue가 실제로 성공한다"의 실질적인 의미다.
    const rescanned = await scanFolder(cfg, out);
    expect(rescanned.map((i) => i.sourceName).sort()).toEqual(['b.qta', 'c.qta']);
  });

  it('마지막 파일까지 지워지면 그제서야 폴더도 지운다', async () => {
    const out = await save(cfg, [
      await fileFrom(SPATIAL, 'a.qta'),
      await fileFrom(SPATIAL, 'b.qta')
    ]);
    const q = new JobQueue(1, async () => ({ mp3: 'done' as JobStatus }));
    scheduleStagingCleanup(q, out, ['j1']);
    q.enqueue([job('j1', path.join(out, 'a.qta'))]);
    await q.idle();
    await waitUntilGone(path.join(out, 'a.qta'));
    // 아직 b.qta가 남아 있으니 폴더 자체는 살아있어야 한다.
    await expect(fs.access(out)).resolves.toBeUndefined();

    scheduleStagingCleanup(q, out, ['j2']);
    q.enqueue([job('j2', path.join(out, 'b.qta'))]);
    await q.idle();
    // 이제 폴더 안이 완전히 비었으니 폴더 자체도 지워져야 한다.
    await waitUntilGone(out);
    await expect(fs.access(out)).rejects.toThrow();
  });
});

describe('sweepStaleStaging', () => {
  async function writeJobsFile(items: JobItem[]): Promise<void> {
    await updateJson<JobsFile>(jobsFilePath(cfg), () => ({ version: 1, items }), {
      version: 1,
      items: []
    });
  }

  it('오래됐고 jobs.json에 걸리는 게 없으면 지운다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25시간 전 — STALE_STAGING_MS(24시간)보다 오래됨
    await fs.utimes(out, old, old);

    await sweepStaleStaging(cfg); // jobs.json이 비어 있으니 보호 대상 없음
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('충분히 최근이면 jobs.json에 걸리는 게 없어도 지우지 않는다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    // 방금 만들어서 STALE_STAGING_MS보다 훨씬 최근이다 — mtime을 건드리지 않는다.
    await sweepStaleStaging(cfg);
    await expect(fs.access(out)).resolves.toBeUndefined();
  });

  it('오래됐어도 done이 아닌 잡이 가리키면 지우지 않는다 — 재시작 사이의 진행 중 작업 보호', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(out, old, old);

    await writeJobsFile([job('j1', path.join(out, 'a.qta'))]); // status: 'pending'

    await sweepStaleStaging(cfg);
    await expect(fs.access(out)).resolves.toBeUndefined();
  });

  it('오래됐어도 failed 잡이 가리키면 지우지 않는다 — 재시도가 sourcePath를 다시 읽을 수 있다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(out, old, old);

    await writeJobsFile([{ ...job('j1', path.join(out, 'a.qta')), status: 'failed', error: 'boom' }]);

    await sweepStaleStaging(cfg);
    await expect(fs.access(out)).resolves.toBeUndefined();
  });

  it('오래됐고 done인 잡만 가리키면(정리를 놓친 상태) 지운다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(out, old, old);

    await writeJobsFile([{ ...job('j1', path.join(out, 'a.qta')), status: 'done' }]);

    await sweepStaleStaging(cfg);
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('업로드 스테이징 폴더가 아닌 것(사용자가 직접 지정한 실제 폴더)은 os.tmpdir() 스캔 대상이 아니므로 안 건드린다', async () => {
    // isUploadStaging 접두사 규칙을 벗어나는 이름이라 스윕이 애초에 안
    // 건드린다 — 회귀를 감시하려고 os.tmpdir() 바로 아래 만들어 확인한다.
    const untouchable = await fs.mkdtemp(path.join(os.tmpdir(), 'not-uls-upload-'));
    created.push(untouchable);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(untouchable, old, old);

    await sweepStaleStaging(cfg);
    await expect(fs.access(untouchable)).resolves.toBeUndefined();
  });
});
