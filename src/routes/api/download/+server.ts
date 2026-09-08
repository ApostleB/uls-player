import fsp from 'node:fs/promises';
import { ZipArchive } from 'archiver';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getById } from '$lib/server/store/recordings';
import { mediaFileExt, mediaFilePath, downloadFileName } from '$lib/media';

/**
 * 같은 제목·같은 날짜의 녹음이 둘 이상이면 zip 안에서 이름이 겹친다. zip
 * 자체는 같은 이름을 두 번 담을 수 있지만 푸는 쪽이 하나를 잃으므로,
 * 두 번째부터 ` (2)`, ` (3)`을 붙인다.
 */
function uniqueName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? '' : name.slice(dot);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * 로컬 날짜(YYYY-MM-DD)를 만든다. `Date#toISOString()`은 항상 UTC라, 이
 * 앱의 사용자가 있는 KST(UTC+9)에서는 자정부터 오전 9시 사이에 내려받으면
 * 실제로는 오늘인데 zip 파일명엔 어제 날짜가 찍힌다. 그래서 로컬
 * getFullYear/getMonth/getDate로 만든다.
 */
function localDateStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData();
  const ids = form.getAll('ids').map(String).filter(Boolean);
  const format = String(form.get('format') ?? '');
  if (!ids.length) throw error(400, '고른 녹음이 없습니다');
  if (!format) throw error(400, '포맷을 지정해야 합니다');

  // 담을 것을 먼저 확정한다 — 스트림을 열어놓고 하나도 못 담는 것보다,
  // 미리 세어보고 404를 주는 편이 정직하다.
  const taken = new Set<string>();
  const entries: { file: string; name: string }[] = [];
  for (const id of ids) {
    const rec = await getById(config, id);
    if (!rec) continue;
    const entry = rec.files[format];
    if (!entry) continue;

    const ext = mediaFileExt(format, entry);
    const file = mediaFilePath(config.mediaDir, rec.id, format, ext);
    try {
      await fsp.stat(file);
    } catch {
      continue;
    }
    entries.push({ file, name: uniqueName(taken, downloadFileName(rec.title, rec.recordedAt, ext)) });
  }

  if (!entries.length) throw error(404, '내려받을 파일이 없습니다');

  // 오디오는 이미 압축돼 있어 다시 압축해봐야 시간만 든다. 저장만 한다.
  // archiver 8은 예전의 archiver('zip', opts) 팩토리 함수 대신 이 클래스를
  // named export로 준다 — 설치된 버전(package.json 참고)의 실제 API다.
  const zip = new ZipArchive({ store: true });
  // 위의 fsp.stat 점검은 그 순간의 존재만 확인할 뿐이다. 요청이 269개
  // 파일을 훑는 동안 변환 큐가 파일을 옮기거나 지울 수 있어 TOCTOU
  // 창이 남는다. 그 파일을 archiver가 실제로 열 때 나는 에러는
  // 아래 zip.on('error')로 받는다 — 리스너가 없으면 Node가 처리되지
  // 않은 'error' 이벤트로 프로세스 전체를 죽인다(Finding 1). 이미
  // 스트리밍을 시작한 응답 하나가 어중간하게 끝나는 정도로 막는다.
  zip.on('error', (err) => {
    console.error('[api/download] zip stream error', err);
  });
  for (const e of entries) {
    // append(fs.createReadStream(...))가 아니라 file()을 쓴다. append는
    // 이미 열려 있는 스트림을 넘기므로, archiver의 내부 큐가 그 항목에
    // 도달하기 전에 그 스트림이 ENOENT 등으로 에러를 내면 아직 아무도
    // 듣고 있지 않아 프로세스가 죽는다. file()은 lazystream으로 파일
    // 열기를 미루고, 큐가 실제로 그 항목을 처리할 때 자체적으로 다시
    // stat한 뒤 에러 핸들러를 미리 붙이고 나서 연다 — 그사이 사라진
    // 파일은 'warning'만 내고 건너뛰며, 아카이브는 마저 완성된다.
    zip.file(e.file, { name: e.name });
  }
  void zip.finalize();

  const filename = `uls-player_${format}_${localDateStamp(new Date())}.zip`;

  return new Response(zip as unknown as ReadableStream, {
    headers: {
      'content-type': 'application/zip',
      // 한글 제목이 들어갈 수 있으므로 RFC 5987 형식을 함께 싣는다.
      // 앞의 filename=은 그것을 못 읽는 클라이언트용 대비책이다.
      'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
};
