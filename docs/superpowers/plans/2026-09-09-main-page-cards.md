# 메인 페이지 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메인 페이지에 즐겨찾기와 최근 추가 두 카드를 놓고, 거기서 바로 재생을 시작할 수 있게 한다.

**Architecture:** 저장소 계층에 `favoritedAt` 필드와 그것을 서버 시각으로 찍는 함수를 더하고, API에 `favorite` op을 얹는다. 목록 행에 별 버튼을 달아 지정하게 하고, 메인 페이지에 `load`를 새로 만들어 두 배열을 계산해 내려보낸다. 카드에서 제목을 누르면 `/recordings?play=<id>`로 이동하고, 목록이 그 파라미터를 보면 기존 `selectRow` 경로를 그대로 탄다.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), TypeScript, Tailwind + Skeleton, Vitest(browser+node 두 프로젝트), Playwright.

## Global Constraints

- `Recording.favoritedAt`은 `string | null`이다. `null`이면 즐겨찾기가 아니다. 불리언을 쓰지 않는다 — 카드가 "최근에 지정한 5개"를 뽑아야 하는데 불리언이면 순서를 알 수 없다.
- **즐겨찾기 지정 시각은 서버가 정한다.** 클라이언트가 보낸 `favoritedAt` 값은 쓰지 않는다 — 쓰면 카드 순서를 조작할 수 있다.
- 즐겨찾기 개수에 제한을 두지 않는다. "최대 5개"는 카드에 보이는 수다.
- 기존 녹음에는 이 필드가 없다. 마이그레이션 없이, 읽을 때 `?? null`로 채운다.
- 카드는 각각 **5개**, 삭제된 녹음(`deletedAt !== null`)은 양쪽 모두에서 제외한다.
- 즐겨찾기가 하나도 없으면 그 카드를 그리지 않는다. 최근 추가 카드는 항상 그린다.
- **URL을 쓰는 `goto`는 목록 화면의 필터 → URL 이펙트 하나뿐이어야 한다.** `play` 파라미터를 지우려고 두 번째 `goto` 호출자를 만들지 않는다 — 이 저장소는 두 writer가 겹쳐 서로의 변경을 지우는 경합을 이미 겪었다.
- 없는 id로 `?play=`가 들어오면 아무 일도 하지 않는다. 오류를 띄우지 않는다.
- 테스트 파일 이름이 러너를 정한다: `*.svelte.test.ts`는 browser(`--project client`), 그 밖의 `*.test.ts`는 node(`--project server`).
- Vitest 설정에 `expect: { requireAssertions: true }` — 모든 테스트가 단언을 가져야 한다.
- 컴포넌트 테스트는 `+layout.svelte` 없이 마운트되어 Tailwind가 적용되지 않는다. 배치·접근 이름을 재는 테스트는 `app.css`를 직접 import하는 파일에 둔다.
- 이 머신에서 다른 프로세스가 Playwright를 돌릴 때가 있다. `wrapDynamicImport` 오류나 포트 4173 점유는 그 탓이다 — **어떤 프로세스도 죽이지 말 것.**

## File Structure

| 파일 | 책임 | 처리 |
|---|---|---|
| `src/lib/types.ts` | `Recording.favoritedAt` | 수정 (Task 1) |
| `src/lib/server/store/recordings.ts` | 읽을 때 기본값 채우기, `setFavorite` | 수정 (Task 1) |
| `src/lib/server/store/recordings.test.ts` | 위 동작 | 수정 (Task 1) |
| `src/routes/api/recordings/+server.ts` | `favorite` op | 수정 (Task 2) |
| `src/routes/api/recordings/server.test.ts` | 위 동작 | 수정 (Task 2) |
| `src/routes/recordings/+page.svelte` | 행의 별 버튼, `?play=` 처리 | 수정 (Task 3, 5) |
| `src/routes/recordings/page.svelte.test.ts` | 위 동작 | 수정 (Task 3, 5) |
| `src/routes/+page.server.ts` | 두 배열 계산 | 신규 (Task 4) |
| `src/routes/page.server.test.ts` | 위 동작 | 신규 (Task 4) |
| `src/routes/+page.svelte` | 카드 둘 | 수정 (Task 4) |
| `src/routes/page.svelte.test.ts` | 카드 렌더 | 신규 (Task 4) |

