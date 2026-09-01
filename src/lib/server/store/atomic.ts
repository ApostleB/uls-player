import fs from 'node:fs/promises';
import path from 'node:path';

/** 경로별 쓰기 직렬화 체인. 같은 파일에 대한 갱신이 겹치지 않게 한다. */
const chains = new Map<string, Promise<unknown>>();

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * 현재 값을 읽어 mutate를 적용하고 원자적으로 쓴다.
 * 같은 filePath에 대한 호출은 순차 실행되므로 갱신이 유실되지 않는다.
 * 실패해도 체인은 계속 진행한다 (.catch()로 인해).
 */
export function updateJson<T>(
  filePath: string,
  mutate: (current: T) => T,
  fallback: T
): Promise<T> {
  const prev = chains.get(filePath) ?? Promise.resolve();
  const next = prev.then(async () => {
    const current = await readJson(filePath, fallback);
    const updated = mutate(current);
    await writeAtomic(filePath, updated);
    return updated;
  });
  chains.set(
    filePath,
    next.then(() => undefined).catch(() => undefined)
  );
  return next;
}
