# 목록 검색·필터 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검색창을 메뉴바에서 목록 화면으로 되돌리고, 검색 범위 선택기와 확장자 필터를 더하면서, 두 화면이 같은 URL을 고치느라 필요했던 브리지 모듈을 걷어낸다.

**Architecture:** 순수 모듈(확장자 집계 → 필터 모델)을 먼저 세우고, 그 위에 컴포넌트(SearchBar 신규, FilterBar 확장)를 얹은 뒤, 마지막에 화면 배선을 한 번에 바꾼다. 검색창 이동은 쪼갤 수 없다 — 목록에 넣는 것과 메뉴바에서 빼는 것이 따로 커밋되면 그사이에 검색창이 둘이거나 없다.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), TypeScript, Tailwind + Skeleton, Vitest(browser+node 두 프로젝트), Playwright.

## Global Constraints

- 검색 범위 값은 정확히 `'all' | 'title' | 'description' | 'tags'` 네 개이며, UI 라벨은 각각 `전체`·`제목`·`설명`·`태그`다.
- URL 파라미터 이름: 검색 범위는 `scope`, 확장자는 `ext`. 기본값 `all`은 URL에 싣지 않는다. 확장자는 값마다 파라미터를 하나씩 붙인다(`ext=qta&ext=mp3`) — 쉼표는 구분자가 아니다.
- 확장자 필터는 **AND**다 — 고른 것을 모두 가진 녹음만 통과한다. 모드 토글은 만들지 않는다.
- 녹음 하나의 확장자 집합 = 원본 확장자 ∪ 변환 완료된 포맷 이름.
- 검색어 비교는 `trim()` 후 소문자 부분 일치다. `tags` 범위는 개별 태그 문자열에 부분 일치한다(정확 일치 아님).
- 디바운스는 250ms. Enter는 대기를 건너뛴다. 한글 조합 중 Enter(`isComposing === true`)는 무시한다.
- 범위 선택 변경은 디바운스 없이 즉시 반영한다.
- 필터를 URL에 반영하는 `goto`는 `+page.svelte`의 필터 → URL 이펙트 **하나뿐**이어야 한다. 어떤 태스크도 두 번째 `goto` 호출자를 만들지 않는다.
- 확장자 칩 개수는 화면에서 `recordings`로부터 파생한다. `+page.server.ts`는 건드리지 않는다.
- 이 저장소의 컴포넌트 테스트는 `+layout.svelte` 없이 마운트되어 Tailwind가 적용되지 않는다. 배치나 접근 이름을 재는 테스트는 `app.css`를 직접 import하는 별도 파일에 둔다.
- 테스트 파일 이름 규칙: `*.svelte.test.ts`는 브라우저 프로젝트, 그 밖의 `*.test.ts`는 node 프로젝트에서 돈다.

## File Structure

| 파일 | 책임 | 처리 |
|---|---|---|
| `src/lib/extensions.ts` | 녹음의 확장자 집합, 칩용 집계·정렬 | 신규 |
| `src/lib/extensions.test.ts` | 위 모듈의 단위 테스트 | 신규 |
| `src/lib/types.ts` | `SearchScope` 타입, `Filter.scope`·`Filter.ext` | 수정 |
| `src/lib/filter.ts` | 순수 필터 판정과 URL 왕복 | 수정 |
| `src/lib/filter.test.ts` | 위 모듈의 단위 테스트 | 수정 |
| `src/lib/components/SearchBar.svelte` | 검색어 입력·디바운스·범위 선택기·결과 카운트 | 신규 |
| `src/lib/components/SearchBar.svelte.test.ts` | 위 컴포넌트의 테스트 | 신규 |
| `src/lib/components/FilterBar.svelte` | 기간·확장자 칩·태그 칩·초기화 | 수정 |
| `src/lib/components/FilterBar.svelte.test.ts` | 확장자 칩과 초기화 테스트 | 신규 |
| `src/lib/components/MenuBar.svelte` | 로고와 메인/리스트 버튼만 | 수정(검색 제거) |
| `src/lib/components/MenuBar.svelte.test.ts` | 검색 관련 테스트 제거 | 수정 |
| `src/routes/+layout.svelte` | 메뉴바 렌더만 | 수정(`search()` 제거) |
| `src/routes/recordings/+page.svelte` | 화면 배선과 배치 | 수정 |
| `src/routes/recordings/page.svelte.test.ts` | 브리지 관련 테스트 정리 | 수정 |
| `src/lib/listFilterBridge.ts` | — | **삭제** |
| `src/lib/searchQuery.ts` | — | **삭제** |
| `src/lib/searchQuery.test.ts` | — | **삭제** |
| `tests/e2e/import-flow.spec.ts` | 검색 관련 4개 재작업 | 수정 |

---

### Task 1: 확장자 집계 모듈

녹음이 가진 확장자를 뽑고 칩용으로 집계하는 순수 모듈. 다음 태스크의 `applyFilter`가 이것을 쓴다.

**Files:**
- Create: `src/lib/extensions.ts`
- Test: `src/lib/extensions.test.ts`

