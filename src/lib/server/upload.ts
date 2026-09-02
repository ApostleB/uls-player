import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '$lib/types';
import { AUDIO_EXTENSIONS } from './scan';

const DB_NAMES = new Set(['CloudRecordings.db', 'CloudRecordings.db-wal', 'CloudRecordings.db-shm']);

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
 */
function safeDest(dir: string, name: string): string {
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

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-upload-'));

  const used = new Set<string>();
  for (const { file, name } of keep) {
    const dest = safeDest(dir, dedupeName(used, name));
    await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
  }
  return dir;
}
