import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getById } from '$lib/server/store/recordings';
import { mediaFileExt, mediaFilePath } from '$lib/media';

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  qta: 'audio/mp4',
  aac: 'audio/aac'
};

export const GET: RequestHandler = async ({ params, request }) => {
  const rec = await getById(config, params.id);
  if (!rec) throw error(404, '녹음을 찾을 수 없습니다');

  const entry = rec.files[params.format];
  if (!entry) throw error(404, `이 녹음에는 ${params.format} 파일이 없습니다`);

  const ext = mediaFileExt(params.format, entry);
  const file = mediaFilePath(config.mediaDir, rec.id, params.format, ext);

  let size: number;
  try {
    size = (await fsp.stat(file)).size;
  } catch {
    throw error(404, '파일이 디스크에 없습니다');
  }

  const type = MIME[ext] ?? 'application/octet-stream';
  const range = request.headers.get('range');

  // Range 없이 전체를 주면 브라우저가 탐색을 못 한다
  if (!range) {
    return new Response(fs.createReadStream(file) as unknown as ReadableStream, {
      headers: {
        'content-type': type,
        'content-length': String(size),
        'accept-ranges': 'bytes'
      }
    });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start: number;
  let end: number;
  if (m && m[1] === '' && m[2] !== '') {
    // 접미사 형태(bytes=-500): "끝에서부터 N바이트". m[1]이 비어 있다고
    // start를 0으로 두면(예전 버그) 파일 앞부분을 last-N인 척 돌려주게
    // 된다. 요청한 접미사 길이가 파일보다 크면 파일 전체를 준다.
    const suffixLength = Number(m[2]);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = m && m[1] ? Number(m[1]) : 0;
    end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }

  return new Response(fs.createReadStream(file, { start, end }) as unknown as ReadableStream, {
    status: 206,
    headers: {
      'content-type': type,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes'
    }
  });
};