**Interfaces:**
- Consumes: `Recording`, `FileEntry` (`src/lib/types.ts`). `Recording.files`는 `Record<string, FileEntry>`이고 키는 `'original'` 또는 포맷 이름(`'mp3'`, `'wav'`)이다. `'original'` 항목만 실제 확장자를 `ext` 필드에 갖는다(`{ ext?: string; bytes: number }`).
- Produces:
  - `recordingExtensions(rec: Recording): string[]`
  - `interface ExtensionCount { ext: string; count: number; original: boolean }`
  - `extensionCounts(recs: Recording[]): ExtensionCount[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/extensions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Recording } from './types';
import { recordingExtensions, extensionCounts } from './extensions';

function rec(id: string, files: Recording['files']): Recording {
  return {
    id, title: 't', description: '', tags: [],
    recordedAt: '2026-07-09T22:36:13+09:00', durationSec: 1, sourceName: 's',
    appleAutoTitle: null, files, bookmarks: [],
    createdAt: '', updatedAt: '', deletedAt: null
  };
}

const qta = rec('1', { original: { ext: 'qta', bytes: 1 }, mp3: { bytes: 1 }, wav: { bytes: 1 } });
const m4a = rec('2', { original: { ext: 'm4a', bytes: 1 }, mp3: { bytes: 1 }, wav: { bytes: 1 } });
/** 변환이 깨져 mp3가 없는 녹음. 이 필터의 실제 용도가 이것이다. */
const broken = rec('3', { original: { ext: 'qta', bytes: 1 }, wav: { bytes: 1 } });

describe('recordingExtensions', () => {
  it('원본 확장자와 변환 포맷 이름을 함께 돌려준다', () => {
    expect(recordingExtensions(qta).sort()).toEqual(['mp3', 'qta', 'wav']);
  });

  it('없는 포맷은 빠진다', () => {
    expect(recordingExtensions(broken).sort()).toEqual(['qta', 'wav']);
  });

  it('original에 ext가 없으면 그 항목만 건너뛴다', () => {
    const noExt = rec('4', { original: { bytes: 1 }, mp3: { bytes: 1 } });
    expect(recordingExtensions(noExt)).toEqual(['mp3']);
  });

  it('원본 확장자가 변환 포맷과 같아도 중복으로 세지 않는다', () => {
    const wavOriginal = rec('5', { original: { ext: 'wav', bytes: 1 }, wav: { bytes: 1 } });
    expect(recordingExtensions(wavOriginal)).toEqual(['wav']);
  });
});

describe('extensionCounts', () => {
  it('확장자별 개수를 센다', () => {
    const counts = extensionCounts([qta, m4a, broken]);
    expect(Object.fromEntries(counts.map((c) => [c.ext, c.count]))).toEqual({
      qta: 2, m4a: 1, mp3: 2, wav: 3
    });
  });

  it('원본 확장자가 변환 포맷보다 앞에 온다', () => {
    const order = extensionCounts([qta, m4a, broken]).map((c) => c.ext);
    // qta(2) m4a(1)이 원본 묶음, 그 안에서 개수 내림차순.
    // wav(3) mp3(2)가 변환 묶음 — wav가 mp3보다 많아도 원본 뒤다.
    expect(order).toEqual(['qta', 'm4a', 'wav', 'mp3']);
  });

  it('어느 녹음에서든 원본으로 쓰인 확장자는 원본 묶음에 든다', () => {
    const wavOriginal = rec('5', { original: { ext: 'wav', bytes: 1 }, wav: { bytes: 1 } });
    const counts = extensionCounts([qta, wavOriginal]);
    expect(counts.find((c) => c.ext === 'wav')?.original).toBe(true);
    expect(counts[0].ext).toBe('wav');
  });

  it('빈 목록은 빈 배열', () => {
    expect(extensionCounts([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/extensions.test.ts`
Expected: FAIL — `Failed to resolve import "./extensions"`

- [ ] **Step 3: 모듈을 만든다**

`src/lib/extensions.ts`:

```ts
import type { Recording } from './types';

/**
 * 녹음 하나가 가진 확장자 집합 — 원본 확장자와 변환 완료된 포맷 이름의
 * 합집합이다. files의 키는 'original' 또는 포맷 이름('mp3','wav')이고,
 * 'original'만 실제 확장자를 ext 필드에 따로 갖는다(변환본은 포맷
 * 이름이 곧 확장자다).
 *
 * 원본을 .wav로 올린 녹음처럼 원본 확장자와 포맷 이름이 겹칠 수 있어
 * 중복을 걸러낸다.
 */
export function recordingExtensions(rec: Recording): string[] {
  const out: string[] = [];
  for (const [key, entry] of Object.entries(rec.files ?? {})) {
    const ext = key === 'original' ? entry?.ext : key;
    if (ext && !out.includes(ext)) out.push(ext);
  }
  return out;
}

export interface ExtensionCount {
  ext: string;
  count: number;
  /** 어느 녹음에서든 원본 확장자로 등장했는가 — 칩 정렬에 쓴다. */
  original: boolean;
}

/**
 * 칩 목록용 집계. 원본 확장자를 앞에 두는 것은 그것이 사용자가 실제로
 * 구분하려는 값이기 때문이다 — 변환 포맷은 거의 모든 녹음이 공유해
 * 뒤에 있어도 찾기 쉽다.
 */
export function extensionCounts(recs: Recording[]): ExtensionCount[] {
  const map = new Map<string, ExtensionCount>();

  for (const rec of recs) {
    const originalExt = rec.files?.original?.ext;
    for (const ext of recordingExtensions(rec)) {
      const cur = map.get(ext) ?? { ext, count: 0, original: false };
      cur.count += 1;
      if (ext === originalExt) cur.original = true;
      map.set(ext, cur);
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      Number(b.original) - Number(a.original) ||
      b.count - a.count ||
      a.ext.localeCompare(b.ext)
  );
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/extensions.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/extensions.ts src/lib/extensions.test.ts
git commit -m "feat: 녹음의 확장자 집합과 칩용 집계 모듈"
```

---

### Task 2: 필터 모델에 검색 범위와 확장자를 더한다

**Files:**
- Modify: `src/lib/types.ts` (`Filter` 인터페이스, `SearchScope` 타입 추가)
- Modify: `src/lib/filter.ts` (`EMPTY_FILTER`, `applyFilter`, `filterFromParams`, `filterToParams`)
- Test: `src/lib/filter.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `recordingExtensions(rec: Recording): string[]` (Task 1, `$lib/extensions`).
- Produces:
  - `type SearchScope = 'all' | 'title' | 'description' | 'tags'` (`$lib/types`)
  - `Filter`에 `scope: SearchScope`와 `ext: string[]` 추가. 기존 필드(`q`, `tags`, `tagMode`, `from`, `to`)는 그대로.
  - `EMPTY_FILTER`가 `{ q: '', scope: 'all', tags: [], tagMode: 'and', ext: [], from: '', to: '' }`

**중요:** `EMPTY_FILTER`는 `+page.svelte`와 `FilterBar.svelte`의 초기화 버튼이 함께 쓴다. `FilterBar`의 초기화는 지금 객체 리터럴을 직접 쓰고 있는데(`{ q: '', tags: [], tagMode: 'and', from: '', to: '' }`), Task 4에서 `EMPTY_FILTER`를 쓰도록 고친다. 이 태스크에서는 건드리지 않는다 — 이 태스크가 끝난 시점의 `FilterBar` 초기화는 `scope`·`ext`를 빠뜨린 채로 남아 있고, 그것이 Task 4가 고칠 대상이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/filter.test.ts`의 기존 `rec()` 헬퍼는 `files: {}`를 쓴다. 확장자 테스트를 위해 `files`를 넘길 수 있어야 하는데 `rec()`는 이미 `Partial<Recording>`을 받으므로 그대로 쓸 수 있다.

파일 끝에 다음을 추가한다:

