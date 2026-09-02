import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppConfig, JobItem } from '$lib/types';
import { AUDIO_EXTENSIONS } from './scan';
import type { JobQueue } from './jobs/queue';
import { loadAllJobs } from './jobs/persist';

const DB_NAMES = new Set(['CloudRecordings.db', 'CloudRecordings.db-wal', 'CloudRecordings.db-shm']);

/** saveUploads가 os.tmpdir() 아래 만드는 스테이징 폴더 접두사. isUploadStaging이
 * 이 값으로 "우리가 만든 폴더"인지 판별한다 — enqueue가 사용자가 직접 입력한
 * 실제 폴더를 실수로 자동 정리 대상에 넣지 않게 하는 유일한 방어선이다. */
const STAGING_PREFIX = 'uls-upload-';

export class UploadTooLarge extends Error {
  constructor(name: string, limitMb: number) {
    super(`${name}이(가) 업로드 한도 ${limitMb}MB를 넘습니다`);
    this.name = 'UploadTooLarge';
  }
}

function isAcceptedName(name: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()) || DB_NAMES.has(name);
}

/**
 * dir 아래 name으로 쓸 최종 경로를 만들고, 그 결과가 실제로 dir 밖으로
 * 나가지 않는지 다시 확인한다.
 *
 * name은 이미 path.basename을 거쳐 구분자가 빠진 상태로 들어오지만, 그것만
 * 으로 충분하다고 가정하지 않는다 — Task 12(파형 라우트)와 Task 13(enqueue)이
 * 같은 "클라이언트가 준 이름 조각을 그대로 경로로 쓴다"는 실수로 이미 두 번
 * 취약점이 됐던 자리다. path.basename 호출이 나중 리팩터에서 실수로
 * 빠지거나, 다른 필드(예: 폴더째 드래그할 때 브라우저가 주는
 * webkitRelativePath처럼 구분자를 포함한 값)를 basename 없이 넘기게 되는
 * 경우에도, 실제 쓰기 대상이 dir 밖으로 나가면 여기서 다시 막힌다.
 * store/waveforms.ts의 file()과 정확히 같은 방어 형태다.
 *
 * "basename을 거치면 구분자가 없으니 safeDest는 도달 불가능하다"는 주장은
 * 이 코드가 항상 POSIX에서만 돈다고 가정할 때만 성립한다 — path.basename은
 * 실행 중인 OS에 따라 POSIX/win32 규칙이 자동으로 바뀌는 함수라(win32는
 * '\'도 구분자로 본다), "지금 이 플랫폼에서는 호출자가 이미 다 걸러준다"는
 * 근거는 배포 환경이 바뀌는 순간 깨지기 쉽다. 그래서 이 함수는 호출자의
 * 사전 처리를 전혀 신뢰하지 않는 순수 함수로 두고, upload.test.ts에서
 * saveUploads를 거치지 않고 직접 호출해 검증한다(export하는 이유).
 */
export function safeDest(dir: string, name: string): string {
  const dest = path.join(dir, name);
  const rel = path.relative(dir, dest);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`업로드 대상 폴더를 벗어나는 파일명입니다: ${JSON.stringify(name)}`);
  }
  return dest;
}

/**
 * 이미 쓴 이름과 겹치면 뒤에 -1, -2 ...를 붙여 구분한다.
 *
 * 브라우저는 파일명만 보내지 원래 폴더 경로는 안 준다(File.name에는
 * 구분자가 없는 게 보통이지만, 있어도 path.basename으로 이미 걷어낸
 * 뒤다) — 그래서 서로 다른 폴더에 있던 동명 파일 두 개를 함께 고르면
 * basename을 거친 뒤 이름이 같아질 수 있다. 그대로 fs.writeFile을
 * 두 번 하면 뒤에 쓴 파일이 앞의 파일을 조용히 덮어써 하나가 사라진다 —
 * 사용자는 두 개를 선택했는데 결과는 하나뿐이라는 걸 알아챌 방법이 없다.
 */
