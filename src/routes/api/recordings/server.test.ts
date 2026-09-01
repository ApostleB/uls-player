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

  it("op: 'patch'는 bookmarks가 온전하면 그대로 patch에 넘긴다", async () => {
    const bookmarks = [{ id: 'bm-1', atSec: 1.5, endSec: null, note: '메모' }];
    await PATCH(req({ op: 'patch', id: 'rec-1', bookmarks }));

    expect(patchSpy).toHaveBeenCalledWith(config, 'rec-1', { bookmarks });
  });
});

describe('PATCH /api/recordings 본문 형태 검증 (Finding 3, 4)', () => {
  it("op: 'patch'에 id가 없으면 500이 아니라 400이고, patch를 호출하지 않는다", async () => {
    // 고쳐지기 전에는 검증이 없어서 store.patch(undefined인 id)까지
    // 흘러들어갔다 — 실제 store.patch는 못 찾으면 plain Error를 던지고,
    // 그게 어디서도 잡히지 않아 그대로 500으로 새어나갔다.
    await expect(PATCH(req({ op: 'patch', title: '제목만 있음' }))).rejects.toMatchObject({
      status: 400
    });
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("op: 'patch'에 id가 문자열이 아니면(숫자 등) 400이고, patch를 호출하지 않는다", async () => {
    await expect(PATCH(req({ op: 'patch', id: 12345, title: 'x' }))).rejects.toMatchObject({
      status: 400
    });
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("op: 'patch'에 id가 빈 문자열이면 400이다", async () => {
    await expect(PATCH(req({ op: 'patch', id: '', title: 'x' }))).rejects.toMatchObject({
      status: 400
    });
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("op: 'patch'에서 tags가 배열이 아니라 문자열이면 400이고, patch를 호출하지 않는다", async () => {
    // 고쳐지기 전에는 이게 그대로 store까지 흘러가 `[...r.tags, ...'abc']`처럼
    // 문자열을 한 글자씩 스프레드해서 태그를 조용히 망가뜨리고도 200을 줬다.
    await expect(
      PATCH(req({ op: 'patch', id: 'rec-1', tags: 'abc' }))
    ).rejects.toMatchObject({ status: 400 });
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("op: 'patch'에서 title이 문자열이 아니면 400이다", async () => {
    await expect(
      PATCH(req({ op: 'patch', id: 'rec-1', title: 123 }))
    ).rejects.toMatchObject({ status: 400 });
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("op: 'patch'에서 bookmarks 항목의 필드 타입이 틀리면 400이다", async () => {
    const badBookmarks = [{ id: 'bm-1', atSec: '아니다', endSec: null, note: '메모' }];
    await expect(
      PATCH(req({ op: 'patch', id: 'rec-1', bookmarks: badBookmarks }))
    ).rejects.toMatchObject({ status: 400 });
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("op: 'addTags'에서 tags가 문자열이면(Finding 4 원 시나리오) 400이고, addTags를 호출하지 않는다", async () => {
    await expect(
      PATCH(req({ op: 'addTags', ids: ['a', 'b'], tags: '데모' }))
    ).rejects.toMatchObject({ status: 400 });
    expect(addTagsSpy).not.toHaveBeenCalled();
  });

  it("op: 'addTags'에서 ids가 배열이 아니면 400이다", async () => {
    await expect(
      PATCH(req({ op: 'addTags', ids: 'a', tags: ['데모'] }))
    ).rejects.toMatchObject({ status: 400 });
    expect(addTagsSpy).not.toHaveBeenCalled();
  });

  it("op: 'removeTags'에서 ids 배열 원소가 문자열이 아니면(숫자 섞임) 400이다", async () => {
    await expect(
      PATCH(req({ op: 'removeTags', ids: ['a', 1], tags: ['데모'] }))
    ).rejects.toMatchObject({ status: 400 });
    expect(removeTagsSpy).not.toHaveBeenCalled();
  });

  it("op: 'removeTags'에서 tags 배열에 빈 문자열이 섞이면 400이다", async () => {
    await expect(
      PATCH(req({ op: 'removeTags', ids: ['a'], tags: ['데모', ''] }))
    ).rejects.toMatchObject({ status: 400 });
    expect(removeTagsSpy).not.toHaveBeenCalled();
  });

  it("op: 'delete'에서 ids가 배열이 아니면 400이고, softDelete를 호출하지 않는다", async () => {
    await expect(PATCH(req({ op: 'delete', ids: 'a' }))).rejects.toMatchObject({ status: 400 });
    expect(softDeleteSpy).not.toHaveBeenCalled();
  });

  it('본문이 객체가 아니면(문자열) 400이다', async () => {
    await expect(PATCH(req('그냥 문자열'))).rejects.toMatchObject({ status: 400 });
  });

  it('본문이 null이면 400이다', async () => {
    await expect(PATCH(req(null))).rejects.toMatchObject({ status: 400 });
  });

  it('본문에 op가 없으면 400이다', async () => {
    await expect(PATCH(req({ id: 'rec-1', title: 'x' }))).rejects.toMatchObject({ status: 400 });
    expect(patchSpy).not.toHaveBeenCalled();
  });
});