```ts
describe('검색 범위', () => {
  const scoped = [
    rec({ id: 'T', title: '레인', description: '', tags: [] }),
    rec({ id: 'D', title: '무제', description: '레인 코트를 입고', tags: [] }),
    rec({ id: 'G', title: '무제', description: '', tags: ['레인보우'] })
  ];
  const scopedIds = (f: Partial<Filter>) =>
    applyFilter(scoped, { ...EMPTY_FILTER, ...f }).map((r) => r.id);

  it('all은 제목·설명·태그 어디에 있어도 걸린다', () => {
    expect(scopedIds({ q: '레인', scope: 'all' })).toEqual(['T', 'D', 'G']);
  });

  it('title은 제목만 본다', () => {
    expect(scopedIds({ q: '레인', scope: 'title' })).toEqual(['T']);
  });

  it('description은 설명만 본다', () => {
    expect(scopedIds({ q: '레인', scope: 'description' })).toEqual(['D']);
  });

  it('tags는 개별 태그에 부분 일치한다', () => {
    // '레인'으로 '레인보우'가 걸린다 — 칩 필터의 정확 일치와 다른 점이다.
    expect(scopedIds({ q: '레인', scope: 'tags' })).toEqual(['G']);
  });

  it('빈 검색어면 범위와 무관하게 전부 통과한다', () => {
    expect(scopedIds({ q: '   ', scope: 'title' })).toEqual(['T', 'D', 'G']);
  });
});

describe('확장자 필터', () => {
  const withFiles = [
    rec({ id: 'A', files: { original: { ext: 'qta', bytes: 1 }, mp3: { bytes: 1 }, wav: { bytes: 1 } } }),
    rec({ id: 'B', files: { original: { ext: 'm4a', bytes: 1 }, mp3: { bytes: 1 }, wav: { bytes: 1 } } }),
    rec({ id: 'C', files: { original: { ext: 'qta', bytes: 1 }, wav: { bytes: 1 } } })
  ];
  const extIds = (ext: string[]) =>
    applyFilter(withFiles, { ...EMPTY_FILTER, ext }).map((r) => r.id);

  it('빈 배열이면 전부 통과한다', () => {
    expect(extIds([])).toEqual(['A', 'B', 'C']);
  });

  it('원본 확장자로 거른다', () => {
    expect(extIds(['m4a'])).toEqual(['B']);
  });

  it('변환 포맷으로 거른다 — 변환이 깨진 녹음이 빠진다', () => {
    expect(extIds(['mp3'])).toEqual(['A', 'B']);
  });

  it('여러 개는 AND — 모두 가진 것만 남는다', () => {
    expect(extIds(['qta', 'mp3'])).toEqual(['A']);
  });

  it('함께 가질 수 없는 조합은 0건이다', () => {
    expect(extIds(['qta', 'm4a'])).toEqual([]);
  });
});

describe('URL 왕복 — scope와 ext', () => {
  it('기본값 all은 URL에 싣지 않는다', () => {
    expect(filterToParams({ ...EMPTY_FILTER, q: '레인' }).toString()).toBe('q=%EB%A0%88%EC%9D%B8');
  });

  it('all이 아닌 범위는 싣는다', () => {
    const p = filterToParams({ ...EMPTY_FILTER, q: 'x', scope: 'tags' });
    expect(p.get('scope')).toBe('tags');
  });

  it('확장자는 값마다 파라미터를 하나씩 붙인다', () => {
    const p = filterToParams({ ...EMPTY_FILTER, ext: ['qta', 'mp3'] });
    expect(p.getAll('ext')).toEqual(['qta', 'mp3']);
  });

  it('scope와 ext를 읽어들인다', () => {
    const f = filterFromParams(new URLSearchParams('q=x&scope=description&ext=qta&ext=mp3'));
    expect(f.scope).toBe('description');
    expect(f.ext).toEqual(['qta', 'mp3']);
  });

  it('모르는 scope는 all로 떨어진다', () => {
    expect(filterFromParams(new URLSearchParams('scope=xyz')).scope).toBe('all');
  });

  it('scope가 없으면 all이다', () => {
    expect(filterFromParams(new URLSearchParams('q=x')).scope).toBe('all');
  });

  it('빈 ext 값은 버린다', () => {
    expect(filterFromParams(new URLSearchParams('ext=&ext=+&ext=qta')).ext).toEqual(['qta']);
  });

  it('왕복이 자기 자신으로 돌아온다', () => {
    const f: Filter = {
      q: '레인', scope: 'tags', tags: ['데모'], tagMode: 'or',
      ext: ['qta', 'mp3'], from: '2026-01-01', to: '2026-12-31'
    };
    expect(filterFromParams(filterToParams(f))).toEqual(f);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/filter.test.ts`
Expected: FAIL — `scope`·`ext`가 `Filter`에 없어 타입 에러가 나고, `applyFilter`가 범위를 무시해 `title` 테스트가 `['T','D','G']`를 돌려준다.

- [ ] **Step 3: 타입을 넓힌다**

`src/lib/types.ts`의 `TagMode` 선언 바로 아래에 추가하고 `Filter`를 고친다:

```ts
export type TagMode = 'and' | 'or';

export type SearchScope = 'all' | 'title' | 'description' | 'tags';

export interface Filter {
  q: string;
  /** 검색어를 어디에 맞춰볼지. 'all'은 제목·설명·태그를 함께 본다. */
  scope: SearchScope;
  tags: string[];
  tagMode: TagMode;
  /**
   * 원본 확장자와 변환 포맷 이름이 섞여 들어온다. 여럿이면 AND —
   * 모두 가진 녹음만 통과한다.
   */
  ext: string[];
  /** YYYY-MM-DD, 포함 */
  from: string;
  /** YYYY-MM-DD, 포함 */
  to: string;
}
```

- [ ] **Step 4: 필터를 고친다**

`src/lib/filter.ts` 전체:

```ts
import type { Filter, Recording, SearchScope, TagMode } from './types';
import { recordingExtensions } from './extensions';

export const EMPTY_FILTER: Filter = {
  q: '', scope: 'all', tags: [], tagMode: 'and', ext: [], from: '', to: ''
};
Object.freeze(EMPTY_FILTER.tags);
Object.freeze(EMPTY_FILTER.ext);
Object.freeze(EMPTY_FILTER);

const SCOPES: readonly SearchScope[] = ['all', 'title', 'description', 'tags'];

/** recordedAt의 날짜 부분만 뽑는다. 오프셋이 붙어 있으므로 앞 10글자가 로컬 날짜다. */
function localDate(recordedAt: string): string {
  return recordedAt.slice(0, 10);
}

/** q는 이미 trim + 소문자로 정규화된 상태로 들어온다. */
function matchesQuery(r: Recording, q: string, scope: SearchScope): boolean {
  const hit = (s: string) => s.toLowerCase().includes(q);
  switch (scope) {
    case 'title':
      return hit(r.title);
    case 'description':
      return hit(r.description);
    // 칩 필터의 정확 일치와 달리 개별 태그에 부분 일치한다 —
    // 기억나는 조각으로 찾는 것이 검색의 목적이다.
    case 'tags':
      return r.tags.some(hit);
    case 'all':
      return hit(r.title) || hit(r.description) || r.tags.some(hit);
  }
}

export function applyFilter(recs: Recording[], f: Filter): Recording[] {
  const q = f.q.trim().toLowerCase();
  const tags = f.tags.filter(Boolean);
  const exts = f.ext.filter(Boolean);

  return recs.filter((r) => {
    if (q && !matchesQuery(r, q, f.scope)) return false;

    if (tags.length) {
      const has = (t: string) => r.tags.includes(t);
      if (f.tagMode === 'and' ? !tags.every(has) : !tags.some(has)) return false;
    }

    if (exts.length) {
      const owned = recordingExtensions(r);
      if (!exts.every((e) => owned.includes(e))) return false;
    }

    const d = localDate(r.recordedAt);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;

    return true;
  });
}

export function filterFromParams(params: URLSearchParams): Filter {
  const mode = params.get('mode');
  const scope = params.get('scope');
  const trimmed = (name: string) =>
    params.getAll(name).map((s) => s.trim()).filter(Boolean);

  return {
    q: params.get('q') ?? '',
    scope: (SCOPES.includes(scope as SearchScope) ? scope : 'all') as SearchScope,
    tags: trimmed('tags'),
    tagMode: (mode === 'or' ? 'or' : 'and') as TagMode,
    ext: trimmed('ext'),
    from: params.get('from') ?? '',
    to: params.get('to') ?? ''
  };
}

export function filterToParams(f: Filter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  // 기본값은 싣지 않는다 — q=만 있는 기존 링크가 그대로 동작해야 한다.
  if (f.scope !== 'all') p.set('scope', f.scope);
  // Append each tag as a separate parameter; commas are tag content, never separators.
  for (const tag of f.tags) {
    p.append('tags', tag);
  }
  if (f.tagMode === 'or') p.set('mode', 'or');
  for (const ext of f.ext) {
    p.append('ext', ext);
  }
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  return p;
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/filter.test.ts`
Expected: PASS — 기존 테스트 전부 + 새로 더한 21개

기존 테스트 중 `EMPTY_FILTER`를 펼쳐 쓰는 것들은 새 필드가 기본값으로 채워져 그대로 통과한다.

- [ ] **Step 6: 타입 검사**

Run: `npm run check`
Expected: `+page.svelte`와 `FilterBar.svelte`의 초기화 객체 리터럴에서 `scope`·`ext` 누락 에러가 날 수 있다. 그 두 곳은 Task 4·5가 고친다 — **이 태스크에서는 `FilterBar.svelte`의 초기화 리터럴만** `{ ...EMPTY_FILTER }`로 바꿔 타입을 맞춘다(동작은 Task 4에서 검증한다).

`src/lib/components/FilterBar.svelte`에서:

```svelte
<script lang="ts">
  import type { Filter } from '$lib/types';
  import { EMPTY_FILTER } from '$lib/filter';
```

그리고 초기화 버튼의 `onclick`을 바꾼다:

```svelte
      onclick={() => (filter = { ...EMPTY_FILTER })}>
```

Run: `npm run check`
Expected: 에러 0

- [ ] **Step 7: 커밋**

```bash
git add src/lib/types.ts src/lib/filter.ts src/lib/filter.test.ts src/lib/components/FilterBar.svelte
git commit -m "feat: 필터에 검색 범위와 확장자 조건 추가"
```

---

### Task 3: SearchBar 컴포넌트

검색어 입력·디바운스·범위 선택기·결과 카운트를 갖는 새 컴포넌트. 이 태스크에서는 만들기만 하고 아무 화면에도 붙이지 않는다 — Task 5가 붙인다.

**Files:**
- Create: `src/lib/components/SearchBar.svelte`
- Test: `src/lib/components/SearchBar.svelte.test.ts`

**Interfaces:**
- Consumes: `Filter`, `SearchScope` (`$lib/types`, Task 2).
- Produces: `SearchBar` 컴포넌트. props는 `filter`($bindable), `total: number`, `shown: number`.

**참고 — 이 저장소의 컴포넌트 테스트 관례:** `vitest-browser-svelte`의 Locator에는 Playwright식 `press()`가 없다. 실제 엘리먼트에 `KeyboardEvent`를 직접 디스패치한다(`TagInput.svelte.test.ts`, `page.svelte.test.ts`가 같은 방식). `$bindable` prop은 `$state` 객체에 getter/setter를 씌워 넘긴다(`TagInput.svelte.test.ts`의 `setup()` 참고).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/components/SearchBar.svelte.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Filter } from '$lib/types';
import { EMPTY_FILTER } from '$lib/filter';
import SearchBar from './SearchBar.svelte';

const DEBOUNCE_MS = 250;

/** 디바운스가 확실히 지나가도록 여유를 둔다. */
const afterDebounce = () => new Promise((r) => setTimeout(r, DEBOUNCE_MS + 60));
const tick = () => new Promise((r) => setTimeout(r, 0));

function enterKey(isComposing: boolean): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true, isComposing
  } as KeyboardEventInit);
}