function dedupeName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/**
 * 업로드받은 파일을 임시 폴더에 쓰고 그 경로를 준다.
 * 이후는 폴더 스캔과 같은 경로를 탄다 — enqueue가 이 폴더를 다시 스캔해서
 * sourceName으로 맞춰 붙인다(routes/import/+page.server.ts 참고).
 *
 * 임시 폴더는 cfg.dataDir이 아니라 os.tmpdir() 아래에 만든다. 이 프로젝트의
 * data/는 "JSON 상태 저장소"이고 store/ 아래 모듈만 그 경로에 직접
 * fs를 쓴다는 게 지금까지의 불변식이다(jobs/persist.ts도 경로 문자열만
 * 계산하고 실제 읽기·쓰기는 store/atomic.ts에 위임한다). 업로드는 JSON이
 * 아니라 임의 크기의 원본 오디오 바이트이고 store의 원자적 쓰기 계약과
 * 무관하므로 그 불변식 안에 억지로 끼워 넣기보다 밖에 둔다. 이 코드베이스에
 * 이미 같은 판단을 내린 선례가 있다 — apple/cloudRecordings.ts의
 * readTitleMap도 CloudRecordings.db 사본을 os.tmpdir() 아래에 만든다.
 * (그쪽은 함수가 끝나기 전에 지우고, 여기서는 재시도를 위해 남겨둔다는
 * 차이가 있을 뿐 "scratch 공간은 data/ 밖"이라는 결론은 같다.) 재시작하면
 * 이 폴더가 남아 있다는 보장은 없지만, Task 11의 pendingRecordings도
 * 인메모리라 재시작하면 어차피 사라진다 — 가져오기 도중 죽으면 사용자가
 * 다시 올려야 한다는 건 이미 이 프로젝트가 받아들인 트레이드오프다.
 *
 * 폴더 자체는 이 함수가 지우지 않는다 — scheduleStagingCleanup이 잡
 * 완료 시점에 맞춰 정리한다(아래).
 */
export async function saveUploads(cfg: AppConfig, files: File[]): Promise<string> {
  const limit = cfg.maxUploadMb * 1024 * 1024;

  // 브라우저가 경로 조각을 붙여 보내도(예: 폴더를 드래그하면 일부
  // 브라우저는 상대 경로가 낀 이름을 준다) 파일명만 남긴다. 그 뒤에
  // 확장자로 한 번 더 거른다 — ".."나 "."처럼 구분자가 없어도 위험한
  // 이름은 우리가 아는 오디오 확장자도, DB 파일명도 아니므로 여기서
  // 자연스럽게 떨어진다.
  const named = files.map((f) => ({ file: f, name: path.basename(f.name) }));
  const keep = named.filter(({ name }) => isAcceptedName(name));

  const audioCount = keep.filter(({ name }) => !DB_NAMES.has(name)).length;
  if (audioCount === 0) throw new Error('오디오 파일이 없습니다');

  for (const { file, name } of keep) {
    if (file.size > limit) throw new UploadTooLarge(name, cfg.maxUploadMb);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), STAGING_PREFIX));

  const used = new Set<string>();
  for (const { file, name } of keep) {
    const dest = safeDest(dir, dedupeName(used, name));
    // file.arrayBuffer()로 통째로 읽어 Buffer.from으로 다시 감싸면 파일 하나당
    // 메모리에 두 벌(File이 들고 있는 원본 바이트 + 우리가 새로 만든 Buffer
    // 사본)이 동시에 떠 있는 순간이 생긴다. 스펙의 대표 시나리오인 3.1GB
    // 초기 마이그레이션을 한 번에 올리면 그 배로 부풀 수 있다. file.stream()을
    // 파일에 그대로 파이프하면 그 복제를 없앤다 — 다만 이건 saveUploads
    // 안에서의 이중 복사만 없앨 뿐이다. request.formData()가 멀티파트 바디
    // 전체를 미리 메모리에 올려두는 것 자체는 SvelteKit(undici)의 파싱
        // 단계에서 이미 끝난 뒤라 여기서는 되돌릴 수 없다 — 그 앞단은
    // +page.server.ts의 Content-Length 사전 검사가 막는다.
    await pipeline(Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));
  }
  return dir;
}

