import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Recording } from '$lib/types';

// listAll을 스텁으로 바꿔서, load가 "그 결과를 어떻게 골라 담는지"만
// 검증한다. listAll 자체의 정렬(recordedAt 내림차순)은 recordings.test.ts에서
// 이미 검증됨 — 여기서는 그 정렬 계약을 그대로 흉내내려면 테스트가 직접
// recordedAt 내림차순으로 입력을 준다. 다만 deletedAt 필터만은 이 스텁도
// 실제 listAll처럼 적용한다: load()는 deletedAt을 다시 걷어내지 않고
// listAll의 필터링에 기대므로, 스텁이 그 필터링까지 흉내내지 않으면
// "삭제된 녹음은 어느 쪽에도 없다" 테스트가 load()에게 스스로 걸러내라고
// 요구하는 셈이 되어 버려 그 의존을 못박지 못한다.
let fakeRecordings: Recording[] = [];

vi.mock('$lib/server/store/recordings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/store/recordings')>();
  return {
    ...actual,
    listAll: vi.fn(async () => fakeRecordings.filter((r) => r.deletedAt === null))
  };
});

import { load } from './+page.server';
import * as store from '$lib/server/store/recordings';

const listAllSpy = vi.mocked(store.listAll);

beforeEach(() => {
  listAllSpy.mockClear();
  fakeRecordings = [];
});

function rec(over: Partial<Recording> & { id: string }): Recording {
  return {
    title: '레인',
    description: '',
    tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00',
    durationSec: 125,
    sourceName: `${over.id}.qta`,
    appleAutoTitle: null,
    files: { original: { ext: 'qta', bytes: 100 } },
    bookmarks: [],
    createdAt: '2026-08-31T20:35:00+09:00',
    updatedAt: '2026-08-31T20:35:00+09:00',
    favoritedAt: null,
    deletedAt: null,
    ...over
  };
}

async function loadWith(recs: Recording[]) {
  fakeRecordings = recs;
  const result = await load({} as never);
  // PageServerLoad의 반환 타입에는 void가 섞여 있다(라우트 load 일반이
  // void를 허용하는 SvelteKit 타입 때문) — 실제 구현은 항상 객체를
  // 돌려주므로, any로 덮지 않고 값이 있음을 단언해 이후 접근을 좁힌다.
  if (!result) throw new Error('load가 값을 반환하지 않았다');
  return result;
}

