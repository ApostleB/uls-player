import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Bookmark } from '$lib/types';
import { config } from '$lib/server/config';
import { patch, addTags, removeTags, softDelete, listAll, allTags } from '$lib/server/store/recordings';

type Body =
  | { op: 'patch'; id: string; title?: string; description?: string; tags?: string[]; bookmarks?: Bookmark[] }
  | { op: 'addTags'; ids: string[]; tags: string[] }
  | { op: 'removeTags'; ids: string[]; tags: string[] }
  | { op: 'delete'; ids: string[] };

export const PATCH: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as Body;

  switch (body.op) {
    case 'patch': {
      const { op, id, ...changes } = body;
      await patch(config, id, changes);
      break;
    }
    case 'addTags':
      await addTags(config, body.ids, body.tags);
      break;
    case 'removeTags':
      await removeTags(config, body.ids, body.tags);
      break;
    case 'delete':
      await softDelete(config, body.ids);
      break;
    default:
      throw error(400, '알 수 없는 작업입니다');
  }

  return json({ recordings: await listAll(config), tags: await allTags(config) });
};
