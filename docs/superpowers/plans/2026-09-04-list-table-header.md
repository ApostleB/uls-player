# 목록 테이블 헤더 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 녹음 목록의 각 열에 이름을 붙이고, 그 이름이 가리키는 열이 모든 행에서 같은 자리에 오도록 행 구조를 그리드로 바꾼다.

**Architecture:** 열 정의를 CSS 커스텀 속성 `--row-cols` 하나에 담아 목록 컨테이너에 두고, 헤더 줄과 각 `li`가 그것을 `grid-template-columns: var(--row-cols)`로 함께 참조한다. `li`는 카드로 남아 hover·선택 배경과 행 클릭 동작을 유지한다. 행마다 독립된 그리드 컨테이너이므로 내용 의존 트랙은 쓸 수 없다.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, Skeleton v5, vitest(browser mode) + vitest-browser-svelte, Playwright

## Global Constraints

- Svelte 5 룬만 쓴다: `$state`, `$derived`, `$effect`, `$props`, `$bindable`. Svelte 4 스토어·`export let` 금지
- 주석은 무엇이 아니라 **왜**를 적는다. 한국어로, 주변 문체에 맞춘다. 코드에 대해 사실이 아닌 주석은 결함이다
- 모든 테스트는 그것이 지키는 동작이 깨지면 실패해야 한다. 뮤테이션으로 증명하고 실제 출력을 보고한다
- 테스트에 고정 `setTimeout`/sleep 대기를 쓰지 않는다. 관찰 가능한 조건을 기다린다
- 열 정의에 내용 의존 트랙(`auto`, `min-content`, `max-content`, `fit-content()`)을 쓰지 않는다
- 가변 열은 `minmax(0, Nfr)`로 쓴다. `0` 최소값이 없으면 긴 제목이 트랙을 밀어낸다
- `ul`의 `space-y-1` 클래스를 유지한다 — 기존 테스트 헬퍼 `titles()`가 `ul.space-y-1 > li`로 행을 찾는다
- 각 `li`에서 **제목 버튼이 첫 번째 `<button>`으로 남아야 한다** — 같은 헬퍼가 `li.querySelector('button')`으로 제목을 집는다
- 페이지 본문은 가로로 스크롤되지 않는다. 넓은 내용은 자기 컨테이너 안에서 스크롤한다

---

### Task 1: 행을 그리드로 바꾸고 헤더 줄을 붙인다

이 태스크는 다섯 열(선택 / 제목 / 녹음일자 / 길이 / 저장된 확장자)로 끝난다. 태그는 아직 제목 칸 안에 남는다 — Task 2가 옮긴다.

**Files:**
- Modify: `src/routes/recordings/+page.svelte`
- Test: `src/routes/recordings/page.svelte.test.ts`