/**
 * folder가 saveUploads가 os.tmpdir() 아래에 만든 스테이징 폴더인지 확인한다.
 * enqueue가 이 폴더를 자동으로 지워도 되는지 판단할 때 쓰는 유일한
 * 안전장치다 — 이 검사가 없으면 사용자가 "폴더 경로 입력"으로 직접
 * 가리킨 실제 폴더(예: /Volumes/Storage/voice)까지 잡이 끝났다고 지워버릴
 * 위험이 있다.
 */
export function isUploadStaging(folder: string): boolean {
  return path.dirname(folder) === os.tmpdir() && path.basename(folder).startsWith(STAGING_PREFIX);
}

/** folder별로 "아직 done을 못 본 잡 id" 집합을 들고 있다가 비면 구독을 끊는다. */
const watching = new Map<string, Set<string>>();

/**
 * folder별로 정리 작업(파일 삭제 → 폴더가 비었는지 확인)을 순서대로만
 * 실행한다. 같은 folder에서 잡 두 개가 거의 동시에 done이 되면 각자
 * cleanupJobFile을 동시에 시작하는데, 그 둘의 "폴더가 비었나" 확인이
 * 서로 겹치면 실제로는(둘 다 지운 뒤에는) 비어 있는데도 둘 다 "아직 하나
 * 남았다"고 보고 넘어가 폴더가 영영 안 지워질 수 있다. folder별로 체인을
 * 이어 붙여 한 번에 하나씩만 돌게 하면 이 경쟁이 원천적으로 없다 — 나중
 * 실행은 항상 앞선 파일 삭제가 완전히 끝난 뒤의 상태를 본다.
 */
const chains = new Map<string, Promise<void>>();

function runExclusive(folder: string, fn: () => Promise<void>): void {
  const prev = chains.get(folder) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`업로드 스테이징 정리 실패: ${folder}`, err);
    }
  });
  chains.set(folder, next);
}

/**
 * done이 된 잡 하나가 가리키던 파일만 지운다. 지운 뒤 folder를 다시
 * 읽어서 남은 파일이 없으면 folder 자체도 지운다 — 다른 파일이 남아
 * 있으면(사용자가 아직 선택 안 한 행들) 절대 건드리지 않는다.
 *
 * CloudRecordings.db(와 -wal/-shm)는 어떤 job도 sourcePath로 가리키지
 * 않는다 — saveUploads가 함께 받아주긴 하지만 제목 복원에만 쓰이고 그
 * 자체가 변환 대상은 아니기 때문이다(scan.ts는 오디오 확장자만 잡으로
 * 만든다). 그래서 폴더의 오디오 파일이 전부 지워진 뒤에도 이 DB
 * 사이드카만 남아 위 readdir이 절대 빈 배열을 돌려주지 못하고, 폴더
 * 자체가 STALE_STAGING_MS(24시간) 스윕 전까지 영원히 안 지워진다. 남은
 * 게 DB 사이드카뿐이면(=처리해야 할 오디오가 더는 없다는 뜻) 그것도
 * 함께 지운다 — 남은 것 중 하나라도 DB_NAMES에 없으면(아직 선택 안 한
 * 오디오 파일) 절대 건드리지 않는다.
 */
async function cleanupJobFile(folder: string, sourcePath: string): Promise<void> {
  await fs.rm(sourcePath, { force: true });
  let remaining = await fs.readdir(folder).catch(() => [] as string[]);
  if (remaining.length > 0 && remaining.every((name) => DB_NAMES.has(name))) {
    for (const name of remaining) {
      await fs.rm(path.join(folder, name), { force: true });
    }
    remaining = [];
  }
  if (remaining.length === 0) {
    await fs.rm(folder, { recursive: true, force: true });
  }
}

