import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Bookmark } from '$lib/types';
import { config } from '$lib/server/config';
import {
  patch,
  addTags,
  removeTags,
  setFavorite,
  softDelete,
  listAll,
  allTags
} from '$lib/server/store/recordings';

type Body =
  | { op: 'patch'; id: string; title?: string; description?: string; tags?: string[]; bookmarks?: Bookmark[] }
  | { op: 'addTags'; ids: string[]; tags: string[] }
  | { op: 'removeTags'; ids: string[]; tags: string[] }
  | { op: 'favorite'; id: string; favorite: boolean }
  | { op: 'delete'; ids: string[] };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isNonEmptyString);
}

function isBookmark(v: unknown): v is Bookmark {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    isNonEmptyString(b.id) &&
    typeof b.atSec === 'number' &&
    (b.endSec === null || typeof b.endSec === 'number') &&
    typeof b.note === 'string'
  );
}

function isBookmarkArray(v: unknown): v is Bookmark[] {
  return Array.isArray(v) && v.every(isBookmark);
}

function badRequest(message: string): never {
  throw error(400, message);
}

/**
 * op이 실제로 쓰는 필드만 검증한다. 검증 없이 스토어로 흘려보내면 두 가지
 * 방식으로 망가진다: (1) patch에 id가 없거나 잘못된 타입이면 store.patch가
 * 못 찾겠다며 plain Error를 던지고, 그게 그대로 새어나가 500이 된다(핸들러
 * 어디서도 잡지 않으므로). (2) tags가 배열이 아니라 문자열이면
 * `[...r.tags, ...tags]`가 문자열을 한 글자씩 스프레드해서 태그를
 * 조용히 망가뜨리고도 200을 반환한다 — 둘 다 프론트가 절대 보낼 수 없는
 * 입력이 아니라, 손상되거나 악의적인 요청이면 실제로 도달할 수 있는
 * 입력이다.
 */
function validate(body: Body): void {
  switch (body.op) {
    case 'patch': {
      if (!isNonEmptyString(body.id)) badRequest('id는 비어 있지 않은 문자열이어야 합니다');
      if (body.title !== undefined && typeof body.title !== 'string') {
        badRequest('title은 문자열이어야 합니다');
      }
      if (body.description !== undefined && typeof body.description !== 'string') {
        badRequest('description은 문자열이어야 합니다');
      }
      if (body.tags !== undefined && !isStringArray(body.tags)) {
        badRequest('tags는 비어 있지 않은 문자열의 배열이어야 합니다');
      }
      if (body.bookmarks !== undefined && !isBookmarkArray(body.bookmarks)) {
        badRequest('bookmarks 형식이 올바르지 않습니다');
      }
      return;
    }
    case 'addTags':
    case 'removeTags':
      if (!isStringArray(body.ids)) badRequest('ids는 비어 있지 않은 문자열의 배열이어야 합니다');
      if (!isStringArray(body.tags)) badRequest('tags는 비어 있지 않은 문자열의 배열이어야 합니다');
      return;
    case 'favorite':
      if (!isNonEmptyString(body.id)) badRequest('id가 필요합니다');
      if (typeof body.favorite !== 'boolean') badRequest('favorite은 true/false여야 합니다');
      return;
    case 'delete':
      if (!isStringArray(body.ids)) badRequest('ids는 비어 있지 않은 문자열의 배열이어야 합니다');
      return;
    default:
      badRequest('알 수 없는 작업입니다');
  }
}

export const PATCH: RequestHandler = async ({ request }) => {
  const raw: unknown = await request.json();
  if (typeof raw !== 'object' || raw === null || typeof (raw as { op?: unknown }).op !== 'string') {
    throw error(400, '요청 본문이 올바르지 않습니다');
  }
  const body = raw as Body;

  validate(body);

  switch (body.op) {
    case 'patch': {
      // body는 검증된 타입이 아니라 파싱된 런타임 객체(raw as Body)라, 여기서
      // `...changes`로 스프레드하면 Body에 없는 필드까지(예: favoritedAt) 그대로
      // 통과한다. validate()는 알려진 필드만 검사할 뿐 모르는 키를 거부하지
      // 않으므로, patch가 실제로 받는 필드를 명시적으로 하나씩 골라 넘긴다.
      const changes: {
        title?: string;
        description?: string;
        tags?: string[];
        bookmarks?: Bookmark[];
      } = {};
      if (body.title !== undefined) changes.title = body.title;
      if (body.description !== undefined) changes.description = body.description;
      if (body.tags !== undefined) changes.tags = body.tags;
      if (body.bookmarks !== undefined) changes.bookmarks = body.bookmarks;
      await patch(config, body.id, changes);
      break;
    }
    case 'addTags':
      await addTags(config, body.ids, body.tags);
      break;
    case 'removeTags':
      await removeTags(config, body.ids, body.tags);
      break;
    case 'favorite':
      // 시각은 여기서 받지 않는다 — setFavorite이 서버 시각을 찍는다.
      // patch를 거치지 않고 setFavorite을 직접 부르는 것도 같은 이유다.
      await setFavorite(config, body.id, body.favorite);
      break;
    case 'delete':
      await softDelete(config, body.ids);
      break;
    default:
      throw error(400, '알 수 없는 작업입니다');
  }

  return json({ recordings: await listAll(config), tags: await allTags(config) });
};
