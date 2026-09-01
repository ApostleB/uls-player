import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RequestHandler } from './$types';
import type { AppConfig, Recording } from '$lib/types';

let dir: string;
let config: AppConfig;
let GET: RequestHandler;
let addMany: (typeof import('$lib/server/store/recordings'))['addMany'];
let newId: (typeof import('$lib/server/store/recordings'))['newId'];

// 이 라우트는 모듈 싱글턴 config($lib/server/config)를 직접 쓰기 때문에, 정적
// import보다 먼저 DATA_DIR/MEDIA_DIR을 프로세스 env에 심어야 싱글턴이 임시
// 디렉터리를 가리키게 만들 수 있다. 그래서 beforeAll에서 동적 import를 쓴다.
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-media-route-'));
  process.env.DATA_DIR = path.join(dir, 'data');
  process.env.MEDIA_DIR = path.join(dir, 'media');

  ({ GET } = await import('./+server'));
  ({ config } = await import('$lib/server/config'));
  ({ addMany, newId } = await import('$lib/server/store/recordings'));
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  delete process.env.MEDIA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

function makeRecording(over: Partial<Recording> = {}): Recording {
  return {
    id: newId(),
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

/** mediaDir/<format>/<id>.<ext> 에 결정론적 바이트 패턴을 써서 슬라이스를 검증할 수 있게 한다. */
async function putMediaFile(format: string, id: string, ext: string, bytes: number): Promise<Buffer> {
  const buf = Buffer.from(Array.from({ length: bytes }, (_, i) => i % 256));
  const formatDir = path.join(config.mediaDir, format);
  await fs.mkdir(formatDir, { recursive: true });
  await fs.writeFile(path.join(formatDir, `${id}.${ext}`), buf);
  return buf;
}

function event(id: string, format: string, headers: Record<string, string> = {}) {
  return {
    params: { id, format },
    request: new Request('http://localhost/api/media/x/y', { headers })
  } as unknown as Parameters<RequestHandler>[0];
}

describe('GET /api/media/[id]/[format]', () => {
  it('Range 없이 요청하면 전체를 200으로 준다', async () => {
    const id = newId();
    await addMany(config, [makeRecording({ id, files: { mp3: { bytes: 500 } } })]);
    const buf = await putMediaFile('mp3', id, 'mp3', 500);

    const res = await GET(event(id, 'mp3'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('500');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(buf)).toBe(true);
  });

  it('bytes=0-99 요청은 정확히 첫 100바이트를 206으로 준다', async () => {
    const id = newId();
    await addMany(config, [makeRecording({ id, files: { mp3: { bytes: 300 } } })]);
    const buf = await putMediaFile('mp3', id, 'mp3', 300);

    const res = await GET(event(id, 'mp3', { range: 'bytes=0-99' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-99/300');
    expect(res.headers.get('content-length')).toBe('100');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(100);
    expect(body.equals(buf.subarray(0, 100))).toBe(true);
  });

  it('bytes=100- (열린 끝) 요청은 100바이트째부터 끝까지 준다', async () => {
    const id = newId();
    await addMany(config, [makeRecording({ id, files: { mp3: { bytes: 300 } } })]);
    const buf = await putMediaFile('mp3', id, 'mp3', 300);

    const res = await GET(event(id, 'mp3', { range: 'bytes=100-' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-299/300');
    expect(res.headers.get('content-length')).toBe('200');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(buf.subarray(100, 300))).toBe(true);
  });

  it('요청 끝이 파일 크기를 넘으면 파일 끝까지로 잘라 206을 준다', async () => {
    const id = newId();
    await addMany(config, [makeRecording({ id, files: { mp3: { bytes: 50 } } })]);
    const buf = await putMediaFile('mp3', id, 'mp3', 50);

    // 파일은 50바이트인데 1000바이트째까지 요청 — 끝은 49로 잘려야 한다
    const res = await GET(event(id, 'mp3', { range: 'bytes=40-1000' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 40-49/50');
    expect(res.headers.get('content-length')).toBe('10');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(buf.subarray(40, 50))).toBe(true);
  });

  it('시작점이 파일 크기 이상이면 416과 Content-Range: bytes */size를 준다', async () => {
    const id = newId();
    await addMany(config, [makeRecording({ id, files: { mp3: { bytes: 50 } } })]);
    await putMediaFile('mp3', id, 'mp3', 50);

    const res = await GET(event(id, 'mp3', { range: 'bytes=50-60' }));

    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */50');
    expect(await res.text()).toBe('');
  });

  it('시작점이 끝점보다 크면(역전) 416을 준다', async () => {
    const id = newId();
    await addMany(config, [makeRecording({ id, files: { mp3: { bytes: 50 } } })]);
    await putMediaFile('mp3', id, 'mp3', 50);

    const res = await GET(event(id, 'mp3', { range: 'bytes=30-10' }));

    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */50');
  });

  it('존재하지 않는 id면 404', async () => {
    await expect(GET(event('no-such-id', 'mp3'))).rejects.toMatchObject({ status: 404 });
  });

  it('녹음에 없는 포맷을 요청하면 404', async () => {
    const id = newId();
    await addMany(config, [makeRecording({ id, files: { mp3: { bytes: 10 } } })]);
    await putMediaFile('mp3', id, 'mp3', 10);

    await expect(GET(event(id, 'wav'))).rejects.toMatchObject({ status: 404 });
  });

  it('files 항목은 있지만 디스크에 파일이 없으면 404', async () => {
    const id = newId();
    // files.mp3 항목은 있지만 실제 파일은 쓰지 않는다
    await addMany(config, [makeRecording({ id, files: { mp3: { bytes: 999 } } })]);

    await expect(GET(event(id, 'mp3'))).rejects.toMatchObject({ status: 404 });
  });
});
