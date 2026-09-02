import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '$lib/types';
import { loadConfig } from './config';
import { saveUploads, UploadTooLarge } from './upload';

const SPATIAL = path.resolve('tests/fixtures/audio/spatial.qta');

let dir: string;
let cfg: AppConfig;

// saveUploads가 실제로 쓰는 임시 폴더는 cfg.dataDir 아래가 아니라
// os.tmpdir() 바로 아래다(upload.ts의 주석 참고) — 그래서 dir(=cfg.dataDir의
// 부모)을 지우는 것만으로는 saveUploads가 반환한 폴더가 함께 지워지지
// 않는다. 여기서 명시적으로 추적해서 지우지 않으면 테스트를 돌릴 때마다
// 개발자의 실제 OS 임시 디렉터리에 uls-upload-* 폴더가 하나씩 영원히
// 쌓인다 — 실제로 이 테스트 초안을 쓰는 동안 정리 없이 여러 번 돌려서
// 60개 넘게 쌓인 걸 발견하고 고쳤다.
const created: string[] = [];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-upload-test-'));
  cfg = loadConfig({ DATA_DIR: path.join(dir, 'data'), MEDIA_DIR: path.join(dir, 'media') });
  created.length = 0;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await Promise.all(created.map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function fileFrom(p: string, name: string): Promise<File> {
  return new File([await fs.readFile(p)], name);
}

/** saveUploads를 호출하고 성공하면 반환된 폴더를 정리 대상으로 추적한다. */
async function save(cfgArg: AppConfig, files: File[]): Promise<string> {
  const out = await saveUploads(cfgArg, files);
  created.push(out);
  return out;
}

describe('saveUploads', () => {
  it('오디오 파일을 임시 폴더에 쓴다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta')]);
    expect(await fs.readdir(out)).toEqual(['a.qta']);
  });

  it('CloudRecordings.db도 함께 받는다', async () => {
    const db = new File([Buffer.from('x')], 'CloudRecordings.db');
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta'), db]);
    expect((await fs.readdir(out)).sort()).toEqual(['CloudRecordings.db', 'a.qta']);
  });

  it('오디오도 DB도 아닌 파일은 버린다', async () => {
    const junk = new File([Buffer.from('x')], 'notes.txt');
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta'), junk]);
    expect(await fs.readdir(out)).toEqual(['a.qta']);
  });

  it('경로 구분자가 든 이름은 파일명만 남긴다 (그리고 실제로 상위 폴더로 새지 않는다)', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, '../../evil.qta')]);
    expect(await fs.readdir(out)).toEqual(['evil.qta']);
    // path.basename만 믿지 않는다 — 취약했다면 evil.qta가 out이 아니라
    // out의 조부모 디렉터리에 만들어졌을 것이다. 그 자리에 아무것도
    // 없어야 실제로 탈출하지 않았다는 증거가 된다.
    const escaped = path.join(out, '..', '..', 'evil.qta');
    await expect(fs.access(escaped)).rejects.toThrow();
  });

  it('절대 경로로 온 이름도 파일명만 남긴다', async () => {
    const out = await save(cfg, [await fileFrom(SPATIAL, '/etc/evil.qta')]);
    expect(await fs.readdir(out)).toEqual(['evil.qta']);
    await expect(fs.access('/etc/evil.qta')).rejects.toThrow();
  });

  it('점만 있는 이름(.. 등)은 확장자가 없어 버려진다', async () => {
    // ".."의 path.basename은 ".."고 extname은 ''다 — 우리가 아는 오디오
    // 확장자도 DB 파일명도 아니므로 다른 정크 파일과 똑같이 걸러진다.
    // 여기서 걸러지지 않으면 path.join(dir, '..')가 dir의 부모를
    // 가리키게 되므로, 이 필터가 두 번째 방어선(safeDest) 앞의 첫
    // 방어선이다.
    const dots = new File([Buffer.from('x')], '..');
    const singleDot = new File([Buffer.from('x')], '.');
    const out = await save(cfg, [await fileFrom(SPATIAL, 'a.qta'), dots, singleDot]);
    expect(await fs.readdir(out)).toEqual(['a.qta']);
  });

  it('sanitise 후 이름이 겹치는 두 파일을 둘 다 보존한다', async () => {
    // 서로 다른 폴더에 있던 동명 파일 두 개를 함께 올리는 상황을
    // 흉내낸다. path.basename을 거치면 둘 다 "evil.qta"가 된다.
    const a = new File([Buffer.from('AAAA')], 'sub1/evil.qta');
    const b = new File([Buffer.from('BBBB')], 'sub2/evil.qta');
    const out = await save(cfg, [a, b]);
    const names = (await fs.readdir(out)).sort();
    expect(names).toHaveLength(2);
    expect(names).toContain('evil.qta');
    const contents = await Promise.all(
      names.map((n) => fs.readFile(path.join(out, n), 'utf8'))
    );
    // 겹쳤다고 뒤의 파일이 앞의 파일을 덮어써 하나가 사라지면 안 된다 —
    // 두 내용이 모두 살아 있어야 한다.
    expect(contents.sort()).toEqual(['AAAA', 'BBBB']);
  });

  it('크기가 0인 파일도 그대로 받는다', async () => {
    const empty = new File([], 'empty.qta');
    const out = await save(cfg, [empty]);
    expect(await fs.readdir(out)).toEqual(['empty.qta']);
    expect((await fs.stat(path.join(out, 'empty.qta'))).size).toBe(0);
  });

  it('MAX_UPLOAD_MB를 넘으면 던진다', async () => {
    const small = loadConfig({ DATA_DIR: path.join(dir, 'd'), MAX_UPLOAD_MB: '0.001' });
    await expect(saveUploads(small, [await fileFrom(SPATIAL, 'a.qta')])).rejects.toThrow(
      UploadTooLarge
    );
  });

  it('받을 게 없으면 던진다', async () => {
    await expect(saveUploads(cfg, [])).rejects.toThrow(/오디오/);
  });
});