---

### Task 1: `favoritedAt` 필드와 저장소 함수

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/server/store/recordings.ts`
- Test: `src/lib/server/store/recordings.test.ts`

**Interfaces:**
- Produces: `Recording.favoritedAt: string | null`
- Produces: `setFavorite(cfg: AppConfig, id: string, favorite: boolean): Promise<Recording>` — `src/lib/server/store/recordings.ts`

**배경.** 이 저장소는 JSON 파일 하나에 모든 녹음을 담는다. 스키마 버전을 올려 마이그레이션하는 대신, **읽는 쪽에서 기본값을 채우는** 방식을 쓴다. `all()`(28행)이 모든 읽기의 관문이므로 거기 한 곳만 고치면 `listAll`·`getById`·`patch`가 전부 새 필드를 보게 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/server/store/recordings.test.ts`에 더한다. 이 파일이 임시 디렉터리와 `AppConfig`를 어떻게 만드는지 기존 테스트를 열어 확인하고 그 방식을 따른다.

```ts
describe('favoritedAt', () => {
  it('필드가 없는 기존 녹음도 읽히고 null로 채워진다', async () => {
    // 이 저장소는 스키마 마이그레이션 대신 읽을 때 기본값을 채운다.
    // recordings.json을 직접 써서 "필드가 없던 시절의 파일"을 만든다.
    const cfg = await tmpConfig();
    await writeRecordingsFileWithout(cfg, 'favoritedAt');   // 헬퍼는 아래 Step 3 참고

    const [rec] = await listAll(cfg);

    expect(rec.favoritedAt).toBe(null);
  });

  it('지정하면 서버 시각이 들어간다', async () => {
    const cfg = await tmpConfig();
    const rec = await seedOne(cfg);
    const before = Date.now();

    const out = await setFavorite(cfg, rec.id, true);

    expect(out.favoritedAt).not.toBe(null);
    expect(Date.parse(out.favoritedAt!)).toBeGreaterThanOrEqual(before);
  });

  it('해제하면 null로 돌아간다', async () => {
    const cfg = await tmpConfig();
    const rec = await seedOne(cfg);
    await setFavorite(cfg, rec.id, true);

    const out = await setFavorite(cfg, rec.id, false);

    expect(out.favoritedAt).toBe(null);
  });

  it('디스크에도 남는다', async () => {
    // 반환값만 맞고 파일에 안 써지면 새로고침에서 사라진다.
    const cfg = await tmpConfig();
    const rec = await seedOne(cfg);
    await setFavorite(cfg, rec.id, true);

    const [reloaded] = await listAll(cfg);

    expect(reloaded.favoritedAt).not.toBe(null);
  });

  it('없는 id면 RecordingNotFoundError', async () => {
    const cfg = await tmpConfig();
    await expect(setFavorite(cfg, 'no-such-id', true)).rejects.toThrow(RecordingNotFoundError);
  });
});
```

`tmpConfig`·`seedOne` 같은 헬퍼 이름이 이 파일에 이미 있으면 그것을 쓰고, 없으면 기존 테스트가 쓰는 방식에 맞춰 만든다. `writeRecordingsFileWithout`은 "필드가 빠진 파일"을 만들기 위한 것으로, 이 파일에 직접 작성한다 — `RecordingsFile` 모양의 객체에서 `favoritedAt`만 빼고 `fs.writeFile`로 쓰면 된다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/server/store/recordings.test.ts`
Expected: FAIL — `setFavorite`이 없고, `favoritedAt`도 타입에 없다.

- [ ] **Step 3: 타입과 저장소를 고친다**

`src/lib/types.ts`의 `Recording`에 더한다:

```ts
  createdAt: string;
  updatedAt: string;
  /** 즐겨찾기로 지정한 시각. null이면 즐겨찾기가 아니다. */
  favoritedAt: string | null;
  deletedAt: string | null;