/**
 * folder 안에서 jobIds가 가리키는 잡이 done이 되는 대로, 그 잡의 파일
 * 하나만 지운다(폴더 전체가 아니다). 지운 결과 폴더가 비면 폴더도 지운다.
 *
 * 왜 폴더 단위가 아니라 파일 단위인가 — 한 번 업로드로 여러 파일을 같은
 * folder에 쓴 뒤, 사용자가 그중 일부만 선택해 먼저 저장하고(다른 행을
 * 골라 다시 저장하는 것도 지원되는 흐름이다 — +page.svelte의 enhance가
 * update({reset: false})로 rows를 남겨두는 이유가 그것이다) 나머지를
 * 나중에 또 저장할 수 있다. 이전 버전은 "이번에 넘긴 잡이 전부 done"이면
 * folder 전체를 fs.rm(recursive)로 지웠는데, 그러면 아직 저장 안 한
 * 나머지 파일까지 함께 사라진다 — 두 번째 enqueue가 재스캔할 folder
 * 자체가 없어져 "폴더를 다시 읽을 수 없습니다"로 실패하고, 업로드된
 * 원본은 복구 불가능하게 사라진다. 파일 단위로 바꾸면 이 문제가
 * 구조적으로 없다 — 아직 선택 안 한 파일은 애초에 지울 대상 목록에
 * 들어가지도 않는다.
 *
 * done이 파일을 지워도 안전한 시점인 이유는 그대로다 — runner.ts가
 * job.sourcePath를 media/original로 복사하는 건 잡 시작 시점이고, done은
 * 그 복사를 포함한 전체 변환이 끝난 뒤에만 온다. done을 본 순간
 * sourcePath는 이미 안전하게 복사됐고 다시는 읽히지 않는다
 * (originalIntact 가드, runner.ts:103-114).
 *
 * failed는 여전히 "끝났다"로 세지 않는다 — 실패 원인이 원본 복사
 * 자체였을 수도 있고(재시도가 sourcePath를 다시 읽는다), 변환 단계였을
 * 수도 있다(이미 원본은 안전하다). 두 경우를 안전하게 구분할 근거가
 * 없어서, 실패한 잡의 파일은 재시도로 done이 될 때까지 그대로 둔다.
 *
 * 같은 folder로 enqueue를 여러 번 부를 수 있어 folder별 감시 집합을
 * 전역에서 계속 합쳐 나간다. 구독은 그 folder의 남은 잡이 전부 done이
 * 되어야 해지한다 — 실패한 잡이 영원히 재시도되지 않으면 이 구독이
 * 프로세스 수명 동안 남는다는 트레이드오프는 이전과 같다.
 *
 * 프로세스가 done을 보기 전에 죽으면(재시작) 이 인메모리 구독 자체가
 * 사라진다 — 그 경우의 만회는 sweepStaleStaging(아래)이 시작 시점에
 * 대신한다.
 */
export function scheduleStagingCleanup(queue: JobQueue, folder: string, jobIds: string[]): void {
  if (!isUploadStaging(folder) || jobIds.length === 0) return;

  const pending = watching.get(folder) ?? new Set<string>();
  for (const id of jobIds) pending.add(id);
  watching.set(folder, pending);

  const unsubscribe = queue.subscribe((items: JobItem[]) => {
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of Array.from(pending)) {
      const item = byId.get(id);
      if (item?.status !== 'done') continue;
      pending.delete(id);
      runExclusive(folder, () => cleanupJobFile(folder, item.sourcePath));
    }
    if (pending.size === 0) {
      unsubscribe();
      watching.delete(folder);
      chains.delete(folder);
    }
  });
}

/**
 * 이보다 오래(마지막으로 이 폴더 안 파일이 바뀐 뒤로) 방치된 스테이징
 * 폴더는, 아직 필요한 잡이 없다면 시작 시점 정리 대상이다. 가져오기 한
 * 번(업로드 → 편집 → 저장 → 변환)이 이 시간 안에 안 끝나는 건 비정상이고,
 * 사용자가 편집 화면을 띄워 놓고 잠깐 자리를 비운 정도로는 절대 안
 * 걸리도록 훨씬 널널하게 잡았다.
 */
