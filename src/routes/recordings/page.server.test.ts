import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Recording } from '$lib/types';
import type { PageServerLoad } from './$types';

// listAll·allTags를 스텁으로 바꿔서, load가 "그 결과를 그대로 조립해
// 돌려주는지"만 검증한다. 각 함수 자체의 동작(정렬·소프트 삭제 제외 등)은
// recordings.test.ts에서 이미 검증됨.
const fakeRecordings: Recording[] = [
  {
    id: 'rec-1', title: '레인', description: '', tags: ['데모'],
    recordedAt: '2026-07-09T22:36:13+09:00', durationSec: 274.2, sourceName: 's1.qta',
    appleAutoTitle: '화양동', files: { original: { ext: 'qta', bytes: 100 } }, bookmarks: [],
    createdAt: '2026-08-31T20:35:00+09:00', updatedAt: '2026-08-31T20:35:00+09:00', deletedAt: null
  },
  {
    id: 'rec-2', title: '정류장', description: '', tags: [],
    recordedAt: '2026-07-15T10:00:00+09:00', durationSec: 12, sourceName: 's2.qta',
    appleAutoTitle: null, files: {}, bookmarks: [],
    createdAt: '2026-08-31T20:35:00+09:00', updatedAt: '2026-08-31T20:35:00+09:00', deletedAt: null
  }
];
const fakeTags = [{ tag: '데모', count: 1 }];

vi.mock('$lib/server/store/recordings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/store/recordings')>();
  return {
    ...actual,
    listAll: vi.fn(async () => fakeRecordings),
    allTags: vi.fn(async () => fakeTags)
  };
});

import { load } from './+page.server';
import { config } from '$lib/server/config';
import * as store from '$lib/server/store/recordings';

const listAllSpy = vi.mocked(store.listAll);
const allTagsSpy = vi.mocked(store.allTags);

beforeEach(() => {
  listAllSpy.mockClear();
  allTagsSpy.mockClear();
});

function event() {
  return {} as unknown as Parameters<PageServerLoad>[0];
}

describe('+page.server load', () => {
  it('listAll·allTags 결과와 설정된 포맷 이름 목록을 config로 조회해 그대로 돌려준다', async () => {
    const result = await load(event());
    // PageServerLoad의 반환 타입에는 void가 섞여 있다(라우트 load 일반이
    // void를 허용하는 SvelteKit 타입 때문) — 실제 구현은 항상 객체를
    // 돌려주므로, any로 덮지 않고 값이 있음을 단언해 이후 접근을 좁힌다.
    if (!result) throw new Error('load가 값을 반환하지 않았다');

    expect(listAllSpy).toHaveBeenCalledWith(config);
    expect(allTagsSpy).toHaveBeenCalledWith(config);
    expect(result.recordings).toEqual(fakeRecordings);
    expect(result.tags).toEqual(fakeTags);
    expect(result.formats).toEqual(config.formats.map((f) => f.name));
  });

  it('recordings가 비어 있어도(빈 스토어) 빈 배열을 그대로 내보낸다', async () => {
    listAllSpy.mockResolvedValueOnce([]);
    allTagsSpy.mockResolvedValueOnce([]);

    const result = await load(event());
    if (!result) throw new Error('load가 값을 반환하지 않았다');

    expect(result.recordings).toEqual([]);
    expect(result.tags).toEqual([]);
    // 포맷 목록은 recordings/tags와 무관하게 항상 config에서 온다 —
    // 빈 스토어일 때 formats까지 함께 비어버리면 가져오기 화면 등에서
    // 변환 포맷을 고를 수 없게 된다.
    expect(result.formats).toEqual(config.formats.map((f) => f.name));
    expect(result.formats.length).toBeGreaterThan(0);
  });
});