```

`src/lib/server/store/recordings.ts`의 `all()`을 고쳐 기본값을 채운다:

```ts
async function all(cfg: AppConfig): Promise<Recording[]> {
  // 이 저장소는 스키마 버전을 올려 마이그레이션하는 대신, 읽는 쪽에서
  // 기본값을 채운다. all()이 모든 읽기의 관문이라 여기 한 곳이면
  // listAll·getById·patch가 전부 새 필드를 보게 된다.
  const raw = (await readJson<RecordingsFile>(file(cfg), EMPTY)).recordings;
  return raw.map((r) => ({ ...r, favoritedAt: r.favoritedAt ?? null }));
}
```

그리고 `patch` 아래에 더한다:

```ts
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
```

`Patchable` 타입에 `favoritedAt`이 없으면 더한다 — `patch`가 받아들일 수 있어야 한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/server/store/recordings.test.ts`
Expected: PASS

- [ ] **Step 5: 타입 검사**

Run: `npm run check`
Expected: `Recording` 리터럴을 만드는 곳(테스트 픽스처 등)에서 `favoritedAt` 누락 에러가 날 수 있다. 그런 곳에 `favoritedAt: null`을 채운다. 에러 0이 될 때까지.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/types.ts src/lib/server/store/recordings.ts src/lib/server/store/recordings.test.ts
git commit -m "feat: 즐겨찾기 시각 필드와 저장소 함수"
```

---

### Task 2: `favorite` API op

**Files:**
- Modify: `src/routes/api/recordings/+server.ts`
- Test: `src/routes/api/recordings/server.test.ts`

**Interfaces:**
- Consumes: `setFavorite(cfg, id, favorite)` (Task 1)
- Produces: `PATCH /api/recordings` 가 `{ op: 'favorite', id: string, favorite: boolean }` 을 받는다. 응답은 기존 op들과 같은 모양(`{ recordings, tags }`)이다.

**배경.** 이 라우트는 `op` 필드로 갈라지는 하나의 PATCH 핸들러다. 기존 op은 `patch`·`addTags`·`removeTags`·`delete` 넷이고, 각 op은 입력을 타입 가드로 검증한 뒤(`isNonEmptyString`, `isStringArray` 등) 저장소 함수를 부른다. 응답은 항상 갱신된 전체 목록과 태그다 — 화면이 그것으로 자기 상태를 덮어쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/routes/api/recordings/server.test.ts`에 더한다. 이 파일이 요청을 어떻게 만들고 `config`를 어떻게 모킹하는지 기존 테스트를 따른다.

```ts
describe('favorite op', () => {
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
    const res = await patchRequest({ op: 'favorite', id: 'r1', favorite: 'yes' });
    expect(res.status).toBe(400);
  });

  it('id가 없으면 400', async () => {
    const res = await patchRequest({ op: 'favorite', favorite: true });
    expect(res.status).toBe(400);
  });
});
```

`patchRequest` 헬퍼가 이 파일에 이미 있으면 그것을 쓰고, 없으면 기존 테스트가 요청을 만드는 방식에 맞춰 만든다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/routes/api/recordings/server.test.ts`
Expected: FAIL — 알 수 없는 op이라 400이 돌아온다.

- [ ] **Step 3: op을 더한다**

`Body` 유니온에 더한다:

```ts
type Body =
  | { op: 'patch'; id: string; title?: string; description?: string; tags?: string[]; bookmarks?: Bookmark[] }
  | { op: 'addTags'; ids: string[]; tags: string[] }
  | { op: 'removeTags'; ids: string[]; tags: string[] }
  | { op: 'favorite'; id: string; favorite: boolean }
  | { op: 'delete'; ids: string[] };
