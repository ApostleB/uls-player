import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, Recording, RecordingsFile } from '$lib/types';
import { readJson, updateJson } from './atomic';

const EMPTY: RecordingsFile = { version: 1, recordings: [] };

function file(cfg: AppConfig): string {
  return path.join(cfg.dataDir, 'recordings.json');
}

export function newId(): string {
  return randomUUID();
}

function nowIso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

async function all(cfg: AppConfig): Promise<Recording[]> {
  // 이 저장소는 스키마 버전을 올려 마이그레이션하는 대신, 읽는 쪽에서
  // 기본값을 채운다. all()이 모든 읽기의 관문이라 여기 한 곳이면
  // listAll·getById가 전부 새 필드를 보게 된다. patch()는 이 함수를 거치지
  // 않고 updateJson 콜백 안에서 cur.recordings[i]를 원본 그대로 읽으므로
  // 이 기본값 채움을 보지 않는다 — 문제가 되지 않는 건, 쓰기 경로가 필드를
  // 명시적으로 지정하고(setFavorite 등) patch()의 반환값을 쓰는 호출부가
  // 없어 이 기본값에 기대는 곳이 없기 때문이다.
  const raw = (await readJson<RecordingsFile>(file(cfg), EMPTY)).recordings;
  return raw.map((r) => ({ ...r, favoritedAt: r.favoritedAt ?? null }));
}

/** recordedAt를 실제 시각(epoch ms)으로 바꾼다. 빈 문자열이거나 파싱할 수 없으면 null. */
function recordedAtMs(iso: string): number | null {
  if (iso === '') return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * recordedAt 내림차순 비교자. 오프셋이 섞여 있어도 문자열이 아니라 실제 시각 기준으로 비교한다.
 * recordedAt이 빈 문자열이거나 파싱 불가하면 항상 맨 뒤로 보낸다.
 * 실제 시각이 같으면 id로 안정 정렬하고, 어느 한쪽이라도 id가 없으면 0을 반환해 원래 순서를 유지한다.
 * Recording뿐 아니라 { recordedAt, id? } 형태(예: Task 9의 ScanItem)에도 그대로 쓸 수 있다.
 */
export function compareByRecordedAtDesc(
  a: { recordedAt: string; id?: string },
  b: { recordedAt: string; id?: string }
): number {
  const ta = recordedAtMs(a.recordedAt);
  const tb = recordedAtMs(b.recordedAt);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  if (ta !== tb) return tb - ta;
  if (a.id === undefined || b.id === undefined) return 0;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function listAll(cfg: AppConfig): Promise<Recording[]> {
  return (await all(cfg)).filter((r) => r.deletedAt === null).sort(compareByRecordedAtDesc);
}

export async function getById(cfg: AppConfig, id: string): Promise<Recording | null> {
  return (await all(cfg)).find((r) => r.id === id && r.deletedAt === null) ?? null;
}

export async function addMany(cfg: AppConfig, recs: Recording[]): Promise<void> {
  await updateJson<RecordingsFile>(
    file(cfg),
    (cur) => ({ ...cur, recordings: [...cur.recordings, ...recs] }),
    EMPTY
  );
}

type Patchable = Partial<
  Pick<Recording, 'title' | 'description' | 'tags' | 'files' | 'bookmarks' | 'favoritedAt'>
>;

/**
 * patch()가 대상 id를 찾지 못했을 때 던지는 전용 타입.
 *
 * 예전에는 이 사유를 평범한 Error에 담아 메시지 문자열("녹음을 찾을 수
 * 없습니다: ...")로만 구분했다 — runner.ts가 이 특정 실패(복구된 작업이라
 * 저장소에 원본이 없는 경우)만 골라 사용자에게 행동 가능한 메시지로
 * 바꿔주려면 그 문자열의 접두어를 검사해야 했다. 문자열 접두어 비교는
 * 두 방향으로 다 깨진다: 이 메시지 문구가 나중에 바뀌면(오타 수정, 문구
 * 다듬기 등) 조용히 매치가 끊기고, 반대로 다른 원인(예: 디스크 쓰기
 * 실패)이 우연히 같은 문구로 시작하면 엉뚱하게 매치돼 원래 원인을
 * "서버 재시작으로 복구된 작업"이라는 잘못된 설명으로 덮어써 버린다.
 * 타입으로 구분하면 두 문제 모두 없다 — 메시지 문구는 자유롭게 바뀌어도
 * 되고, 다른 원인은 이 클래스의 인스턴스가 아니므로 절대 매치되지 않는다.
 */
export class RecordingNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`녹음을 찾을 수 없습니다: ${id}`);
    this.name = 'RecordingNotFoundError';
  }
}

export async function patch(cfg: AppConfig, id: string, changes: Patchable): Promise<Recording> {
  let out: Recording | null = null;
  await updateJson<RecordingsFile>(
    file(cfg),
    (cur) => {
      const i = cur.recordings.findIndex((r) => r.id === id && r.deletedAt === null);
      if (i === -1) throw new RecordingNotFoundError(id);
      out = { ...cur.recordings[i], ...changes, updatedAt: nowIso() };
      const next = cur.recordings.slice();
      next[i] = out;
      return { ...cur, recordings: next };
    },
    EMPTY
  );
  return out!;
}

/**
 * 즐겨찾기를 지정하거나 해제한다.
 *
 * 시각을 여기서 찍는 것이 이 함수가 patch와 따로 있는 이유다. patch는
 * 클라이언트가 준 값을 그대로 저장하는 경로라, 거기에 favoritedAt을
 * 얹으면 아무 시각이나 보낼 수 있게 되고 메인 카드의 "최근 5개" 순서를
 * 조작할 수 있다.
 */
export async function setFavorite(
  cfg: AppConfig,
  id: string,
  favorite: boolean
): Promise<Recording> {
  return patch(cfg, id, { favoritedAt: favorite ? nowIso() : null });
}

function mapIds(
  cfg: AppConfig,
  ids: string[],
  fn: (r: Recording) => Recording
): Promise<RecordingsFile> {
  const set = new Set(ids);
  return updateJson<RecordingsFile>(
    file(cfg),
    (cur) => ({
      ...cur,
      recordings: cur.recordings.map((r) => (set.has(r.id) ? fn(r) : r))
    }),
    EMPTY
  );
}

export async function addTags(cfg: AppConfig, ids: string[], tags: string[]): Promise<void> {
  await mapIds(cfg, ids, (r) => ({
    ...r,
    tags: Array.from(new Set([...r.tags, ...tags])),
    updatedAt: nowIso()
  }));
}

export async function removeTags(cfg: AppConfig, ids: string[], tags: string[]): Promise<void> {
  const drop = new Set(tags);
  await mapIds(cfg, ids, (r) => ({
    ...r,
    tags: r.tags.filter((t) => !drop.has(t)),
    updatedAt: nowIso()
  }));
}

export async function softDelete(cfg: AppConfig, ids: string[]): Promise<void> {
  const at = nowIso();
  await mapIds(cfg, ids, (r) => ({ ...r, deletedAt: at, updatedAt: at }));
}

export async function allTags(cfg: AppConfig): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const r of await listAll(cfg)) {
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko')
  );
}

/** 삭제된 항목의 원본명도 포함한다. 재스캔에서 다시 끌려오지 않게 하기 위해서다. */
export async function existingSourceNames(cfg: AppConfig): Promise<Set<string>> {
  return new Set((await all(cfg)).map((r) => r.sourceName));
}