/** bind:value가 반응하도록 실제 input 이벤트로 값을 넣는다. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function setup(initial: Partial<Filter> = {}) {
  const state = $state({ filter: { ...EMPTY_FILTER, ...initial } as Filter });
  render(SearchBar, {
    get filter() {
      return state.filter;
    },
    set filter(next: Filter) {
      state.filter = next;
    },
    total: 269,
    shown: 42
  });
  const input = (await page.getByPlaceholder('검색어').element()) as HTMLInputElement;
  return { state, input };
}

describe('SearchBar — 디바운스', () => {
  it('타이핑 직후에는 아직 반영하지 않는다', async () => {
    const { state, input } = await setup();
    type(input, '레인');
    await tick();
    expect(state.filter.q).toBe('');
  });

  it('입력이 멈추면 반영한다', async () => {
    const { state, input } = await setup();
    type(input, '레인');
    await afterDebounce();
    expect(state.filter.q).toBe('레인');
  });

  it('Enter는 대기를 건너뛴다', async () => {
    const { state, input } = await setup();
    type(input, '레인');
    input.dispatchEvent(enterKey(false));
    await tick();
    expect(state.filter.q).toBe('레인');
  });

  it('한글 조합 중 Enter는 커밋하지 않는다', async () => {
    const { state, input } = await setup();
    type(input, '정준일');
    input.dispatchEvent(enterKey(true));
    await tick();
    expect(state.filter.q).toBe('');
  });
});

describe('SearchBar — 범위 선택', () => {
  it('네 범위를 모두 고를 수 있다', async () => {
    await setup();
    const select = page.getByLabel('검색 범위');
    await expect.element(select).toBeInTheDocument();
    const labels = [...(await select.element()).querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toEqual(['전체', '제목', '설명', '태그']);
  });

  it('범위 변경은 디바운스 없이 즉시 반영된다', async () => {
    const { state } = await setup();
    const select = (await page.getByLabel('검색 범위').element()) as HTMLSelectElement;
    select.value = 'tags';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(state.filter.scope).toBe('tags');
  });

  it('범위를 바꾸면 대기 중이던 검색어도 함께 커밋된다', async () => {
    // 범위만 즉시 바뀌고 검색어가 옛 값으로 남으면, 사용자가 보는
    // 결과는 "새 범위 + 옛 검색어"라는 아무도 요청하지 않은 조합이 된다.
    const { state, input } = await setup();
    type(input, '레인');
    const select = (await page.getByLabel('검색 범위').element()) as HTMLSelectElement;
    select.value = 'title';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(state.filter).toMatchObject({ q: '레인', scope: 'title' });
  });
});

describe('SearchBar — 바깥에서의 변경', () => {
  it('filter.q가 밖에서 비워지면 입력창도 비워진다', async () => {
    // 초기화 버튼이 이 경로를 쓴다.
    const { state, input } = await setup({ q: '레인' });
    expect(input.value).toBe('레인');
    state.filter = { ...EMPTY_FILTER };
    await tick();
    expect(input.value).toBe('');
  });
});

describe('SearchBar — 결과 카운트', () => {
  it('걸러진 개수와 전체 개수를 보여준다', async () => {
    await setup();
    await expect.element(page.getByText('42 / 269')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project client src/lib/components/SearchBar.svelte.test.ts`
Expected: FAIL — `Failed to resolve import "./SearchBar.svelte"`

- [ ] **Step 3: 컴포넌트를 만든다**

`src/lib/components/SearchBar.svelte`:

```svelte
<script lang="ts">
  import type { Filter, SearchScope } from '$lib/types';

  let { filter = $bindable<Filter>(), total = 0, shown = 0 } = $props();

  /**
   * 글자마다 URL을 바꾸면 렌더가 과하게 돈다. 사람이 한 단어를 치는
   * 사이보다는 길고, 다 치고 멈췄을 때 기다렸다는 느낌은 안 들 만큼
   * 짧게 잡았다. Enter는 이 대기를 건너뛴다.
   */
  const SEARCH_DEBOUNCE_MS = 250;

  const SCOPES: { value: SearchScope; label: string }[] = [
    { value: 'all', label: '전체' },
    { value: 'title', label: '제목' },
    { value: 'description', label: '설명' },
    { value: 'tags', label: '태그' }
  ];

  // svelte-ignore state_referenced_locally -- 초기값만 한 번 캡처한다.
  // 바깥에서 filter.q가 바뀌는 경우는 바로 아래 $effect가 매번 다시 반영한다.
  let draft = $state(filter.q);
  let timer: ReturnType<typeof setTimeout> | null = null;

  // 바깥에서 q가 바뀌면(링크로 직접 진입, 뒤로 가기, 초기화 버튼)
  // 입력에도 반영한다.
  $effect(() => {
    draft = filter.q;
  });

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      filter.q = draft;
    }, SEARCH_DEBOUNCE_MS);
  }

  function commitNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    filter.q = draft;
  }

  /**
   * 범위는 타이핑이 아니라 선택이므로 즉시 반영한다. 대기 중이던
   * 검색어도 함께 커밋한다 — 그러지 않으면 "새 범위 + 옛 검색어"라는
   * 아무도 요청하지 않은 조합이 잠깐 화면에 나온다.
   */
  function changeScope(next: SearchScope) {
    commitNow();
    filter.scope = next;
  }

  $effect(() => {
    return () => {
      if (timer) clearTimeout(timer);
    };
  });
</script>