```

import에 `setFavorite`을 더하고, op 분기에 케이스를 더한다. 기존 케이스가 입력을 검증하는 방식(타입 가드 → 아니면 `badRequest`)을 그대로 따른다:

```ts
    case 'favorite': {
      if (!isNonEmptyString(body.id)) badRequest('id가 필요합니다');
      if (typeof body.favorite !== 'boolean') badRequest('favorite은 true/false여야 합니다');
      // 시각은 여기서 받지 않는다 — setFavorite이 서버 시각을 찍는다.
      await setFavorite(config, body.id, body.favorite);
      break;
    }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project server src/routes/api/recordings/server.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/routes/api/recordings/+server.ts src/routes/api/recordings/server.test.ts
git commit -m "feat: 즐겨찾기 지정·해제 API op"
```

---

### Task 3: 목록 행의 별 버튼

**Files:**
- Modify: `src/routes/recordings/+page.svelte`
- Test: `src/routes/recordings/page.svelte.test.ts`

**Interfaces:**
- Consumes: `PATCH /api/recordings` 의 `{ op: 'favorite', id, favorite }` (Task 2)

**배경.** 이 화면은 서버에 무언가를 보낼 때 `send()`를 쓴다. `send()`는 PATCH를 보내고 응답으로 온 `{ recordings, tags }`로 자기 상태를 통째로 덮어쓰며, 실패하면 `false`를 돌려준다. 행의 선택 체크박스는 첫 번째 열에 있다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/routes/recordings/page.svelte.test.ts`에 더한다. 이 파일의 기존 setup(`$app/navigation`·`$app/state` 모킹, `render(Page, { data })`)과 fetch 스텁 방식을 따른다. **행의 체크박스에는 접근 이름이 없으므로** 이 파일이 이미 쓰는 방식(`rowFor(...)`, `.first()`)으로 행을 찾는다.

```ts
  it('별 버튼을 누르면 favorite op이 나간다', async () => {
    const fetchMock = stubFetch();
    const { getByRole } = render(Page, { data: baseData() });

    await getByRole('button', { name: '즐겨찾기 지정' }).first().click();

    await vi.waitFor(() => {
      const body = JSON.parse(String(patchCalls(fetchMock)[0][1]!.body));
      expect(body).toMatchObject({ op: 'favorite', favorite: true });
    });
  });

  it('이미 즐겨찾기면 해제로 동작한다', async () => {
    const fetchMock = stubFetch();
    const data = pageData([rec({ id: '1', title: '레인', favoritedAt: '2026-09-01T00:00:00+09:00' })]);
    const { getByRole } = render(Page, { data });

    await getByRole('button', { name: '즐겨찾기 해제' }).first().click();

    await vi.waitFor(() => {
      const body = JSON.parse(String(patchCalls(fetchMock)[0][1]!.body));
      expect(body).toMatchObject({ op: 'favorite', favorite: false });
    });
  });

  it('별 버튼은 행 선택을 일으키지 않는다', async () => {
    // 즐겨찾기는 재생 의사와 무관한 조작이다. 여기서 행이 선택되면
    // 즐겨찾기를 누를 때마다 재생이 시작된다.
    const { getByRole, getByText } = render(Page, { data: baseData() });

    await getByRole('button', { name: '즐겨찾기 지정' }).first().click();

    expect(getByText('목록에서 녹음을 고르세요').elements()).toHaveLength(1);
  });
```

`stubFetch`·`patchCalls`·`pageData`·`rec` 헬퍼가 이 파일에 이미 있다. 빈 재생 바의 안내 문구(`목록에서 녹음을 고르세요`)는 아무것도 선택되지 않았을 때만 보이므로, 세 번째 테스트의 단언에 쓸 수 있다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project client src/routes/recordings/page.svelte.test.ts`
Expected: FAIL — `즐겨찾기 지정` 버튼이 없다.

- [ ] **Step 3: 버튼을 더한다**

행의 체크박스 옆에 둔다. 체크박스가 있는 칸을 찾아(`type="checkbox"`로 grep) 그 바로 뒤에 넣는다:

```svelte
              <!-- 즐겨찾기는 재생 의사와 무관하므로 행 클릭이 번지지 않게
                   끊는다 — 그러지 않으면 별을 누를 때마다 재생이 시작된다. -->
              <button type="button" class="btn-icon btn-sm preset-tonal"
                aria-label={rec.favoritedAt ? '즐겨찾기 해제' : '즐겨찾기 지정'}
                onclick={(e) => {
                  e.stopPropagation();
                  send({ op: 'favorite', id: rec.id, favorite: rec.favoritedAt === null });
                }}>
                {rec.favoritedAt ? '★' : '☆'}
              </button>
