import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RequestHandler } from './$types';

let dir: string;
let GET: RequestHandler;
let savePeaks: (typeof import('$lib/server/store/waveforms'))['savePeaks'];

// 이 라우트도 모듈 싱글턴 config를 쓴다. media 라우트 테스트와 같은 이유로
// 정적 import 전에 env를 심고 동적으로 불러온다.
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-waveform-route-'));
  process.env.DATA_DIR = path.join(dir, 'data');
  process.env.MEDIA_DIR = path.join(dir, 'media');

  ({ GET } = await import('./+server'));
  ({ savePeaks } = await import('$lib/server/store/waveforms'));
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  delete process.env.MEDIA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

function event(id: string) {
  return { params: { id } } as unknown as Parameters<RequestHandler>[0];
}

describe('GET /api/waveform/[id]', () => {
  it('파형이 저장돼 있으면 200과 peaks 배열을 준다', async () => {
    const { config } = await import('$lib/server/config');
    const peaks = [0, 0.5, 1, 0.25, 0.1];
    await savePeaks(config, 'has-peaks', peaks);

    const res = await GET(event('has-peaks'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(peaks);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('파형이 아직 생성되지 않았으면(loadPeaks가 null) 404다 — 빈 배열이 아니다', async () => {
    // loadPeaks(cfg, 'never-generated')는 실제로 null을 반환한다(readJson의
    // ENOENT 폴백이 null이므로). 라우트가 그걸 200 + []로 잘못 흘려보내면
    // rejects 자체가 실패해 이 테스트가 잡아낸다.
    await expect(GET(event('never-generated'))).rejects.toMatchObject({ status: 404 });
  });

  it('실제로 빈 배열([])이 저장된 경우는(생성되긴 했음) 404가 아니라 200과 빈 배열을 준다', async () => {
    const { config } = await import('$lib/server/config');
    await savePeaks(config, 'empty-but-generated', []);

    const res = await GET(event('empty-but-generated'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
