import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';
import type { Recording } from '$lib/types';

// config는 모듈이 처음 불릴 때 process.env로 만들어지는 싱글턴이라, 아무것도
// 안 하면 개발자의 실제 data/를 가리킨다. 아래에서 listAll/allTags를 일부러
// 실제 구현으로 두기 때문에, 그대로 두면 이 파일의 단언이 "앱을 한 번도 안
// 돌린 기계"에서만 참이 된다 — 실제로 269개가 든 data/recordings.json을 읽어
// 실패했다. vi.hoisted는 import보다 먼저 실행되므로, config가 만들어지기 전에
// 존재하지 않는 임시 경로로 돌려놓는다(readJson이 ENOENT에서 fallback을
// 돌려주므로 파일을 만들 필요는 없다).
vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/uls-api-recordings-test-${process.pid}`;
});

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

/** PATCH를 호출해 Response를 돌려준다. 성공 시엔 resolve, 검증 실패(400) 시엔 reject한다 — 이 라우트의 badRequest가 실제로 throw하기 때문이다. */
function patchRequest(body: unknown) {
  return PATCH(req(body));
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

// patch/addTags/removeTags/softDelete와 달리 setFavorite은 스텁으로 바꾸지 않는다
// (위 vi.mock 참고) — 클라이언트가 보낸 favoritedAt이 실제로 무시되는지는
// 실제 저장소를 거쳐야만 확인할 수 있기 때문이다. 그래서 이 describe만
// 실제 파일에 씨앗 데이터를 심고 각 테스트 뒤에 치운다.
describe('favorite op', () => {
  const seed: Recording = {
    id: 'r1',
    title: '녹음1',
    description: '',
    tags: [],
    recordedAt: '2026-01-01T00:00:00+09:00',
    durationSec: 10,
    sourceName: 'r1.qta',
    appleAutoTitle: null,
    files: {},
    bookmarks: [],
    createdAt: '2026-01-01T00:00:00+09:00',
    updatedAt: '2026-01-01T00:00:00+09:00',
    favoritedAt: null,
    deletedAt: null
  };

  beforeEach(async () => {
    await store.addMany(config, [seed]);
  });

  afterEach(async () => {
    await fs.rm(path.join(config.dataDir, 'recordings.json'), { force: true });
  });

  it('지정하면 favoritedAt에 시각이 들어간다', async () => {
    const res = await patchRequest({ op: 'favorite', id: 'r1', favorite: true });
    expect(res.status).toBe(200);

    const body = await res.json();
    const rec = body.recordings.find((r: Recording) => r.id === 'r1');
    expect(rec.favoritedAt).not.toBe(null);
  });

  it('해제하면 null이 된다', async () => {
    await patchRequest({ op: 'favorite', id: 'r1', favorite: true });

    const res = await patchRequest({ op: 'favorite', id: 'r1', favorite: false });

    const body = await res.json();
    const rec = body.recordings.find((r: Recording) => r.id === 'r1');
    expect(rec.favoritedAt).toBe(null);
  });

  it('클라이언트가 보낸 favoritedAt은 무시한다', async () => {
    // 시각을 클라이언트가 정할 수 있으면 메인 카드의 "최근 5개" 순서를
    // 조작할 수 있다.
    const res = await patchRequest({
      op: 'favorite',
      id: 'r1',
      favorite: true,
      favoritedAt: '2000-01-01T00:00:00.000Z'
    });

    const body = await res.json();
    const rec = body.recordings.find((r: Recording) => r.id === 'r1');
    expect(rec.favoritedAt).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('favorite이 불리언이 아니면 400', async () => {
    // status만 보면 op을 못 알아본 기본 분기("알 수 없는 작업입니다")도 400을
    // 돌려주므로 통과해버린다 — favorite 검증 분기가 실제로 이 입력을 잡았는지
    // 확인하려면 그 분기가 내는 메시지까지 비교해야 한다.
    await expect(
      patchRequest({ op: 'favorite', id: 'r1', favorite: 'yes' })
    ).rejects.toMatchObject({ status: 400, body: { message: 'favorite은 true/false여야 합니다' } });
  });

  it('id가 없으면 400', async () => {
    await expect(patchRequest({ op: 'favorite', favorite: true })).rejects.toMatchObject({
      status: 400,
      body: { message: 'id가 필요합니다' }
    });
  });
});

describe('PATCH /api/recordings - patch op의 필드 화이트리스트 (carried Critical finding)', () => {
  // Task 1이 Patchable에 favoritedAt을 더하면서, patch 핸들러가 body를 그대로
  // 스프레드하던 기존 버릇이 exploitable해졌다: `{ op:'patch', id, favoritedAt }`을
  // 보내면 클라이언트가 즐겨찾기 시각을 마음대로 정할 수 있었다(메인 카드
  // "최근 5개" 순서 조작 가능). 이 테스트는 patch로 전달되는 changes에
  // favoritedAt이 (다른 허용 필드가 섞여 있어도) 절대 포함되지 않음을 고정한다.
  it("op: 'patch' 요청에 favoritedAt이 섞여 있어도 patch에 전달되는 changes에는 포함되지 않는다", async () => {
    await patchRequest({
      op: 'patch',
      id: 'rec-1',
      title: '제목',
      favoritedAt: '2099-01-01T00:00:00+09:00'
    });

    expect(patchSpy).toHaveBeenCalledWith(config, 'rec-1', { title: '제목' });
  });
});