```

`send()`의 인자 타입이 유니온으로 좁혀져 있으면 `favorite` op을 그 유니온에 더한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project client src/routes/recordings/page.svelte.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/routes/recordings/+page.svelte src/routes/recordings/page.svelte.test.ts
git commit -m "feat: 목록 행에서 즐겨찾기를 지정한다"
```

---

### Task 4: 메인 페이지 카드 둘

**Files:**
- Create: `src/routes/+page.server.ts`
- Create: `src/routes/page.server.test.ts`
- Modify: `src/routes/+page.svelte`
- Create: `src/routes/page.svelte.test.ts`

**Interfaces:**
- Consumes: `listAll(cfg)` (`$lib/server/store/recordings`) — 삭제되지 않은 녹음을 `recordedAt` 내림차순으로 돌려준다. `Recording.favoritedAt`(Task 1).
- Produces: 메인 페이지 `load`가 `{ favorites: Recording[]; recent: Recording[] }`를 돌려준다. 각각 최대 5개.

**배경.** 메인 페이지에는 지금 `load`가 없다. `listAll`은 이미 삭제된 것을 걸러 주므로 카드 계산에서 `deletedAt`을 다시 볼 필요가 없다 — 다만 그 사실에 기대는 것이 맞는지 테스트로 못박는다.

- [ ] **Step 1: 실패하는 서버 테스트를 쓴다**

`src/routes/page.server.test.ts`. 같은 층의 `src/routes/recordings/page.server.test.ts`가 `config`와 store를 어떻게 모킹하는지 열어 보고 그 방식을 따른다.

```ts
describe('메인 페이지 load', () => {
  it('즐겨찾기를 지정 시각 내림차순 5개로 준다', async () => {
    const recs = [
      rec({ id: 'a', favoritedAt: '2026-09-01T00:00:00+09:00' }),
      rec({ id: 'b', favoritedAt: '2026-09-05T00:00:00+09:00' }),
      rec({ id: 'c', favoritedAt: null }),
      rec({ id: 'd', favoritedAt: '2026-09-03T00:00:00+09:00' })
    ];
    const out = await loadWith(recs);

    expect(out.favorites.map((r) => r.id)).toEqual(['b', 'd', 'a']);
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

    expect(out.recent.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('즐겨찾기가 없으면 빈 배열', async () => {
    const out = await loadWith([rec({ id: 'a', favoritedAt: null })]);

    expect(out.favorites).toEqual([]);
  });

  it('삭제된 녹음은 어느 쪽에도 없다', async () => {
    // listAll이 걸러 주지만, 그 사실에 기대고 있다는 것을 못박는다.
    const out = await loadWith([
      rec({ id: 'gone', favoritedAt: '2026-09-05T00:00:00+09:00', deletedAt: '2026-09-06T00:00:00+09:00' })
    ]);

    expect(out.favorites).toEqual([]);
    expect(out.recent).toEqual([]);
  });
});
```

`loadWith(recs)`는 store를 그 배열로 모킹하고 `load`를 부르는 헬퍼로, 이 파일에 작성한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/routes/page.server.test.ts`
Expected: FAIL — `+page.server.ts`가 없다.

- [ ] **Step 3: `load`를 만든다**

`src/routes/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import type { Recording } from '$lib/types';
import { config } from '$lib/server/config';
import { listAll } from '$lib/server/store/recordings';

/** 카드 하나에 보여줄 개수. */
const CARD_SIZE = 5;