<div class="card preset-tonal flex flex-wrap items-center gap-3 p-4">
  <input
    class="input grow sm:max-w-md"
    placeholder="검색어"
    aria-label="검색어"
    bind:value={draft}
    oninput={schedule}
    onkeydown={(e) => {
      // 한글 조합 중 Enter는 무시한다 — TagInput과 같은 이유로,
      // 조합 확정과 키 입력이 겹쳐 두 번 들어온다.
      if (e.isComposing) return;
      if (e.key === 'Enter') commitNow();
    }}
  />

  <select
    class="select w-28"
    aria-label="검색 범위"
    value={filter.scope}
    onchange={(e) => changeScope(e.currentTarget.value as SearchScope)}
  >
    {#each SCOPES as s (s.value)}
      <option value={s.value}>{s.label}</option>
    {/each}
  </select>

  <span class="text-surface-500 ml-auto text-sm tabular-nums">{shown} / {total}</span>
</div>
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project client src/lib/components/SearchBar.svelte.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/components/SearchBar.svelte src/lib/components/SearchBar.svelte.test.ts
git commit -m "feat: 검색어·범위 선택기를 갖는 SearchBar 컴포넌트"
```

---

### Task 4: FilterBar에 확장자 칩

**Files:**
- Modify: `src/lib/components/FilterBar.svelte`
- Test: `src/lib/components/FilterBar.svelte.test.ts` (신규)

**Interfaces:**
- Consumes: `ExtensionCount` / `extensionCounts` (Task 1), `EMPTY_FILTER` (Task 2).
- Produces: `FilterBar`가 `exts: ExtensionCount[]` prop을 새로 받는다. 기존 props(`filter` $bindable, `tags`, `total`, `shown`)는 유지하되 **`total`·`shown`과 카운트 표시는 SearchBar로 옮겨졌으므로 제거한다.**

**칩을 찾을 때 접근 이름을 정확히 쓰지 말 것.** 아래 테스트가 `name: /^qta/` 같은 접두사 정규식을 쓰는 것은 의도한 것이다. 칩은 `{e.ext}<span>{e.count}</span>` 구조인데, Skeleton의 `.chip`이 `display:flex`라 CSS가 얹히면 접근 이름이 `"qta 215"`(공백 있음), 안 얹히면 `"qta215"`가 된다. 컴포넌트 테스트에는 `app.css`가 없고 e2e에는 있으므로, 정확 일치로 바꾸면 둘 중 하나가 반드시 깨진다. 접두사 정규식은 양쪽에서 모두 맞는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/components/FilterBar.svelte.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Filter } from '$lib/types';
import type { ExtensionCount } from '$lib/extensions';
import { EMPTY_FILTER } from '$lib/filter';
import FilterBar from './FilterBar.svelte';

const tick = () => new Promise((r) => setTimeout(r, 0));

const EXTS: ExtensionCount[] = [
  { ext: 'qta', count: 215, original: true },
  { ext: 'm4a', count: 54, original: true },
  { ext: 'mp3', count: 269, original: false },
  { ext: 'wav', count: 269, original: false }
];

function setup(initial: Partial<Filter> = {}, exts: ExtensionCount[] = EXTS) {
  const state = $state({ filter: { ...EMPTY_FILTER, ...initial } as Filter });
  render(FilterBar, {
    get filter() {
      return state.filter;
    },
    set filter(next: Filter) {
      state.filter = next;
    },
    tags: [{ tag: '데모', count: 3 }],
    exts
  });
  return { state };
}

describe('FilterBar — 확장자 칩', () => {
  it('확장자마다 칩이 하나씩 있다', async () => {
    setup();
    for (const e of EXTS) {
      await expect.element(page.getByRole('button', { name: new RegExp(`^${e.ext}`) })).toBeInTheDocument();
    }
  });

  it('누르면 filter.ext에 들어가고 다시 누르면 빠진다', async () => {
    const { state } = setup();
    const chip = page.getByRole('button', { name: /^qta/ });
    await chip.click();
    await tick();
    expect(state.filter.ext).toEqual(['qta']);
    await chip.click();
    await tick();
    expect(state.filter.ext).toEqual([]);
  });

  it('여러 개를 동시에 고를 수 있다', async () => {
    const { state } = setup();
    await page.getByRole('button', { name: /^qta/ }).click();
    await page.getByRole('button', { name: /^mp3/ }).click();
    await tick();
    expect(state.filter.ext).toEqual(['qta', 'mp3']);
  });

  it('확장자가 한 종류뿐이면 칩 줄을 그리지 않는다', async () => {
    setup({}, [{ ext: 'qta', count: 3, original: true }]);
    await tick();
    expect(page.getByRole('button', { name: /^qta/ }).elements()).toHaveLength(0);
  });
});

describe('FilterBar — 초기화', () => {
  it('검색어·범위·확장자·태그·기간을 모두 비운다', async () => {
    const { state } = setup({
      q: '레인', scope: 'tags', tags: ['데모'], tagMode: 'or',
      ext: ['qta'], from: '2026-01-01', to: '2026-12-31'
    });
    await page.getByRole('button', { name: '초기화' }).click();
    await tick();
    expect(state.filter).toEqual(EMPTY_FILTER);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project client src/lib/components/FilterBar.svelte.test.ts`
Expected: FAIL — 확장자 칩이 없어 `getByRole` 조회가 타임아웃한다.

- [ ] **Step 3: 컴포넌트를 고친다**

`src/lib/components/FilterBar.svelte` 전체:

```svelte
<script lang="ts">
  import type { Filter } from '$lib/types';
  import type { ExtensionCount } from '$lib/extensions';
  import { EMPTY_FILTER } from '$lib/filter';

  let {
    filter = $bindable<Filter>(),
    tags = [] as { tag: string; count: number }[],
    exts = [] as ExtensionCount[]
  } = $props();

  function toggleTag(tag: string) {
    filter.tags = filter.tags.includes(tag)
      ? filter.tags.filter((t) => t !== tag)
      : [...filter.tags, tag];
  }

  function toggleExt(ext: string) {
    filter.ext = filter.ext.includes(ext)
      ? filter.ext.filter((e) => e !== ext)
      : [...filter.ext, ext];
  }
</script>

<div class="card preset-tonal space-y-3 p-4">
  <div class="flex flex-wrap items-center gap-3">
    <label class="flex items-center gap-2 text-sm">
      <span>기간</span>
      <input type="date" class="input" bind:value={filter.from} />
      <span>~</span>
      <input type="date" class="input" bind:value={filter.to} />
    </label>
    <button type="button" class="btn btn-sm preset-tonal"
      onclick={() => (filter = { ...EMPTY_FILTER })}>
      초기화
    </button>
  </div>

  <!-- 고를 것이 하나뿐인 필터는 자리만 차지한다. 태그 줄이 같은 판단을 한다. -->
  {#if exts.length > 1}
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-surface-500 text-sm">확장자</span>
      {#each exts as e (e.ext)}
        <button type="button"
          class="chip {filter.ext.includes(e.ext) ? 'preset-filled-primary-500' : 'preset-tonal'}"
          onclick={() => toggleExt(e.ext)}>
          {e.ext}<span class="ml-1 opacity-60 tabular-nums">{e.count}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if tags.length}
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex overflow-hidden rounded">
        <button type="button"
          class="btn btn-sm {filter.tagMode === 'and' ? 'preset-filled' : 'preset-tonal'}"
          onclick={() => (filter.tagMode = 'and')}>모두 포함</button>
        <button type="button"
          class="btn btn-sm {filter.tagMode === 'or' ? 'preset-filled' : 'preset-tonal'}"
          onclick={() => (filter.tagMode = 'or')}>하나라도</button>
      </div>
      {#each tags as t (t.tag)}
        <button type="button"
          class="chip {filter.tags.includes(t.tag) ? 'preset-filled-primary-500' : 'preset-tonal'}"
          onclick={() => toggleTag(t.tag)}>
          {t.tag}<span class="ml-1 opacity-60 tabular-nums">{t.count}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project client src/lib/components/FilterBar.svelte.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: 커밋**

`+page.svelte`가 아직 `total`·`shown`을 넘기고 있어 `npm run check`는 이 시점에 경고할 수 있다. Task 5가 고친다. 이 태스크는 컴포넌트 단위 테스트가 초록이면 커밋한다.

```bash
git add src/lib/components/FilterBar.svelte src/lib/components/FilterBar.svelte.test.ts
git commit -m "feat: FilterBar에 확장자 칩 추가"
```

---

### Task 5: 검색창을 목록으로 옮기고 메뉴바에서 없앤다

이 태스크는 쪼개지 않는다. 목록에 넣는 것과 메뉴바에서 빼는 것이 따로 커밋되면 그사이에 검색창이 둘이 되고, 그때 메뉴바 검색은 브리지가 없어 자기 `goto`를 부른다 — 이 개편이 없애려는 바로 그 경합이 중간 커밋에 되살아난다.

**Files:**
- Modify: `src/routes/recordings/+page.svelte`
- Modify: `src/lib/components/MenuBar.svelte`
- Modify: `src/lib/components/MenuBar.svelte.test.ts`
- Modify: `src/routes/+layout.svelte`
- Modify: `src/routes/recordings/page.svelte.test.ts`
- Delete: `src/lib/listFilterBridge.ts`, `src/lib/searchQuery.ts`, `src/lib/searchQuery.test.ts`

**Interfaces:**
- Consumes: `SearchBar` (Task 3), `FilterBar`의 새 `exts` prop (Task 4), `extensionCounts` (Task 1).
- Produces: `MenuBar`의 props가 `pathname` 하나로 줄어든다.

- [ ] **Step 1: 메뉴바에서 검색을 없앤다**

`src/lib/components/MenuBar.svelte` 전체:

```svelte
<script lang="ts">
  let { pathname = '/' } = $props();

  /**
   * 접두사로 판정한다. /recordings 아래에 하위 경로가 생기더라도
   * "리스트"가 활성으로 남아야 하기 때문이다. 메인은 정확히 '/'일
   * 때만이다 — 접두사로 보면 모든 경로가 메인이 된다.
   */
  const onMain = $derived(pathname === '/');
  const onList = $derived(pathname === '/recordings' || pathname.startsWith('/recordings/'));
</script>

<header class="bg-surface-100-900 border-surface-200-800 border-b">
  <nav class="mx-auto flex max-w-6xl items-center gap-4 p-3">
    <a href="/" class="font-bold">ULS Player</a>

    <div class="ml-auto flex items-center gap-2">
      <a
        href="/"
        class="btn btn-sm {onMain ? 'preset-filled' : 'preset-tonal'}"
        aria-current={onMain ? 'page' : undefined}
      >
        메인
      </a>
      <a
        href="/recordings"
        class="btn btn-sm {onList ? 'preset-filled' : 'preset-tonal'}"
        aria-current={onList ? 'page' : undefined}
      >
        리스트
      </a>
    </div>
  </nav>
</header>
```

- [ ] **Step 2: 메뉴바 테스트를 정리한다**

`src/lib/components/MenuBar.svelte.test.ts`에서 검색 관련 테스트(디바운스·Enter·`onsearch`·조합 처리)를 모두 지운다. 파일 맨 위의 `pressEnter`·`type` 헬퍼도 함께 지운다 — 쓰는 곳이 없어진다. 남기는 것은 로고 링크와 현재 페이지 표시 테스트다.

그리고 **검색창이 정말 없어졌는지 지키는 테스트를 하나 더한다:**

```ts
  it('메뉴바에는 입력 요소가 없다', () => {
    // 검색은 목록 화면이 전담한다. 여기 입력이 되살아나면 같은 URL을
    // 두 곳에서 고치는 구조가 함께 돌아온다.
    render(MenuBar, { pathname: '/recordings' });
    expect(page.getByRole('textbox').elements()).toHaveLength(0);
    expect(page.getByRole('combobox').elements()).toHaveLength(0);
  });
```

Run: `npx vitest run --project client src/lib/components/MenuBar.svelte.test.ts`
Expected: PASS

- [ ] **Step 3: 레이아웃에서 검색 배선을 걷어낸다**

`src/routes/+layout.svelte` 전체:

```svelte
<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import MenuBar from '$lib/components/MenuBar.svelte';

  let { children } = $props();
</script>

<MenuBar pathname={page.url.pathname} />

{@render children()}
```

- [ ] **Step 4: 죽은 모듈을 지운다**

```bash
git rm src/lib/listFilterBridge.ts src/lib/searchQuery.ts src/lib/searchQuery.test.ts
```

- [ ] **Step 5: 목록 화면을 배선한다**

`src/routes/recordings/+page.svelte`에서 다섯 곳을 고친다.

(a) import 정리 — `onMount`와 `registerListFilter`를 지우고 `SearchBar`·`extensionCounts`를 더한다:

```ts
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { afterNavigate, goto } from '$app/navigation';
  import type { Bookmark, Filter, Recording } from '$lib/types';
  import { applyFilter, filterFromParams, filterToParams } from '$lib/filter';
  import { extensionCounts } from '$lib/extensions';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
```

(b) 브리지 등록을 지운다 — 다음 두 줄과 그 위의 설명 주석 블록을 통째로 삭제한다:

```ts
  onMount(() => registerListFilter((q) => (filter.q = q)));
```

(c) 확장자 집계를 파생시킨다. `const tagNames = $derived(...)` 옆에 둔다:

```ts
  // 목록 전체가 이미 화면에 내려와 있고, 태그와 달리 확장자는 UI로
  // 바뀌지 않는다 — 서버가 셀 이유가 없다.
  const exts = $derived(extensionCounts(recordings));
```

(d) 필터 → URL 이펙트의 주석에서 브리지를 가리키는 두 문단을 고친다. `// 이 이펙트는 이제 이 화면에서 URL로 goto를 부르는 유일한 지점이다 —` 로 시작하는 문단을 다음으로 바꾼다:

```ts
  // 이 이펙트는 이 화면에서 URL로 goto를 부르는 유일한 지점이다. 검색어·
  // 범위·태그·기간·확장자가 전부 이 하나의 filter 객체를 거쳐서만 URL에
  // 반영되므로, "지금 쿼리가 뭐냐"를 스냅샷으로 다시 읽어 병합할 필요가
  // 없다 — 읽을 스냅샷이 없으니 그게 낡을 일도 없다.
```

(e) 템플릿 상단을 바꾼다. 기존:

```svelte
  <header class="flex items-baseline justify-between">
    <h1 class="h2">ULS Player</h1>
    <a href="/import" class="btn preset-filled">가져오기</a>
  </header>

  <FilterBar bind:filter {tags} total={recordings.length} shown={shown.length} />
```

새로:

```svelte
  <SearchBar bind:filter total={recordings.length} shown={shown.length} />

  <div class="flex justify-end">
    <a href="/import" class="btn preset-filled">가져오기</a>
  </div>

  <FilterBar bind:filter {tags} {exts} />
```

- [ ] **Step 6: 목록 화면 테스트에서 브리지 흔적을 지운다**

**단언은 하나도 바꾸지 않는다. 낡아버린 주석만 고친다.** 이 파일의 테스트는 전부 URL → 필터 방향을 검증하는데, 그 방향은 링크로 직접 진입할 때와 뒤로 가기에서 여전히 쓰이므로 살아 있다. 사라진 것은 그 방향을 설명할 때 예로 들던 "메뉴바 검색"뿐이다.

고칠 곳은 네 군데다(줄 번호는 변경 전 기준).

| 위치 | 지금 주석이 하는 말 | 고칠 말 |
|---|---|---|
| 31행 근처 | `외부에서 URL이 바뀌면(메뉴바 검색 등)` | `외부에서 URL이 바뀌면(링크 진입·뒤로 가기)` |
| 174행 근처 | `q 입력은 메뉴바로 옮겨갔다 — 이 화면은 렌더하지 않으므로` | q 입력이 이 화면으로 돌아왔지만 이 테스트가 검증하는 것은 **URL로 들어온 q**와 로컬 태그가 합쳐지는지다. `setSearchParams`로 URL 쪽을 흉내내는 방식은 그대로 두고, 이유를 그렇게 다시 쓴다 |
| 203행 근처 | `원래 이 테스트는 검색창 타이핑을 재현했다 — 하지만 q 입력은 메뉴바로 옮겨가 이 화면에는 더 이상 없다` | 태그 칩으로 재현하는 이유를 "버그의 본질은 URL을 거치지 않은 로컬 변경이 되돌아가는가이지 q냐 tags냐가 아니다"만 남기고, 메뉴바를 드는 대목은 지운다 |
| 230행·286행 근처 | `메뉴바 검색이 이 경로로 동작한다` / `q는 이제 메뉴바 검색이 URL을 바꿔서 들어온다` | `링크로 직접 들어오거나 뒤로 가기를 하면 이 경로로 동작한다` |

Run: `npx vitest run --project client src/routes/recordings/`
Expected: PASS — 단언을 안 건드렸으므로 전부 그대로 통과해야 한다. 실패가 나면 그것은 Step 5의 배선이 무언가를 깨뜨렸다는 뜻이다. 그 테스트가 무엇을 지키던 것인지 먼저 읽고 **화면 쪽을 고친다** — 통과시키려고 단언을 약화시키지 않는다.

특히 `list-header-alignment.svelte.test.ts`(표 열 폭을 실측하는 파일, `app.css`를 직접 import한다)를 함께 돌려 상단 배치 변경이 표를 밀지 않았는지 확인한다.

- [ ] **Step 7: 전체 검사**

```bash
npm run check
npx vitest run
```

Expected: 타입 에러 0, 유닛 전부 통과. `searchQuery.test.ts`가 사라져 테스트 파일 수가 하나 줄고 `extensions.test.ts`·`SearchBar.svelte.test.ts`·`FilterBar.svelte.test.ts`가 늘어난다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: 검색창을 목록으로 옮기고 메뉴바 검색과 브리지를 없앤다"
```

---

### Task 6: e2e 재작업

**Files:**
- Modify: `tests/e2e/import-flow.spec.ts`

**Interfaces:**
- Consumes: 목록 화면의 검색 입력(`placeholder="검색어"`, `aria-label="검색어"`)과 범위 선택(`aria-label="검색 범위"`), 확장자 칩 버튼.

- [ ] **Step 1: 사라진 동선의 테스트를 지운다**

두 개를 삭제한다. 각각 대상 자체가 없어졌다.

- `메인에서 메뉴바로 검색하면 목록으로 이동하며 걸러진다` — 메인에 검색창이 없다.
- `태그 클릭과 메뉴바 검색이 겹쳐도 서로의 변경을 지우지 않는다` — writer가 하나뿐이라 경합이 성립하지 않는다. 이 테스트가 지키던 불변식(`goto` 호출자가 하나)은 Task 5 Step 2의 "메뉴바에는 입력 요소가 없다"가 구조적으로 지킨다.

삭제할 때 그 위의 긴 설명 주석 블록도 함께 지운다.

- [ ] **Step 2: 남는 두 개를 목록 검색창 상대로 다시 쓴다**

이 둘은 실제 버그를 잡았던 테스트다. 대상만 바꾸고 단언은 그대로 지킨다.

`목록에서 태그를 고른 뒤 메뉴바로 검색해도 태그 필터가 유지된다` → 제목을 `목록에서 태그를 고른 뒤 검색해도 태그 필터가 유지된다`로 바꾸고, `page.getByPlaceholder('제목 검색')`를 `page.getByPlaceholder('검색어')`로 바꾼다.

`목록에서 초기화하면 메뉴바 검색창도 함께 비워진다` → 제목을 `목록에서 초기화하면 검색창도 함께 비워진다`로 바꾸고 같은 셀렉터 교체를 한다. 단언 `await expect(search).toHaveValue('')`는 그대로 둔다 — 이것이 이 테스트의 존재 이유다.

- [ ] **Step 3: 새 기능의 e2e를 더한다**

같은 `describe` 안에 추가한다. 파일 상단의 기존 상수(`QTA_TITLE`, `M4A_TITLE`)를 그대로 쓴다.

```ts
  test('검색 범위를 태그로 바꾸면 제목이 같아도 걸리지 않는다', async ({ page }) => {
    await page.goto('/recordings');

    const search = page.getByPlaceholder('검색어');
    await search.fill(QTA_TITLE);
    await search.press('Enter');
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toBeVisible();

    // 범위를 태그로 좁히면 제목에만 있는 낱말은 더 이상 걸리지 않는다.
    await page.getByLabel('검색 범위').selectOption('tags');
    await expect(page).toHaveURL(/[?&]scope=tags/);
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);
  });

  test('확장자 칩으로 원본 형식을 좁힌다', async ({ page }) => {
    await page.goto('/recordings');

    // 픽스처의 두 녹음은 원본 확장자가 서로 다르다.
    await page.getByRole('button', { name: /^m4a/ }).click();
    await expect(page).toHaveURL(/[?&]ext=m4a/);
    await expect(page.getByRole('button', { name: M4A_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: QTA_TITLE, exact: true })).toHaveCount(0);
  });

  test('목록 상단에 앱 이름이 중복으로 나오지 않는다', async ({ page }) => {
    await page.goto('/recordings');
    // 메뉴바의 로고 링크 하나만 남아야 한다.
    await expect(page.getByText('ULS Player', { exact: true })).toHaveCount(1);
  });
```

- [ ] **Step 4: e2e를 돌린다**

Run: `npm run test:e2e`
Expected: PASS. 픽스처의 확장자가 무엇인지는 파일 상단 픽스처 준비 코드를 읽어 확인한다 — `m4a` 칩이 없으면 픽스처에 있는 실제 확장자로 테스트를 맞춘다(테스트를 통과시키려고 단언을 지우지 않는다).

- [ ] **Step 5: 전체 검사와 커밋**

```bash
npm run check
npm test
```

Expected: 타입 에러 0, 유닛·e2e 전부 통과.

```bash
git add tests/e2e/import-flow.spec.ts
git commit -m "test: 목록 검색·확장자 필터 e2e 재작업"
```
