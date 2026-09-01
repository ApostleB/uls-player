import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, updateJson } from './atomic';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uls-atomic-'));
  file = path.join(dir, 'nested', 'data.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readJson', () => {
  it('파일이 없으면 fallback을 준다', async () => {
    expect(await readJson(file, { n: 0 })).toEqual({ n: 0 });
  });

  it('쓴 값을 그대로 읽는다', async () => {
    await updateJson(file, () => ({ n: 7 }), { n: 0 });
    expect(await readJson(file, { n: 0 })).toEqual({ n: 7 });
  });
});

describe('updateJson', () => {
  it('없는 디렉터리를 만들어서 쓴다', async () => {
    await updateJson(file, () => ({ n: 1 }), { n: 0 });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ n: 1 });
  });

  it('동시 호출에서 갱신이 유실되지 않는다', async () => {
    await Promise.all(
      Array.from({ length: 50 }, () => updateJson(file, (c) => ({ n: c.n + 1 }), { n: 0 }))
    );
    expect((await readJson(file, { n: 0 })).n).toBe(50);
  });

  it('임시 파일을 남기지 않는다', async () => {
    await updateJson(file, () => ({ n: 1 }), { n: 0 });
    const left = await fs.readdir(path.dirname(file));
    expect(left).toEqual(['data.json']);
  });

  it('mutate가 던지면 기존 파일을 훼손하지 않는다', async () => {
    await updateJson(file, () => ({ n: 5 }), { n: 0 });
    await expect(
      updateJson(file, () => {
        throw new Error('boom');
      }, { n: 0 })
    ).rejects.toThrow('boom');
    expect((await readJson(file, { n: 0 })).n).toBe(5);
  });
});