/**
 * 시각 문자열 내림차순 비교자. 값이 없거나 파싱할 수 없으면 맨 뒤로 보낸다.
 *
 * 문자열 비교(localeCompare)를 쓰면 안 된다. 이 저장소의 nowIso()는 UTC가
 * 아니라 서버의 로컬 오프셋으로 시각을 찍는다(예: `2026-09-02T20:18:02+09:00`).
 * 서버를 다른 시간대로 옮기면 그 뒤에 찍힌 값은 오프셋이 달라지고, 오프셋이
 * 섞인 문자열은 사전순과 시간순이 어긋난다 — `...T01:00:00+00:00`(=10시 KST)이
 * `...T09:00:00+09:00`(=9시 KST)보다 사전순으로는 앞이지만 실제로는 나중이다.
 * 같은 이유로 이 파일의 compareByRecordedAtDesc도 문자열이 아니라 epoch ms로
 * 비교한다.
 */
function byTimeDesc(key: 'favoritedAt' | 'createdAt') {
  return (a: Recording, b: Recording) => {
    const ta = a[key] === null ? NaN : Date.parse(a[key] as string);
    const tb = b[key] === null ? NaN : Date.parse(b[key] as string);
    const aBad = Number.isNaN(ta);
    const bBad = Number.isNaN(tb);
    if (aBad && bBad) return 0;
    if (aBad) return 1;
    if (bBad) return -1;
    return tb - ta;
  };
}

export const load: PageServerLoad = async () => {
  // listAll이 이미 deletedAt !== null을 걸러 준다.
  const all = await listAll(config);

  return {
    favorites: all
      .filter((r) => r.favoritedAt !== null)
      .sort(byTimeDesc('favoritedAt'))
      .slice(0, CARD_SIZE),
    recent: all.slice().sort(byTimeDesc('createdAt')).slice(0, CARD_SIZE)
  };
};
```

**문자열 비교를 쓰지 않는 것이 이 태스크의 함정이다.** 이 저장소의 `nowIso()`는 UTC가 아니라 서버 로컬 오프셋으로 찍으므로, 서버 시간대가 바뀌면 오프셋이 섞이고 사전순과 시간순이 어긋난다. 같은 파일의 `compareByRecordedAtDesc`가 이미 그 이유로 epoch ms를 쓴다 — 그 주석을 읽어볼 것.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project server src/routes/page.server.test.ts`
Expected: PASS

- [ ] **Step 5: 실패하는 화면 테스트를 쓴다**

`src/routes/page.svelte.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('메인 페이지 카드', () => {
  it('즐겨찾기가 있으면 그 카드와 제목들이 보인다', async () => {
    render(Page, { data: { favorites: [rec({ id: 'a', title: '레인' })], recent: [] } });

    await expect.element(page.getByText('즐겨찾기')).toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: '레인' })).toBeInTheDocument();
  });

  it('즐겨찾기가 없으면 그 카드를 그리지 않는다', async () => {
    // 빈 카드는 자리만 차지한다. 목록 화면의 태그·확장자 칩이 같은 규칙을 쓴다.
    render(Page, { data: { favorites: [], recent: [rec({ id: 'b', title: '정류장' })] } });

    expect(page.getByText('즐겨찾기').elements()).toHaveLength(0);
  });

  it('제목 링크가 그 녹음을 재생하는 주소를 가리킨다', async () => {
    render(Page, { data: { favorites: [], recent: [rec({ id: 'b', title: '정류장' })] } });

    await expect
      .element(page.getByRole('link', { name: '정류장' }))
      .toHaveAttribute('href', '/recordings?play=b');
  });
});
```

`rec()` 헬퍼는 이 파일에 작성한다 — `Recording` 전체를 채우되 `favoritedAt: null`, `deletedAt: null`을 포함한다.

- [ ] **Step 6: 화면을 만든다**

`src/routes/+page.svelte`의 기존 header와 링크는 그대로 두고, 그 아래에 카드를 더한다:

```svelte
<script lang="ts">
  let { data } = $props();
</script>
```

