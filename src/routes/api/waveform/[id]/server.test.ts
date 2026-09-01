import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';
import type { AppConfig } from '$lib/types';

let dir: string;
let config: AppConfig;
let GET: RequestHandler;
let savePeaks: (typeof import('$lib/server/store/waveforms'))['savePeaks'];
let loadPeaks: (typeof import('$lib/server/store/waveforms'))['loadPeaks'];

// 이 라우트도 모듈 싱글턴 config를 쓴다. media 라우트 테스트와 같은 이유로
// 정적 import 전에 env를 심고 동적으로 불러온다.
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-waveform-route-'));
  process.env.DATA_DIR = path.join(dir, 'data');
  process.env.MEDIA_DIR = path.join(dir, 'media');

  ({ GET } = await import('./+server'));
  ({ config } = await import('$lib/server/config'));
  ({ savePeaks, loadPeaks } = await import('$lib/server/store/waveforms'));
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
    const id = randomUUID();
    const peaks = [0, 0.5, 1, 0.25, 0.1];
    await savePeaks(config, id, peaks);

    const res = await GET(event(id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(peaks);
    // Finding 5: 재시도가 같은 id로 peaks를 다시 만들 수 있으니 immutable +
    // 1년 캐시는 안 된다. 짧은 max-age + must-revalidate여야 한다.
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
  });

  it('파형이 아직 생성되지 않았으면(loadPeaks가 null) 404다 — 빈 배열이 아니다', async () => {
    // loadPeaks(cfg, id)는 실제로 null을 반환한다(readJson의 ENOENT
    // 폴백이 null이므로). 라우트가 그걸 200 + []로 잘못 흘려보내면
    // rejects 자체가 실패해 이 테스트가 잡아낸다.
    await expect(GET(event(randomUUID()))).rejects.toMatchObject({ status: 404 });
  });

  it('실제로 빈 배열([])이 저장된 경우는(생성되긴 했음) 404가 아니라 200과 빈 배열을 준다', async () => {
    const id = randomUUID();
    await savePeaks(config, id, []);

    const res = await GET(event(id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  describe('경로 조작 방어 (Finding 1)', () => {
    it('UUID 형태가 아닌 id는 파일시스템을 건드리지 않고 404를 준다', async () => {
      await expect(GET(event('not-a-uuid'))).rejects.toMatchObject({ status: 404 });
    });

    it("'../SECRET' 형태(디코딩된 %2f)의 id는 404를 주고 data/SECRET.json 내용을 반환하지 않는다", async () => {
      // 리뷰가 재현한 그대로: SvelteKit은 매칭 이후 %2f를 디코딩해서 넘기므로
      // 핸들러가 실제로 받는 값은 이미 '/'가 들어간 문자열이다. dataDir
      // 바로 아래(waveforms/의 한 단계 위)에 미끼 파일을 심어둔다.
      await fs.mkdir(config.dataDir, { recursive: true });
      await fs.writeFile(path.join(config.dataDir, 'SECRET.json'), JSON.stringify(['leaked']));

      await expect(GET(event('../SECRET'))).rejects.toMatchObject({ status: 404 });
    });

    it("'..%2f..%2fROOT_SECRET'이 디코딩된 '../../ROOT_SECRET' id도 404를 준다", async () => {
      const outsideDataDir = path.dirname(config.dataDir);
      await fs.writeFile(path.join(outsideDataDir, 'ROOT_SECRET.json'), JSON.stringify(['leaked']));

      await expect(GET(event('../../ROOT_SECRET'))).rejects.toMatchObject({ status: 404 });

      await fs.rm(path.join(outsideDataDir, 'ROOT_SECRET.json'), { force: true });
    });

    it('절대경로 형태의 id도 404를 준다', async () => {
      await expect(GET(event('/etc/passwd'))).rejects.toMatchObject({ status: 404 });
    });
  });
});

describe('waveforms 스토어 경로 이탈 방어 (Finding 1, defence in depth)', () => {
  it('loadPeaks는 waveforms 디렉터리를 벗어나는 id에 대해 던진다 (조용히 null이 아니다)', async () => {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(path.join(config.dataDir, 'SECRET.json'), JSON.stringify(['leaked']));

    await expect(loadPeaks(config, '../SECRET')).rejects.toThrow();
  });

  it('savePeaks는 waveforms 디렉터리를 벗어나는 id에 대해 던지고, 대상 파일을 만들지 않는다', async () => {
    const target = path.join(config.dataDir, 'ESCAPED.json');
    await fs.rm(target, { force: true });

    await expect(savePeaks(config, '../ESCAPED', [1, 2, 3])).rejects.toThrow();

    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('정상적인 UUID id는 그대로 통과한다 (과잉 차단 아님)', async () => {
    const id = randomUUID();
    await savePeaks(config, id, [1, 2, 3]);
    await expect(loadPeaks(config, id)).resolves.toEqual([1, 2, 3]);
  });
});
