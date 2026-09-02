import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppConfig, JobItem } from '$lib/types';
import { AUDIO_EXTENSIONS } from './scan';
import type { JobQueue } from './jobs/queue';

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

/** folder별로 "아직 done을 못 본 잡 id" 집합을 들고 있다가 비면 폴더를 지운다. */
const watching = new Map<string, Set<string>>();

/**
 * folder의 잡들이 전부 끝나면(성공한 것만) 스테이징 폴더를 지운다.
 *
 * 왜 "전부 done"까지 기다려야 안전한가 — runner.ts의 originalIntact 가드를
 * 보면, 원본 복사(fs.copyFile(job.sourcePath, originalPath))는 잡마다 딱
 * 한 번만 일어난다: 성공하면 originalPath가 생기고, 그 뒤로는 재시도해도
 * sourcePath를 다시 안 읽는다. 그러니 "이 folder를 가리키는 sourcePath를
 * 쓰는 잡이 전부 done"이면, 그 순간부터는 누구도 다시 sourcePath를 읽지
 * 않는다는 뜻이라 폴더를 지워도 안전하다.
 *
 * failed는 일부러 "끝났다"로 세지 않는다 — 실패 원인이 복사 자체였을 수도
 * 있고(그러면 원본이 아직 originalPath에 없어 재시도가 sourcePath를 다시
 * 읽는다), 복사는 끝났는데 그 뒤 변환 단계에서 실패했을 수도 있다(그러면
 * 이미 원본은 안전하게 복사돼 있다). 두 경우를 JobItem.status/formats만
 * 보고 안전하게 구분할 근거가 마땅치 않아서, 실패한 잡이 하나라도 남아
 * 있으면 그냥 지우지 않는다 — 사용자가 재시도를 눌러 그 잡도 done이 될
 * 때까지 폴더가 남아 있는 것뿐이다(디스크를 좀 더 오래 차지하는 대가로
 * "재시도했더니 원본이 사라져 있었다"는 사고를 원천적으로 피한다).
 *
 * 같은 folder로 enqueue를 여러 번 부를 수 있다(스캔 한 번 → 다른 행 선택해
 * 또 저장). 그래서 folder마다 "아직 못 본 done" 집합을 전역에서 계속
 * 합쳐 나간다 — 나중 enqueue가 추가한 잡 id도 같은 집합에 들어가므로,
 * 먼저 끝난 배치가 있다고 성급하게 지우는 일이 없다.
 *
 * 구독은 folder의 남은 잡이 전부 done이 되어 폴더를 지울 때만 해지한다.
 * 실패한 잡이 영원히 재시도되지 않으면 이 구독(과 folder 하나 분량의 잡
 * id 집합)이 프로세스 수명 동안 계속 남는다 — 로컬 1인용 도구에서 가져오기
 * 배치 수는 크지 않으니 감수할 만한 트레이드오프로 본다.
 */
export function scheduleStagingCleanup(queue: JobQueue, folder: string, jobIds: string[]): void {
  if (!isUploadStaging(folder) || jobIds.length === 0) return;

  const pending = watching.get(folder) ?? new Set<string>();
  for (const id of jobIds) pending.add(id);
  watching.set(folder, pending);

  const unsubscribe = queue.subscribe((items: JobItem[]) => {
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of Array.from(pending)) {
      if (byId.get(id)?.status === 'done') pending.delete(id);
    }
    if (pending.size === 0) {
      unsubscribe();
      watching.delete(folder);
      void fs.rm(folder, { recursive: true, force: true }).catch((err) => {
        console.error(`업로드 임시 폴더 정리 실패: ${folder}`, err);
      });
    }
  });
}