```svelte
  {#if data.favorites.length}
    <section class="card preset-tonal space-y-2 p-4">
      <h2 class="h3">즐겨찾기</h2>
      <ul class="space-y-1">
        {#each data.favorites as r (r.id)}
          <li><a class="anchor" href="/recordings?play={r.id}">{r.title}</a></li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card preset-tonal space-y-2 p-4">
    <h2 class="h3">최근 추가된 음악</h2>
    <ul class="space-y-1">
      {#each data.recent as r (r.id)}
        <li><a class="anchor" href="/recordings?play={r.id}">{r.title}</a></li>
      {/each}
    </ul>
  </section>
```

기존 스크립트 블록의 주석("지금은 자리만 잡는다")은 더 이상 사실이 아니므로 지운다.

- [ ] **Step 7: 통과를 확인한다**

Run: `npx vitest run --project client src/routes/page.svelte.test.ts`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add src/routes/+page.server.ts src/routes/page.server.test.ts src/routes/+page.svelte src/routes/page.svelte.test.ts
git commit -m "feat: 메인 페이지에 즐겨찾기·최근 추가 카드"
```

---

### Task 5: `?play=<id>`로 들어오면 재생한다

**Files:**
- Modify: `src/routes/recordings/+page.svelte`
- Test: `src/routes/recordings/page.svelte.test.ts`
- Test: `tests/e2e/import-flow.spec.ts`

**Interfaces:**
- Consumes: `selectRow(id: string): void` — 이미 이 화면에 있다. `selectedId`를 세팅하고 `playRequest`를 1 올린다.

**배경 — 이 태스크의 유일한 위험.** 이 화면에는 URL을 쓰는 `goto`가 **하나뿐**이어야 한다는 규칙이 있다(필터 → URL 이펙트). 예전에 메뉴바 검색과 이 이펙트가 각자 `goto`를 부르다가, `goto`가 비동기라 서로 다른 순간의 스냅샷을 기준으로 겹쳐 써서 한쪽 변경이 사라지는 경합을 겪었다.

그래서 `play` 파라미터를 지우려고 **새 `goto`를 부르지 않는다.** 필터 → URL 이펙트가 `filterToParams(filter)`로 쿼리스트링을 처음부터 다시 만들므로, 필터에 없는 `play`는 그 다음 갱신에서 자연히 빠진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/routes/recordings/page.svelte.test.ts`에 더한다. 이 파일은 `$app/state`의 `page.url`을 `SvelteURL`로 모킹하고 `setSearchParams(...)`로 외부 URL 변경을 흉내낸다 — 기존 테스트를 따른다.

```ts
  it('?play=<id>로 들어오면 그 녹음이 재생 대상이 된다', async () => {
    setSearchParams('?play=2');
    const { getByText } = render(Page, {
      data: pageData([rec({ id: '1', title: '레인' }), rec({ id: '2', title: '정류장' })])
    });
    await tick();

    // 빈 재생 바의 안내 문구가 사라지고 그 녹음의 제목이 재생기에 뜬다.
    expect(getByText('목록에서 녹음을 고르세요').elements()).toHaveLength(0);
  });

  it('없는 id면 아무 일도 일어나지 않는다', async () => {
    // 링크가 오래됐거나 그 사이 삭제된 것뿐이다. 오류를 띄우지 않는다.
    setSearchParams('?play=no-such-id');
    const { getByText } = render(Page, { data: pageData([rec({ id: '1', title: '레인' })]) });
    await tick();

    await expect.element(getByText('목록에서 녹음을 고르세요')).toBeInTheDocument();
  });

  it('처리한 뒤 URL에서 play가 사라진다', async () => {
    // 남겨두면 새로고침이나 뒤로 가기에서 재생이 다시 걸린다. 지우는
    // 주체는 필터 -> URL 이펙트다 — filterToParams(filter)로 쿼리스트링을
    // 처음부터 다시 만들기 때문에 필터에 없는 play는 자연히 빠진다.
    // 이 테스트가 지키는 것은 그 성질에 실제로 기대도 되는가이다.
    setSearchParams('?play=1');
    render(Page, { data: pageData([rec({ id: '1', title: '레인' })]) });

    await vi.waitFor(() => expect(page.url.searchParams.get('play')).toBe(null));
  });

  it('play 파라미터는 한 번만 반응한다', async () => {
    // 같은 URL이 다시 읽혀도(다른 이유로 이펙트가 재실행돼도) 재생이
    // 다시 걸리면, 듣다가 멈춘 것이 제멋대로 다시 시작된다.
    setSearchParams('?play=1');
    render(Page, { data: pageData([rec({ id: '1', title: '레인' })]) });
    await tick();

    const before = goto.mock.calls.length;
    setSearchParams('?play=1');
    await tick();

    expect(goto.mock.calls.length).toBe(before);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project client src/routes/recordings/page.svelte.test.ts`
