import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AppConfig, Recording } from '$lib/types';

let dir: string;
let config: AppConfig;
let POST: RequestHandler;
let addMany: (typeof import('$lib/server/store/recordings'))['addMany'];

// 이 라우트도 모듈 싱글턴 config($lib/server/config)를 직접 쓰기 때문에, 정적
// import보다 먼저 DATA_DIR/MEDIA_DIR을 프로세스 env에 심어야 싱글턴이 임시
// 디렉터리를 가리키게 만들 수 있다. 그래서 beforeAll에서 동적 import를 쓴다.
// (src/routes/api/media/[id]/[format]/server.test.ts와 같은 패턴)
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-download-route-'));
  process.env.DATA_DIR = path.join(dir, 'data');
  process.env.MEDIA_DIR = path.join(dir, 'media');

  ({ POST } = await import('./+server'));
  ({ config } = await import('$lib/server/config'));
  ({ addMany } = await import('$lib/server/store/recordings'));

  function makeRecording(id: string, over: Partial<Recording> = {}): Recording {
    return {
      id,
      title: '레인',
      description: '',
      tags: [],
      recordedAt: '2026-07-09T22:36:13+09:00',
      durationSec: 12,
      sourceName: 'x.qta',
      appleAutoTitle: null,
      files: {},
      bookmarks: [],
      createdAt: '2026-08-31T20:35:00+09:00',
      updatedAt: '2026-08-31T20:35:00+09:00',
      deletedAt: null,
      ...over
    };
  }

  async function putMediaFile(format: string, id: string, ext: string, bytes = 10): Promise<void> {
    const formatDir = path.join(config.mediaDir, format);
    await fs.mkdir(formatDir, { recursive: true });
    await fs.writeFile(path.join(formatDir, `${id}.${ext}`), Buffer.alloc(bytes, 1));
  }

  await addMany(config, [
    // a: 이름 검증용 기준 녹음. mp3 파일이 실제로 디스크에 있다.
    makeRecording('a', { files: { mp3: { bytes: 500 } } }),
    // b: 여러 개를 담을 때 상태 코드만 확인하는 용도.
    makeRecording('b', {
      title: '다른곡',
      recordedAt: '2026-07-01T10:00:00+09:00',
      files: { mp3: { bytes: 300 } }
    }),
    // dup: a와 제목·날짜(시각은 다름)가 같아 zip 안 이름이 겹친다.
    makeRecording('dup', {
      recordedAt: '2026-07-09T08:00:00+09:00',
      files: { mp3: { bytes: 500 } }
    }),
    // nomp3: files에 mp3 항목 자체가 없다 — 포맷 없음으로 건너뛰어야 한다.
    makeRecording('nomp3', { title: '노엠피3', files: { wav: { bytes: 100 } } }),
    // ghost: files.mp3 항목은 있지만 실제 파일을 디스크에 쓰지 않는다.
    makeRecording('ghost', { title: '고스트', files: { mp3: { bytes: 100 } } })
  ]);

  await putMediaFile('mp3', 'a', 'mp3', 500);
  await putMediaFile('mp3', 'b', 'mp3', 300);
  await putMediaFile('mp3', 'dup', 'mp3', 500);
  // nomp3, ghost는 의도적으로 mp3 파일을 쓰지 않는다.
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  delete process.env.MEDIA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

/** zip 로컬 헤더를 훑어 담긴 이름을 순서대로 뽑는다. STORE 방식이라
 *  헤더가 그대로 이어져 있어 이걸로 충분하다. */
async function zipEntryNames(res: Response): Promise<string[]> {
  const buf = Buffer.from(await res.arrayBuffer());
  const names: string[] = [];
  let i = 0;
  while ((i = buf.indexOf('PK\x03\x04', i, 'latin1')) !== -1) {
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    names.push(buf.subarray(i + 30, i + 30 + nameLen).toString('utf8'));
    i += 30 + nameLen + extraLen;
  }
  return names;
}

/** FormData를 만들어 POST 핸들러를 직접 부르는 얇은 헬퍼. 라우트가 error()로
 *  던지는 SvelteKit HttpError를 잡아 res.status로 확인할 수 있는 평범한
 *  Response로 바꿔준다 — 실제 서버라면 SvelteKit이 이 변환을 대신 해준다. */
async function post({ ids, format }: { ids: string[]; format: string }): Promise<Response> {
  const form = new FormData();
  for (const id of ids) form.append('ids', id);
  form.append('format', format);
  const request = new Request('http://localhost/api/download', { method: 'POST', body: form });
  try {
    return await POST({ request } as unknown as Parameters<RequestHandler>[0]);
  } catch (e) {
    if (isHttpError(e)) {
      return new Response(JSON.stringify(e.body), { status: e.status });
    }
    throw e;
  }
}

describe('POST /api/download', () => {
  it('고른 id들의 파일을 zip으로 묶어 돌려준다', async () => {
    const res = await post({ ids: ['a', 'b'], format: 'mp3' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
  });

  it('파일명에 제목과 녹음일자가 들어간다', async () => {
    const names = await zipEntryNames(await post({ ids: ['a'], format: 'mp3' }));
    expect(names).toEqual(['레인_2026-07-09.mp3']);
  });

  it('제목과 날짜가 겹치면 뒤에 번호를 붙여 덮어쓰지 않는다', async () => {
    const names = await zipEntryNames(await post({ ids: ['a', 'dup'], format: 'mp3' }));
    expect(names).toEqual(['레인_2026-07-09.mp3', '레인_2026-07-09 (2).mp3']);
  });

  it('고른 포맷이 없는 녹음은 건너뛴다', async () => {
    const names = await zipEntryNames(await post({ ids: ['a', 'nomp3'], format: 'mp3' }));
    expect(names).toEqual(['레인_2026-07-09.mp3']);
  });

  it('디스크에 파일이 없는 녹음도 건너뛴다', async () => {
    const names = await zipEntryNames(await post({ ids: ['a', 'ghost'], format: 'mp3' }));
    expect(names).toEqual(['레인_2026-07-09.mp3']);
  });

  it('담을 것이 하나도 없으면 404다', async () => {
    const res = await post({ ids: ['nomp3'], format: 'mp3' });
    expect(res.status).toBe(404);
  });

  it('ids가 비면 400이다', async () => {
    const res = await post({ ids: [], format: 'mp3' });
    expect(res.status).toBe(400);
  });

  it("Content-Disposition에 한글 파일명을 RFC 5987로 싣는다", async () => {
    const res = await post({ ids: ['a'], format: 'mp3' });
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/filename\*=UTF-8''/);
  });
});