**Interfaces:**
- Consumes: 기존 헬퍼 `rec({ id, ... })`, `pageData(recordings)`, `titles()` (모두 `page.svelte.test.ts`에 이미 있다)
- Produces: 목록 컨테이너의 `--row-cols` 커스텀 속성과, 그것을 참조하는 헤더 줄(`[data-testid="list-header"]`). Task 2가 여기에 태그 열을 추가한다

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/recordings/page.svelte.test.ts` 맨 아래에 새 describe를 추가한다.

`rec()`의 기본 `files`는 `{ original: { ext: 'qta', bytes: 100 } }`라 배지가 하나다. **배지 개수가 서로 다른 행을 일부러 섞는다** — 확장자 열을 내용 의존 트랙으로 두면 행마다 폭이 달라지는데, 배지 개수가 모두 같으면 그 결함이 드러나지 않는다.

```ts
describe('+page.svelte — 목록 테이블 헤더', () => {
  /** 배지 개수가 서로 다른 세 행. 내용 의존 트랙이면 폭이 갈린다. */
  function rowsWithDifferentBadgeCounts() {
    return pageData([
      rec({ id: '1', title: '레인', files: { original: { ext: 'qta', bytes: 100 } } }),
      rec({
        id: '2',
        title: '정류장',
        files: { original: { ext: 'qta', bytes: 100 }, mp3: { ext: 'mp3', bytes: 200 } }
      }),
      rec({
        id: '3',
        title: '새벽',
        files: {
          original: { ext: 'qta', bytes: 100 },
          mp3: { ext: 'mp3', bytes: 200 },
          wav: { ext: 'wav', bytes: 300 }
        }
      })
    ]);
  }

  function header(): HTMLElement {
    const el = document.querySelector('[data-testid="list-header"]');
    if (!el) throw new Error('헤더 줄이 없다');
    return el as HTMLElement;
  }

  function rows(): HTMLElement[] {
    return Array.from(document.querySelectorAll('ul.space-y-1 > li')) as HTMLElement[];
  }

  it('다섯 열 이름을 보여준다', async () => {
    render(Page, { data: rowsWithDifferentBadgeCounts() });

    expect(header().textContent).toContain('선택');
    expect(header().textContent).toContain('제목');
    expect(header().textContent).toContain('녹음일자');
    expect(header().textContent).toContain('길이');
    expect(header().textContent).toContain('저장된 확장자');
  });

  it('헤더와 모든 행의 열 폭이 실제로 같다', async () => {
    // 이게 이 기능의 본체다. "정렬됐다"를 눈이 아니라 계산된 값으로
    // 확인한다 — getComputedStyle의 grid-template-columns는 사용된 픽셀
    // 폭으로 해석돼 돌아오므로, 헤더와 행이 같은 문자열이면 같은 자리에
    // 있다는 뜻이다. 배지 개수가 다른 행을 섞어 뒀으므로, 확장자 열이
    // 내용 의존 트랙이면 행끼리 값이 갈려 여기서 걸린다.
    render(Page, { data: rowsWithDifferentBadgeCounts() });

    const expected = getComputedStyle(header()).gridTemplateColumns;
    expect(expected).not.toBe('');
    expect(expected).not.toBe('none');

    for (const row of rows()) {
      expect(getComputedStyle(row).gridTemplateColumns).toBe(expected);
    }
  });

  it('열 정의에 내용 의존 트랙이 없다', async () => {
    // 위 테스트는 지금 이 화면 폭에서 우연히 값이 맞아떨어질 수도 있다.
    // 정의 자체에 내용 의존 트랙이 없다는 것까지 못박아, 폭이 달라져도
    // 정렬이 유지되는 근거를 남긴다.
    render(Page, { data: rowsWithDifferentBadgeCounts() });

    const cols = getComputedStyle(header()).getPropertyValue('--row-cols');
    expect(cols.trim()).not.toBe('');
    expect(cols).not.toMatch(/\bauto\b|min-content|max-content|fit-content/);
  });

  it('보여줄 행이 없으면 헤더도 렌더하지 않는다', async () => {
    // 아무것도 없는 위에 열 이름만 떠 있는 상태를 만들지 않는다.
    render(Page, { data: pageData([]) });

    expect(document.querySelector('[data-testid="list-header"]')).toBeNull();
  });

  it('빈 상태 카드는 열 정의를 쓰지 않고 전체 폭을 쓴다', async () => {
    render(Page, { data: pageData([]) });

    const emptyCard = rows()[0];
    expect(emptyCard.textContent).toContain('아직 가져온 녹음이 없습니다');
    expect(getComputedStyle(emptyCard).display).not.toBe('grid');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/routes/recordings/page.svelte.test.ts
```

Expected: 새 테스트 5개 중 최소 4개가 FAIL — `헤더 줄이 없다`로 던지거나, 행이 아직 `flex`라 `gridTemplateColumns`가 `none`이다

- [ ] **Step 3: 목록을 그리드 컨테이너로 감싸고 헤더 줄을 넣는다**

`src/routes/recordings/+page.svelte`에서 `<ul class="space-y-1">`로 시작하는 블록을 찾아, `ul` 바깥을 다음으로 감싼다. `ul` 자체와 그 안의 `{#each}`는 건드리지 않는다.

```svelte
  <!-- 열 정의를 여기 한 곳에 두고 헤더 줄과 각 행이 함께 참조한다.
       행은 각각 독립된 그리드 컨테이너라, 내용에 따라 폭이 정해지는
       트랙(auto·min-content·max-content·fit-content)을 쓰면 행마다
       계산 결과가 달라져 열이 다시 어긋난다 — 특히 확장자 배지는
       행마다 개수가 다르다. 그래서 전부 fr과 고정 rem으로만 적는다.
       가변 열의 minmax(0, ...)에서 0 최소값을 빼면 긴 제목이 트랙을
       밀어낸다. -->
  <div class="overflow-x-auto" style="--row-cols: 2rem minmax(0,3fr) 11rem 5rem 9rem;">
    <div class="min-w-[48rem]">
      {#if shown.length}
        <!-- 이 목록은 table이 아니라 ul/li라 이 줄은 셀과 의미적으로
             연결되지 않는다. 각 셀은 이미 자기 내용을 읽을 수 있게
             갖고 있으므로(제목 버튼, 날짜·길이 텍스트, 포맷 배지),
             연결 없는 라벨이 따로 읽히지 않도록 장식으로 둔다. -->
        <div data-testid="list-header" aria-hidden="true"
          class="text-surface-500 grid items-center gap-3 p-3 text-sm"
          style="grid-template-columns: var(--row-cols);">
          <span>선택</span>
          <span>제목</span>
          <span>녹음일자</span>
          <span>길이</span>
          <span>저장된 확장자</span>
        </div>
      {/if}

      <ul class="space-y-1">
        <!-- 기존 내용 그대로 -->
      </ul>
    </div>
  </div>
```

- [ ] **Step 4: 행을 그리드로 바꾼다**

같은 파일에서 행의 `li` 여는 태그를 찾아 `flex`를 `grid`로 바꾸고 열 정의를 참조하게 한다. `class:preset-tonal-primary`와 `onclick`은 그대로 둔다.

바꾸기 전:

```svelte
      <li class="card hover:preset-tonal flex items-center gap-3 p-3"
```

바꾼 뒤:

```svelte
      <li class="card hover:preset-tonal grid items-center gap-3 p-3"
        style="grid-template-columns: var(--row-cols);"
```

본문 칸의 `<div class="flex min-w-0 grow flex-col gap-1" ...>`에서 `grow`를 뺀다 — 그리드에서는 트랙이 폭을 정하므로 `grow`가 할 일이 없고, 남겨두면 의도를 오해하게 한다. `min-w-0`은 **반드시 남긴다**(긴 제목이 트랙을 넘지 않게 막는다).

```svelte
        <div class="flex min-w-0 flex-col gap-1" onclick={(e) => e.stopPropagation()}>
```

날짜·길이·배지 칸의 `shrink-0`도 뺀다 — flex 전용 속성이라 그리드에서 아무 일도 하지 않는다.

```svelte
        <span class="text-surface-500 text-sm tabular-nums">
          {rec.recordedAt.replace('T', ' ').slice(0, 16)}
        </span>
        <span class="text-sm tabular-nums">{fmt(rec.durationSec)}</span>
        <div class="flex gap-1">
```

- [ ] **Step 5: 빈 상태 카드가 그리드를 쓰지 않는지 확인**

같은 파일의 `{:else}` 가지에 있는 빈 상태 `li`는 그대로 둔다 — `grid` 클래스도 `style`도 붙이지 않는다. 이미 그런 상태라면 아무것도 고치지 않는다.

```svelte
      <li class="card preset-tonal p-8 text-center">
```

- [ ] **Step 6: 테스트를 돌려 정렬이 실제로 맞는지 본다**

```bash
npx vitest run src/routes/recordings/page.svelte.test.ts
```

Expected: 새 테스트 5개 전부 PASS

**"헤더와 모든 행의 열 폭이 실제로 같다"가 실패하면**, 헤더 줄과 `li`의 가로 박스가 다르다는 뜻이다. `card` 클래스가 테두리나 자체 패딩을 더해 내용 폭이 어긋나는 경우가 대표적이다. **단언을 약하게 만들지 말고** 헤더의 가로 박스를 행에 맞춘다 — 같은 두께의 투명 테두리를 주거나 패딩을 맞춘다. 무엇을 왜 맞췄는지 보고한다.

- [ ] **Step 7: 뮤테이션으로 판별력 확인**

세 가지를 각각 해보고 되돌린 뒤, 실제 출력과 함께 보고한다.

1. `--row-cols`의 마지막 `9rem`을 `auto`로 바꾼다 → 배지 개수가 다른 행끼리 폭이 갈려 "열 폭이 실제로 같다"와 "내용 의존 트랙이 없다"가 실패해야 한다
2. 헤더 줄의 `{#if shown.length}`를 지워 항상 렌더하게 한다 → "행이 없으면 헤더도 렌더하지 않는다"가 실패해야 한다
3. `li`의 `style="grid-template-columns: var(--row-cols);"`를 지운다 → "열 폭이 실제로 같다"가 실패해야 한다

- [ ] **Step 8: 기존 테스트가 그대로 통과하는지 확인**

행 구조가 flex에서 grid로 바뀌었으므로 기존 행 클릭·선택 테스트가 영향을 받을 수 있다.

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

Expected: 전부 통과. 기존 테스트가 깨지면 **셀렉터만 고치고 검증 내용은 바꾸지 않는다.** 무엇을 왜 고쳤는지 보고한다.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: 목록에 열 이름을 붙이고 행을 그리드로 정렬한다

행이 카드 flex라 각 행이 자기 내용에 맞춰 폭을 정했다 — 확장자 배지
개수가 행마다 달라 마지막 칸부터 어긋났고, 열이라는 개념이 성립하지
않았다.

열 정의를 --row-cols 한 곳에 두고 헤더 줄과 각 행이 함께 참조한다.
행이 각각 독립된 그리드 컨테이너라 내용 의존 트랙은 쓸 수 없어,
전부 fr과 고정 rem으로 적었다.

정렬은 눈으로 보는 속성이라 그대로 단언하면 헛돌기 쉬워, 계산된
grid-template-columns가 헤더와 모든 행에서 같은지로 확인한다."
```

---

### Task 2: 태그를 자기 열로 분리한다

**Files:**
- Modify: `src/routes/recordings/+page.svelte`
- Test: `src/routes/recordings/page.svelte.test.ts`

**Interfaces:**
- Consumes: Task 1의 `--row-cols`와 `[data-testid="list-header"]`
- Produces: 여섯 열 목록. 태그가 제목 칸이 아니라 자기 열에 렌더된다

- [ ] **Step 1: 실패 테스트 작성**

Task 1이 만든 describe 안에 추가한다.

```ts
  it('태그가 제목 칸이 아니라 자기 열에 렌더된다', async () => {
    // 제목 칸(제목·설명이 세로로 쌓인 div) 안에 태그 칩이 남아 있으면
    // 열로 분리된 게 아니다. 칩이 화면 어딘가에 있다는 것만 확인하면
    // 분리 전에도 통과하므로, "제목 칸 안에는 없다"까지 본다.
    render(Page, { data: pageData([rec({ id: '1', title: '레인', tags: ['데모'] })]) });

    const row = document.querySelector('ul.space-y-1 > li') as HTMLElement;
    const titleCell = row.querySelector('button')!.closest('div')!;

    expect(titleCell.textContent).not.toContain('데모');
    expect(row.textContent).toContain('데모');
  });

  it('여섯 번째 열 이름으로 태그를 보여준다', async () => {
    render(Page, { data: pageData([rec({ id: '1', title: '레인', tags: ['데모'] })]) });

    const labels = Array.from(header().children).map((c) => c.textContent?.trim());
    expect(labels).toEqual(['선택', '제목', '태그', '녹음일자', '길이', '저장된 확장자']);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/routes/recordings/page.svelte.test.ts
```

Expected: 새 2개가 FAIL — 태그가 아직 제목 칸 안에 있고, 헤더 라벨이 다섯 개다

- [ ] **Step 3: 열 정의에 태그 열을 넣는다**

`--row-cols`를 여섯 열로 바꾸고, 최소 폭도 함께 늘린다.

```svelte
  <div class="overflow-x-auto" style="--row-cols: 2rem minmax(0,3fr) minmax(0,2fr) 11rem 5rem 9rem;">
    <div class="min-w-[56rem]">
```

헤더 줄에 라벨을 넣는다. 순서가 열 순서와 같아야 한다.

```svelte
          <span>선택</span>
          <span>제목</span>
          <span>태그</span>
          <span>녹음일자</span>
          <span>길이</span>
          <span>저장된 확장자</span>
```

- [ ] **Step 4: 태그 블록을 제목 칸 밖으로 옮긴다**

본문 `div`(제목·설명이 든 `flex min-w-0 flex-col gap-1`) 안에서 태그 블록 전체 — `{#if editingTagsId === rec.id}`부터 짝이 되는 `{/if}`까지 — 를 잘라내어, 그 `div`가 닫힌 **바로 다음**에 붙인다. 태그 열은 제목 열 다음, 녹음일자 앞이다.

옮긴 블록을 자기 칸으로 감싼다. `onclick`의 `stopPropagation`을 반드시 함께 옮긴다 — 이게 없으면 태그를 편집하려는 클릭이 행 선택으로 번진다.

```svelte
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- 태그 편집(더블클릭 진입, TagInput, 완료 버튼)은 행 선택과
             무관한 별개 동작이라, 여기서도 행 클릭이 번지지 않게 끊는다.
             이 div를 새 상호작용 요소로 만드는 게 아니라, 안에 이미 있는
             컨트롤의 동작을 행 선택이 가리지 않게 하는 것이다. -->
        <div class="min-w-0" onclick={(e) => e.stopPropagation()}>
          {#if editingTagsId === rec.id}
            <div class="flex flex-wrap items-center gap-2">
              <TagInput bind:tags={tagsDraft} suggestions={tagNames} />
              <button type="button" class="btn btn-sm preset-filled"
                onclick={() => commitTags(rec.id)}>완료</button>
            </div>
          {:else}
            <button type="button" class="flex flex-wrap gap-1 text-left"
              ondblclick={() => startEditTags(rec)}>
              {#each rec.tags as t (t)}<span class="chip preset-tonal">{t}</span>{/each}
              {#if !rec.tags.length}<span class="text-surface-500 text-sm">태그 없음</span>{/if}
            </button>
          {/if}
        </div>
```

- [ ] **Step 5: 제목이 여전히 행의 첫 번째 button인지 확인한다**

`titles()` 헬퍼가 `li.querySelector('button')`으로 제목을 집는다. 태그 열은 제목 열 **뒤**에 오므로 순서가 유지되지만, 실제로 그런지 확인한다.

```bash
npx vitest run src/routes/recordings/page.svelte.test.ts
```

Expected: 새 2개 포함 전부 PASS. `titles()`를 쓰는 기존 필터 테스트가 깨졌다면 태그 블록이 제목보다 앞에 놓인 것이다 — 순서를 바로잡는다

- [ ] **Step 6: 뮤테이션으로 판별력 확인**

두 가지를 각각 해보고 되돌린 뒤, 실제 출력과 함께 보고한다.

1. 태그 블록을 다시 제목 칸 `div` 안으로 되돌린다 → "태그가 제목 칸이 아니라 자기 열에 렌더된다"가 실패해야 한다
2. 태그 칸의 `onclick={(e) => e.stopPropagation()}`을 지운다 → 태그 편집 관련 기존 테스트 중 하나가 실패해야 한다. 아무것도 실패하지 않으면 그 동작을 지키는 테스트가 없다는 뜻이므로 **그 사실을 보고한다**

- [ ] **Step 7: 네 가지 검증**

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

기존 태그 인라인 편집 테스트(더블클릭 편집, 일괄 추가·제거, 편집 중 행 이탈 시 저장)는 **검증 내용을 바꾸지 않고** 통과해야 한다. 셀렉터만 고쳤다면 무엇을 왜 고쳤는지 보고한다.

- [ ] **Step 8: 실제로 써본다**

```bash
npm run dev
```

태그가 많은 행에서 칩이 자기 열 안에서 줄바꿈하는지, 그 행과 태그가 없는 행의 다른 열들이 여전히 같은 자리에 있는지, 창을 좁혔을 때 목록만 가로로 스크롤되고 페이지 본문은 안 밀리는지 확인하고 본 것을 보고한다. 브라우저를 못 띄우면 그렇게 밝힌다.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: 태그를 목록의 자기 열로 분리한다

태그는 이 앱의 핵심 축인데 제목·설명과 한 칸에 쌓여 있어 세로로
훑을 수가 없었다. 자기 열로 빼면서 인라인 편집(더블클릭 진입,
TagInput, 완료 버튼)과 행 선택으로 번지지 않게 막는 전파 차단도
함께 옮겼다.

제목은 행의 첫 번째 button 자리를 지킨다 — 기존 테스트 헬퍼가
그 위치로 제목을 집는다."
```

---

## 자체 검토

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| 3절 여섯 열 구성 | Task 1(다섯 열) + Task 2(태그 열 추가) |
| 4절 `--row-cols` 공유 | Task 1 Step 3·4 |
| 4절 내용 의존 트랙 금지 | Task 1 Step 1의 "내용 의존 트랙이 없다" 테스트, Step 7 뮤테이션 1 |
| 4절 `minmax(0, Nfr)` | Task 1 Step 3, Task 2 Step 3 |
| 5절 좁은 화면 가로 스크롤 | Task 1 Step 3의 `overflow-x-auto` + `min-w`, Task 2 Step 8 수동 확인 |
| 6절 빈 상태 전체 폭 | Task 1 Step 5, "빈 상태 카드는 열 정의를 쓰지 않고" 테스트 |
| 6절 행 없으면 헤더 없음 | Task 1 Step 1 테스트, Step 7 뮤테이션 2 |
| 7절 헤더 `aria-hidden` | Task 1 Step 3 |
| 8절 태그 편집 통째 이동 | Task 2 Step 4 |
| 9절 기존 태그 편집 테스트 유지 | Task 2 Step 7 |

**플레이스홀더 점검**

TBD·TODO·"적절히 처리"류 없음. 코드 스텝에는 실제 코드가 들어 있다.

Task 1 Step 6에 조건부 지시가 하나 있다("정렬이 안 맞으면 헤더의 가로 박스를 행에 맞춘다"). `card` 클래스가 테두리를 더하는지는 이 스펙이 정할 수 있는 값이 아니라 실행해 봐야 아는 사실이라, 없는 값을 지어내는 대신 **단언을 약화하지 말 것**과 **무엇을 왜 맞췄는지 보고할 것**을 못박았다.

**타입 일관성**

`rec({ id, title, tags, files })`, `pageData(recordings)`, `titles()`는 모두 `page.svelte.test.ts`에 이미 있는 시그니처를 그대로 쓴다. 새 헬퍼 `header()`·`rows()`·`rowsWithDifferentBadgeCounts()`는 Task 1에서 정의하고 Task 2가 그대로 쓴다.

`--row-cols`는 Task 1이 다섯 값, Task 2가 여섯 값으로 다시 쓴다. Task 2 Step 3이 그 줄을 통째로 교체하므로 두 태스크의 정의가 어긋나지 않는다.

**남는 위험 하나**

`getComputedStyle(...).gridTemplateColumns`는 사용된 픽셀 폭으로 해석돼 돌아온다. 테스트 브라우저의 폭이 `min-w-[48rem]`보다 좁으면 `overflow-x-auto` 안에서 최소 폭이 적용되는데, 헤더와 행이 같은 컨테이너 안에 있으므로 둘 다 같은 값을 받는다 — 그래서 비교 자체는 성립한다. 다만 값이 `none`이나 빈 문자열로 나오면 그리드가 적용되지 않은 것이므로, Step 1의 테스트가 그 경우를 먼저 걸러내도록 `not.toBe('none')`을 넣어 뒀다.