Expected: FAIL — 첫 번째 테스트에서 안내 문구가 그대로 남는다.

- [ ] **Step 3: 처리를 더한다**

`+page.svelte`의 스크립트, `selectRow` 정의 아래에 더한다:

```ts
  /**
   * 메인 페이지 카드에서 `/recordings?play=<id>`로 들어온 경우를 처리한다.
   *
   * 한 번만 반응해야 한다 — 이 이펙트는 page.url을 읽으므로 URL이 바뀔
   * 때마다 다시 도는데, 그때마다 재생을 다시 걸면 듣다가 멈춘 것이
   * 제멋대로 다시 시작된다.
   *
   * 파라미터를 지우려고 goto를 새로 부르지 않는다. 아래 필터 → URL
   * 이펙트가 filterToParams(filter)로 쿼리스트링을 처음부터 다시 만들기
   * 때문에, 필터에 없는 play는 그 다음 갱신에서 자연히 빠진다. 이 화면에서
   * URL을 쓰는 goto가 하나뿐이라는 규칙을 지키기 위해서다.
   */
  let playHandled = false;
  $effect(() => {
    const id = page.url.searchParams.get('play');
    if (!id || playHandled) return;
    playHandled = true;
    // 없는 id면 아무 일도 하지 않는다 — 링크가 오래됐거나 삭제된 것뿐이다.
    if (untrack(() => recordings).some((r) => r.id === id)) selectRow(id);
  });
```

`untrack`으로 `recordings`를 감싸는 이유는 이 이펙트가 목록 갱신에 따라 다시 돌 필요가 없기 때문이다 — `play` 파라미터에만 반응해야 한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project client src/routes/recordings/page.svelte.test.ts`
Expected: PASS

- [ ] **Step 5: e2e를 더한다**

`tests/e2e/import-flow.spec.ts`에 더한다. 파일 상단의 기존 상수(`QTA_TITLE`, `M4A_TITLE`)를 쓴다.

```ts
  test('메인 카드에서 제목을 누르면 그 녹음이 재생된다', async ({ page }) => {
    // 즐겨찾기를 하나 지정해 메인 카드에 뜨게 한다.
    await page.goto('/recordings');
    await rowFor(page, QTA_TITLE).getByRole('button', { name: '즐겨찾기 지정' }).click();

    await page.goto('/');
    await page.getByRole('link', { name: QTA_TITLE }).click();

    await expect(page).toHaveURL(/\/recordings/);
    await expect(page.getByRole('button', { name: '일시정지' })).toBeVisible();
  });
```

`rowFor` 헬퍼가 이 파일에 이미 있다. 없으면 기존 테스트가 행을 찾는 방식을 따른다.

- [ ] **Step 6: 전체 검사**

Run: `npm test` 그리고 `npm run check`
Expected: 유닛·e2e 전부 통과, 타입 에러 0.

- [ ] **Step 7: 커밋**

```bash
git add src/routes/recordings/+page.svelte src/routes/recordings/page.svelte.test.ts tests/e2e/import-flow.spec.ts
git commit -m "feat: 메인 카드에서 누른 녹음을 목록에서 바로 재생한다"
```
