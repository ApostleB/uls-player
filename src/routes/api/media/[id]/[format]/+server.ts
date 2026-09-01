import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getById } from '$lib/server/store/recordings';

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

  const ext = params.format === 'original' ? (entry.ext ?? 'bin') : params.format;
  const file = path.join(config.mediaDir, params.format, `${rec.id}.${ext}`);

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
  const start = m && m[1] ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
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