describe('메인 페이지 load', () => {
  it('즐겨찾기를 지정 시각 내림차순 5개로 준다', async () => {
    const recs = [
      rec({ id: 'a', favoritedAt: '2026-09-01T00:00:00+09:00' }),
      rec({ id: 'b', favoritedAt: '2026-09-05T00:00:00+09:00' }),
      rec({ id: 'c', favoritedAt: null }),
      rec({ id: 'd', favoritedAt: '2026-09-03T00:00:00+09:00' })
    ];
    const out = await loadWith(recs);

    expect(out.favorites.map((r: Recording) => r.id)).toEqual(['b', 'd', 'a']);
  });

  it('즐겨찾기가 5개를 넘으면 최근 5개만', async () => {
    const recs = Array.from({ length: 8 }, (_, i) =>
      rec({ id: `f${i}`, favoritedAt: `2026-09-0${i + 1}T00:00:00+09:00` })
    );
    const out = await loadWith(recs);

    expect(out.favorites).toHaveLength(5);
    expect(out.favorites[0].id).toBe('f7');
  });

  it('최근 추가를 createdAt 내림차순 5개로 준다', async () => {
    const recs = [
      rec({ id: 'a', createdAt: '2026-09-01T00:00:00+09:00' }),
      rec({ id: 'b', createdAt: '2026-09-05T00:00:00+09:00' })
    ];
    const out = await loadWith(recs);

    expect(out.recent.map((r: Recording) => r.id)).toEqual(['b', 'a']);
  });

  it('즐겨찾기가 없으면 빈 배열', async () => {
    const out = await loadWith([rec({ id: 'a', favoritedAt: null })]);

    expect(out.favorites).toEqual([]);
  });

  it('삭제된 녹음은 어느 쪽에도 없다', async () => {
    // listAll이 걸러 주지만, 그 사실에 기대고 있다는 것을 못박는다.
    const out = await loadWith([
      rec({
        id: 'gone',
        favoritedAt: '2026-09-05T00:00:00+09:00',
        deletedAt: '2026-09-06T00:00:00+09:00'
      })
    ]);

    expect(out.favorites).toEqual([]);
    expect(out.recent).toEqual([]);
  });

  // --- 같은 초 동률(carried finding) ---
  //
  // nowIso()는 초 단위로만 시각을 찍는다. 즐겨찾기 별을 빠르게 연달아
  // 누르면 favoritedAt이 완전히 같은 문자열이 되고, buildJobs()는 배치
  // 임포트 전체에 같은 createdAt 하나를 찍으므로(runner.ts) createdAt
  // 동률은 오히려 일상적으로 생긴다. 두 경우 다 "동률을 무엇으로 가르는가"가
  // 명시돼야 한다.
  //
  // 여기서 고른 규칙: 추가 비교자를 만들지 않는다. Array.prototype.sort는
  // ES2019+ 명세상 안정 정렬이고, listAll은 이미 recordedAt 내림차순으로
  // 정렬해 돌려준다(compareByRecordedAtDesc). load()는 그 배열을 filter/
  // slice로만 통과시킨 뒤 favoritedAt·createdAt으로 다시 정렬하므로, 1차
  // 키가 같은 항목들은 안정 정렬 덕분에 listAll이 준 순서 — 즉 recordedAt
  // 내림차순 — 를 그대로 유지한다. 그래서 "동률이면 더 최근에 녹음된 쪽이
  // 앞"이라는, 임의가 아닌 규칙이 코드 한 줄 추가 없이 성립한다.
  //
  // 이 테스트는 그 사실이 아니라 그 "규칙"을 못박는다: listAll의 실제
  // 계약대로 이미 recordedAt 내림차순인 입력을 주고, 그 순서가 동률
  // 구간에서도 그대로 보존되는지 4개 항목으로 확인한다(2개짜리면 우연히
  // 맞을 확률이 50%라 약하다).
  it('즐겨찾기 시각이 같으면 recordedAt이 더 최근인 쪽을 앞에 둔다', async () => {
    const tie = '2026-09-08T10:00:00+09:00';
    // listAll 계약대로 recordedAt 내림차순으로 이미 정렬해 준다.
    const recs = [
      rec({ id: 'r4', recordedAt: '2026-09-07T00:00:00+09:00', favoritedAt: tie }),
      rec({ id: 'r3', recordedAt: '2026-09-05T00:00:00+09:00', favoritedAt: tie }),
      rec({ id: 'r2', recordedAt: '2026-09-03T00:00:00+09:00', favoritedAt: tie }),
      rec({ id: 'r1', recordedAt: '2026-09-01T00:00:00+09:00', favoritedAt: tie })
    ];
    const out = await loadWith(recs);

    expect(out.favorites.map((r: Recording) => r.id)).toEqual(['r4', 'r3', 'r2', 'r1']);
  });

  it('생성 시각이 같으면(배치 임포트) recordedAt이 더 최근인 쪽을 앞에 둔다', async () => {
    const tie = '2026-09-08T10:00:00+09:00';
    const recs = [
      rec({ id: 'c4', recordedAt: '2026-09-07T00:00:00+09:00', createdAt: tie }),
      rec({ id: 'c3', recordedAt: '2026-09-05T00:00:00+09:00', createdAt: tie }),
      rec({ id: 'c2', recordedAt: '2026-09-03T00:00:00+09:00', createdAt: tie }),
      rec({ id: 'c1', recordedAt: '2026-09-01T00:00:00+09:00', createdAt: tie })
    ];
    const out = await loadWith(recs);

    expect(out.recent.map((r: Recording) => r.id)).toEqual(['c4', 'c3', 'c2', 'c1']);
  });
});
