import fs from 'node:fs';
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
  for (const e of entries) zip.append(fs.createReadStream(e.file), { name: e.name });
  void zip.finalize();

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `uls-player_${format}_${stamp}.zip`;

  return new Response(zip as unknown as ReadableStream, {
    headers: {
      'content-type': 'application/zip',
      // 한글 제목이 들어갈 수 있으므로 RFC 5987 형식을 함께 싣는다.
      // 앞의 filename=은 그것을 못 읽는 클라이언트용 대비책이다.
      'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
};
