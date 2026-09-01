import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RequestHandler } from './$types';

// patch/addTags/removeTags/softDelete를 스텁으로 바꿔서, 디스패처가 "올바른
// 저장소 함수에 올바른 인자로" 도달하는지만 검증한다(각 함수 자체의 동작은
// recordings.test.ts에서 이미 검증됨). listAll/allTags는 실제 구현을 그대로
// 둬서(빈 스토어라 [] 반환) 응답 조립까지 자연스럽게 확인한다.
vi.mock('$lib/server/store/recordings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/store/recordings')>();
  return {
    ...actual,
    patch: vi.fn(async () => undefined),
    addTags: vi.fn(async () => undefined),
    removeTags: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => undefined)
  };
});

import { PATCH } from './+server';
import { config } from '$lib/server/config';
import * as store from '$lib/server/store/recordings';

const patchSpy = vi.mocked(store.patch);
const addTagsSpy = vi.mocked(store.addTags);
const removeTagsSpy = vi.mocked(store.removeTags);
const softDeleteSpy = vi.mocked(store.softDelete);

beforeEach(() => {
  patchSpy.mockClear();
  addTagsSpy.mockClear();
  removeTagsSpy.mockClear();
  softDeleteSpy.mockClear();
});

function req(body: unknown) {
  return {
    request: new Request('http://localhost/api/recordings', {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
  } as unknown as Parameters<RequestHandler>[0];
}

function othersUntouched(except: 'patch' | 'addTags' | 'removeTags' | 'softDelete') {
  const all = { patch: patchSpy, addTags: addTagsSpy, removeTags: removeTagsSpy, softDelete: softDeleteSpy };
  for (const [name, spy] of Object.entries(all)) {
    if (name === except) continue;
    expect(spy, `${name}는 호출되면 안 된다`).not.toHaveBeenCalled();
  }
}

describe('PATCH /api/recordings 디스패처', () => {
  it("op: 'patch'는 patch(config, id, changes)를 호출한다", async () => {
    const res = await PATCH(req({ op: 'patch', id: 'rec-1', title: '새 제목', tags: ['a'] }));

    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith(config, 'rec-1', { title: '새 제목', tags: ['a'] });
    othersUntouched('patch');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ recordings: [], tags: [] });
  });

  it("op: 'addTags'는 addTags(config, ids, tags)를 호출한다", async () => {
    await PATCH(req({ op: 'addTags', ids: ['a', 'b'], tags: ['데모'] }));

    expect(addTagsSpy).toHaveBeenCalledTimes(1);
    expect(addTagsSpy).toHaveBeenCalledWith(config, ['a', 'b'], ['데모']);
    othersUntouched('addTags');
  });

  it("op: 'removeTags'는 removeTags(config, ids, tags)를 호출한다", async () => {
    await PATCH(req({ op: 'removeTags', ids: ['a'], tags: ['데모'] }));

    expect(removeTagsSpy).toHaveBeenCalledTimes(1);
    expect(removeTagsSpy).toHaveBeenCalledWith(config, ['a'], ['데모']);
    othersUntouched('removeTags');
  });

  it("op: 'delete'는 softDelete(config, ids)를 호출한다", async () => {
    await PATCH(req({ op: 'delete', ids: ['a', 'b', 'c'] }));

    expect(softDeleteSpy).toHaveBeenCalledTimes(1);
    expect(softDeleteSpy).toHaveBeenCalledWith(config, ['a', 'b', 'c']);
    othersUntouched('softDelete');
  });

  it('알 수 없는 op는 400이고 어떤 저장소 함수도 호출하지 않는다', async () => {
    await expect(PATCH(req({ op: 'bogus' }))).rejects.toMatchObject({ status: 400 });

    expect(patchSpy).not.toHaveBeenCalled();
    expect(addTagsSpy).not.toHaveBeenCalled();
    expect(removeTagsSpy).not.toHaveBeenCalled();
    expect(softDeleteSpy).not.toHaveBeenCalled();
  });
});