const STALE_STAGING_MS = 24 * 60 * 60 * 1000; // 24시간

/**
 * os.tmpdir() 아래 남은 uls-upload-* 폴더 중, 아직 진행 중인(=done이 아닌)
 * 잡이 가리키지 않고 STALE_STAGING_MS보다 오래된 것을 지운다.
 *
 * 왜 필요한가 — scheduleStagingCleanup은 인메모리 구독으로 done을
 * 기다렸다가 지우는데, 그 잡이 끝나기 전에 서버 프로세스가 죽으면(재시작
 * 포함) 그 구독 자체가 사라진다. getQueue()의 loadUnfinished가 jobs.json의
 * 미완료 잡을 다시 큐에 올리긴 하지만, 그 잡을 위한 정리 구독은 다시
 * 걸리지 않는다 — 그 잡이 이번엔 무사히 done이 돼도 이 함수가 없으면
 * 스테이징 폴더(와 이미 다 쓴 파일들)가 영원히 안 지워진다.
 *
 * "아직 진행 중인 작업이 가리키는 폴더는 절대 지우면 안 된다"를 나이
 * 기준보다 우선한다 — jobs.json에서 상태가 done이 아닌(pending·running·
 * failed) 잡들의 sourcePath가 속한 폴더는 아무리 오래됐어도 건너뛴다.
 * failed도 보호 대상이다(재시도가 sourcePath를 다시 읽을 수 있다).
 *
 * 남는 간극 하나: 아직 enqueue조차 안 한(=jobs.json에 아무 기록도 없는)
 * 업로드 직후 폴더는 이 보호 집합에 안 잡힌다. 사용자가 업로드만 해두고
 * STALE_STAGING_MS보다 오래(24시간 이상) 저장을 미루면 그 사이 서버가
 * 재시작될 경우 이 스윕이 지울 수 있다 — 로컬 1인용 도구에서 그 정도로
 * 오래 편집 화면을 열어둔 채 방치하는 경우는 드물다고 보고 받아들인
 * 잔여 위험이다. 완전히 메우려면 "편집 중" 폴더까지 무언가에 등록해야
 * 하는데, 그러면 store 밖의 이 파일이 또 다른 영속 상태를 들고 있어야
 * 해서 이번 수정 범위를 넘는다고 판단했다.
 */
export async function sweepStaleStaging(cfg: AppConfig): Promise<void> {
  let all: JobItem[];
  try {
    all = await loadAllJobs(cfg);
  } catch (err) {
    console.error('잡 목록을 읽을 수 없어 시작 시점 업로드 스테이징 정리를 건너뜁니다', err);
    return;
  }

  const protectedFolders = new Set(
    all
      .filter((j) => j.status !== 'done')
      .map((j) => path.dirname(j.sourcePath))
      .filter((d) => isUploadStaging(d))
  );

  let entries: string[];
  try {
    entries = await fs.readdir(os.tmpdir());
  } catch {
    return; // os.tmpdir() 자체를 못 읽으면 조용히 포기한다 — 시작을 막을 이유는 아니다.
  }

  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith(STAGING_PREFIX)) continue;
    const dir = path.join(os.tmpdir(), name);
    if (protectedFolders.has(dir)) continue;

    let mtimeMs: number;
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) continue;
      mtimeMs = st.mtimeMs;
    } catch {
      continue; // 그 사이 없어졌으면(다른 정리가 이미 지웠으면) 넘어간다.
    }
    if (now - mtimeMs < STALE_STAGING_MS) continue;

    await fs.rm(dir, { recursive: true, force: true }).catch((err) => {
      console.error(`오래된 업로드 스테이징 폴더 정리 실패: ${dir}`, err);
    });
  }
}
