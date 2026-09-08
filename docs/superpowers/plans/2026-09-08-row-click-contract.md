# 행 클릭 계약 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 행을 누르는 것이 항상 "듣겠다"는 뜻이 되게 하고, 재생 바가 조작 도중에 나타나 클릭을 가로채는 일을 없앤다.

**Architecture:** 두 가지를 각각 고친다. (1) 목록이 `selectedId`와 별개로 `playRequest` 카운터를 올려 재생 의사를 신호로 보내고, `Player`의 이펙트가 id 변화와 요청 변화를 구분해 처리한다. (2) `Player`의 바를 감싸던 `{#if recording}`를 걷어내 바가 항상 같은 높이로 존재하게 하고, 안쪽 조각들이 각자 녹음 없는 경우를 감당한다.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), TypeScript, Tailwind + Skeleton, Vitest(browser+node 두 프로젝트), Playwright.

## Global Constraints

- 재생 상태는 `<audio>`의 `bind:paused`가 소유한다. `audio.play()` / `audio.pause()`를 직접 부르지 않는다 — 이 저장소가 desync로 당한 적이 있다. `audio.load()`는 리소스 조작이라 허용된다.
- **재생 중인 행을 다시 눌러도 재생 위치가 0으로 돌아가지 않는다.** 클릭이 먹었는지 몰라 여러 번 누르는 것이 자동재생 기능의 출발점이라, 그때 처음부터 다시 시작하면 원래 문제보다 나쁘다.
- **목록 갱신으로 `recording` 참조만 바뀌는 경우 아무 일도 일어나지 않아야 한다.** `send()`가 PATCH 응답으로 목록을 통째로 덮어쓰면 같은 id를 가진 새 객체가 되어 이펙트가 재실행된다. 그때 리셋이 돌면 재생 위치와 A-B 구간이 조용히 사라진다.
- 빈 바의 높이는 **북마크가 없는 녹음을 골랐을 때의 바 높이**와 같아야 한다.
- 빈 바의 안내 문구는 정확히 `목록에서 녹음을 고르세요`.
- 이 저장소의 컴포넌트 테스트는 `+layout.svelte` 없이 페이지를 단독 마운트해 Tailwind가 적용되지 않는다. 높이·배치를 재는 테스트는 `app.css`를 직접 import하는 파일에 둔다 — `src/routes/recordings/list-header-alignment.svelte.test.ts`가 그 예다.
- 테스트 파일 이름이 러너를 정한다: `*.svelte.test.ts`는 browser 프로젝트(`--project client`), 그 밖의 `*.test.ts`는 node 프로젝트(`--project server`).
- Vitest 설정에 `expect: { requireAssertions: true }` — 모든 테스트가 단언을 가져야 한다.
- 이 머신에서 다른 프로세스가 동시에 Playwright를 돌릴 때가 있다. `wrapDynamicImport` 오류가 나거나 실행이 몇 분씩 걸리면 그것은 머신 경합이지 당신의 변경 탓이 아니다 — 디버깅하지 말고 다시 돌린다.

## File Structure

| 파일 | 책임 | 처리 |
|---|---|---|
| `src/routes/recordings/+page.svelte` | `playRequest` 상태와 `selectRow`, Player에 prop 전달 | 수정 (Task 1) |
| `src/lib/components/Player.svelte` | `playRequest` prop, 이펙트 분기 (Task 1) / 바를 항상 렌더 (Task 2) | 수정 |
| `src/lib/components/Player.svelte.test.ts` | 이어서 재생과 위치 보존 | 수정 (Task 1) |
| `src/routes/recordings/page.svelte.test.ts` | 행 클릭이 `playRequest`를 올리는지 | 수정 (Task 1) |
| `src/routes/recordings/list-header-alignment.svelte.test.ts` | 빈 바와 선택된 바의 높이가 같은지 | 수정 (Task 2) |
| `tests/e2e/import-flow.spec.ts` | `scrollIntoView` 우회 제거 | 수정 (Task 2) |

---

### Task 1: `playRequest`로 재생 의사를 보낸다

**Files:**
- Modify: `src/routes/recordings/+page.svelte`
- Modify: `src/lib/components/Player.svelte`
- Test: `src/lib/components/Player.svelte.test.ts`
- Test: `src/routes/recordings/page.svelte.test.ts`

**Interfaces:**
- Produces: `Player`가 `playRequest: number` prop을 새로 받는다. 기본값 `0`. 기존 props(`recording`, `formats`, `mediaDir`, `onbookmark`, `onbookmarkchange`)는 그대로.
- Produces: `+page.svelte`에 `function selectRow(id: string): void` — `selectedId`를 세팅하고 `playRequest`를 1 올린다.

**배경 — 왜 카운터인가.** 같은 행을 다시 누르면 `selectedId = rec.id`가 같은 값 재대입이라 Svelte `$state` 수준에서 무변화다. 이펙트가 돌지 않는다. 설령 돌아도 `Player.svelte`의 `if (id === lastId) return`이 막는다. 막는 것이 두 겹이므로 `selectedId`와 별개인 신호가 필요하다.

- [ ] **Step 1: 실패하는 테스트를 쓴다 (Player)**

`src/lib/components/Player.svelte.test.ts`의 기존 관례를 따른다 — 이 파일은 실제 네트워크 404 경합을 피하려고 `tick()` 패턴을 쓴다. 기존 테스트 하나를 열어 setup 헬퍼와 `rerender` 사용법을 확인한 뒤, 그 형태로 다음 세 개를 더한다.

```ts
  it('일시정지된 녹음에 재생 요청이 오면 이어서 재생한다', async () => {
    const { rerender, audio } = await setupPlaying();   // 기존 헬퍼 이름에 맞춰 조정
    audio.currentTime = 12;
    await pause();                                       // 스페이스나 버튼으로 멈춘다
    expect(audio.paused).toBe(true);

    await rerender({ playRequest: 1 });
    await vi.waitFor(() => expect(audio.paused).toBe(false));
    // 이어서 재생이지 다시 시작이 아니다.
    expect(audio.currentTime).toBeGreaterThan(11);
  });

  it('재생 중에 재생 요청이 와도 위치가 0으로 돌아가지 않는다', async () => {
    const { rerender, audio } = await setupPlaying();
    audio.currentTime = 12;

    await rerender({ playRequest: 1 });
    await tick();
    expect(audio.currentTime).toBeGreaterThan(11);
    expect(audio.paused).toBe(false);
  });

  it('같은 녹음의 새 객체로 바뀌어도(목록 갱신) 위치가 유지된다', async () => {
    // send()가 PATCH 응답으로 목록을 덮어쓰면 같은 id의 새 객체가 온다.
    // playRequest는 그대로이므로 아무 일도 일어나면 안 된다.
    const { rerender, audio, recording } = await setupPlaying();
    audio.currentTime = 12;

    await rerender({ recording: { ...recording, description: '고침' } });
    await tick();
    expect(audio.currentTime).toBeGreaterThan(11);
  });
```

기존 헬퍼 이름이 다르면 그 파일에 실제로 있는 것으로 맞춘다. **단언은 위 그대로 유지한다.**

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project client src/lib/components/Player.svelte.test.ts`
Expected: 앞의 두 개가 FAIL — `playRequest` prop이 없어 무시되므로 일시정지 상태가 그대로다. 세 번째는 기존 `lastId` 가드 덕에 이미 PASS일 수 있다(그건 정상이다 — 회귀 방지용이다). 관찰한 그대로 보고한다.

- [ ] **Step 3: `Player.svelte`에 prop과 분기를 넣는다**

props 블록에 더한다:

```ts
    mediaDir = '',
    /**
     * 행을 누를 때마다 오르는 카운터. selectedId만으로는 "이미 고른 행을
     * 다시 눌렀다"를 전할 수 없다 — 같은 값 재대입은 Svelte 수준에서
     * 무변화라 이펙트가 돌지 않는다.
     */
    playRequest = 0,
```

`lastId` 이펙트를 다음으로 바꾼다. 기존 주석 블록(참조 교체로 인한 재실행을 막는 이유)은 그대로 두고, 아래 구조만 갈아끼운다:

```ts
  let lastId: string | null = null;
  let lastPlayRequest = 0;
  $effect(() => {
    const id = recording?.id ?? null;
    const req = playRequest;

    const idChanged = id !== lastId;
    const requested = req !== lastPlayRequest;
    lastId = id;
    lastPlayRequest = req;

    // 참조만 바뀐 경우다(목록 갱신). 아무것도 건드리지 않는다.
    if (!idChanged && !requested) return;

    if (!idChanged) {
      // 이미 고른 행을 다시 눌렀다. 리셋하지 않는다 — 위치도 A-B 구간도
      // 그대로 두고, 멈춰 있었다면 이어서 재생만 한다.
      //
      // 여기서는 id가 바뀔 때와 달리 이중 쓰기가 필요 없다. 재생 중이면
      // paused가 이미 false고, 거기에 false를 넣는 것이 무변화라는 사실이
      // 정확히 원하는 "아무 일 없음"이다.
      paused = false;
      return;
    }

    if (!id) {
      peaks = [];
      return;
    }

    untrack(() => {
      // ... 기존 리셋 로직을 그대로 둔다 (format 보정, current = 0,
      // loopA/loopB 초기화, loadState = 'loading', paused 이중 쓰기,
      // 파형 fetch)
    });
  });
```

**기존 `untrack` 블록 안의 내용은 한 줄도 바꾸지 않는다.** 그 안의 `paused = true; paused = false;` 이중 쓰기도 그대로다 — 재생 중인 행에서 다른 행으로 넘어갈 때 새 행이 조용히 안 울리는 것을 막는 장치다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project client src/lib/components/Player.svelte.test.ts`
Expected: PASS

- [ ] **Step 5: 목록 쪽 테스트를 쓴다**

`src/routes/recordings/page.svelte.test.ts`에 더한다. 이 파일은 `$app/navigation`과 `$app/state`를 모킹하고 `render(Page, { data })`로 마운트한다 — 기존 테스트를 열어 그 setup을 따른다.

```ts
  it('이미 고른 행을 다시 눌러도 재생 요청이 올라간다', async () => {
    // 재생 의사는 selectedId가 아니라 이 카운터가 나른다. 같은 행을 다시
    // 누르면 selectedId는 같은 값이라 아무 신호도 안 나간다.
    const { getByRole } = render(Page, { data: baseData() });
    const row = getByRole('button', { name: '레인', exact: true });

    await row.click();
    await tick();
    const first = playerPlayRequest();   // 아래 헬퍼

    await row.click();
    await tick();
    expect(playerPlayRequest()).toBe(first + 1);
  });
```

`playerPlayRequest()`는 화면에서 직접 읽을 수 없으므로, **관찰 가능한 결과로 바꿔 쓴다**: 행을 두 번 누른 뒤 재생기가 일시정지에서 재생으로 돌아오는지를 본다. 이 파일이 이미 재생기 상태를 어떻게 관찰하는지 확인하고(`playerShows()` 같은 헬퍼가 있다) 그 방식을 따른다. 관찰할 방법을 못 찾으면 이 테스트는 Player 쪽(Step 1)에 이미 있으니 생략하고, 대신 **행 클릭 네 곳이 모두 `selectRow`를 부르는지**를 단언하는 테스트로 대체한다.

- [ ] **Step 6: `+page.svelte`를 고친다**

`selectedId` 선언 근처에 더한다:

```ts
  let selectedId = $state<string | null>(null);
  /**
   * 행을 누르는 것은 듣겠다는 뜻이다. selectedId만으로는 그 뜻을 전할 수
   * 없다 — 이미 고른 행을 다시 누르면 같은 값 재대입이라 Svelte 수준에서
   * 무변화라서, 재생기가 그 클릭을 볼 방법이 없다. 누를 때마다 오르는
   * 카운터를 함께 보낸다.
   */
  let playRequest = $state(0);

  function selectRow(id: string) {
    selectedId = id;
    playRequest += 1;
  }
```

네 곳의 `onclick={() => (selectedId = rec.id)}`를 전부 `onclick={() => selectRow(rec.id)}`로 바꾼다. 위치는 행 자체(`li` 근처), 제목 버튼, 설명 버튼, 태그 버튼이다 — `grep -n "selectedId = rec.id" src/routes/recordings/+page.svelte`로 정확히 찾는다.

`<Player>` 호출에 prop을 더한다:

```svelte
<Player
  recording={selected}
  {playRequest}
  formats={['original', ...data.formats]}
  mediaDir={data.mediaDir}
  onbookmark={addBookmark}
  onbookmarkchange={changeBookmarks}
/>
```

- [ ] **Step 7: 전체 검사**

Run: `npm test` 그리고 `npm run check`
Expected: 유닛·e2e 전부 통과, 타입 에러 0.

- [ ] **Step 8: 커밋**

```bash
git add src/routes/recordings/+page.svelte src/lib/components/Player.svelte src/lib/components/Player.svelte.test.ts src/routes/recordings/page.svelte.test.ts
git commit -m "feat: 일시정지된 행을 다시 누르면 이어서 재생한다"
```

---

### Task 2: 재생 바를 항상 표시한다

**Files:**
- Modify: `src/lib/components/Player.svelte` (템플릿)
- Test: `src/routes/recordings/list-header-alignment.svelte.test.ts`
- Modify: `tests/e2e/import-flow.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `playRequest` prop (템플릿은 쓰지 않지만 같은 파일을 만진다).
- Produces: 없음. 외부 인터페이스는 그대로다.

**배경.** `Player.svelte:333`의 `{#if recording}`가 바 전체를 감싼다. `selectedId`는 `null`에서 시작해 다시 `null`이 되는 경로가 없으므로, 바가 새로 나타나는 순간은 페이지 로드 후 첫 행 클릭 한 번뿐이다. 그 한 번이 더블클릭과 겹치면 첫 클릭이 바를 마운트해 방금 누른 버튼을 덮고, 두 번째 클릭이 바에 꽂혀 `dblclick`이 발생하지 않는다.

**주된 위험:** 그 `{#if}` 하나가 지금 본문 전체에서 `recording`의 존재를 보장하고 있다. 걷어내면 안쪽 조각들이 각자 없는 경우를 감당해야 한다. `recording!` 단언으로 덮으면 빈 바에서 런타임 오류가 난다.

- [ ] **Step 1: 실패하는 높이 테스트를 쓴다**

`src/routes/recordings/list-header-alignment.svelte.test.ts`에 더한다. 이 파일은 맨 위에서 `import '../../app.css';`를 하는 **유일한** 컴포넌트 테스트라 `getBoundingClientRect()`가 의미를 갖는다. 기존 테스트의 setup(모킹, 마운트, 측정 방식)을 그대로 따른다.

```ts
  it('빈 재생 바와 녹음을 고른 재생 바의 높이가 같다', async () => {
    // 높이가 다르면 행을 고르는 순간 레이아웃이 움직이고, 그 프레임에
    // 더블클릭의 두 번째 클릭이 바에 가로채인다. 같은 높이여야 그 경합
    // 자체가 성립하지 않는다.
    const { getByTestId } = render(Page, { data: baseData() });

    const bar = () => (getByTestId('player-bar').element() as HTMLElement).getBoundingClientRect().height;
    const empty = bar();

    await getByRole('button', { name: '레인', exact: true }).click();
    await tick();
    const loaded = bar();

    expect(loaded).toBe(empty);
  });
```

`data-testid="player-bar"`를 Step 3에서 바깥 `div`에 붙인다. 픽스처의 녹음에 북마크가 없어야 한다 — 있으면 북마크 줄만큼 높아진다(스펙 2.3절).

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project client src/routes/recordings/list-header-alignment.svelte.test.ts`
Expected: FAIL — `player-bar`가 없어 조회가 실패한다.

- [ ] **Step 3: 템플릿을 고친다**

`{#if recording}` … `{/if}`를 걷어내고 바깥 `div`를 항상 렌더한다. `data-testid="player-bar"`를 붙인다:

```svelte
<div data-testid="player-bar"
  class="bg-surface-100-900 border-surface-200-800 fixed inset-x-0 bottom-0 border-t p-3">
  {#if recording}
    <audio
      bind:this={audio}
      {src}
      bind:volume
      bind:muted
      bind:playbackRate={rate}
      bind:paused
      ontimeupdate={onTimeUpdate}
      onended={onEnded}
      onloadstart={() => (loadState = 'loading')}
      oncanplay={() => (loadState = 'ready')}
      onerror={() => (loadState = 'error')}
    ></audio>
  {/if}
```

`<audio>`만 조건부로 남기는 이유: `src`가 빈 문자열이면 브라우저가 문서 URL을 받아와 `error`를 내고 빈 바가 "불러오지 못했습니다"를 보여준다. 그리고 `<audio>`는 `controls` 없이는 레이아웃 상자를 만들지 않으므로, 조건부로 둬도 높이에 영향이 없다.

안쪽 조각을 하나씩 고친다:

**제목 줄** — `recording.title` 자리에 안내 문구를 둔다:

```svelte
        <strong class="truncate">{recording?.title ?? '목록에서 녹음을 고르세요'}</strong>
```

시간 표시(`{fmt(current)} / {fmt(duration)}`)는 그대로 둔다 — 녹음이 없으면 `0:00 / 0:00`이 나오고, 높이가 유지된다.

**전송 컨트롤** — 녹음이 없으면 누를 수 없게 한다. 재생 버튼은 기존 `disabled`에 조건을 더한다:

```svelte
          disabled={!recording || loadState === 'loading'}
```

`−10초`·`−5초`·`+5초`·`+10초`·`A 지정`·`북마크` 버튼에도 `disabled={!recording}`를 더한다.

**포맷 버튼 줄** — `available`이 빈 배열이면 `{#each}`가 아무것도 그리지 않는다. 다만 그 안에서 `recording.files.original.ext`와 `recording.id`를 읽으므로 `svelte-check`가 null 가능성을 문제 삼는다. 옵셔널 체이닝으로 바꾼다:

```svelte
                {f === 'original' ? (recording?.files.original.ext ?? '원본') : f}
```
```svelte
              <a class="btn btn-sm preset-tonal" href="/api/media/{recording?.id}/{f}" download
```

**경로 표시 줄 — 여기가 높이가 어긋나는 유일한 지점이다.** 지금은 `{#if filePath}`로 걸려 있어 녹음이 없으면 그 줄이 통째로 사라진다. 조건을 걷어내고 항상 그린다:

```svelte
      <!-- 녹음이 없을 때도 이 줄을 그린다 — 빼면 빈 바가 선택된 바보다
           한 줄만큼 낮아져서, 고르는 순간 레이아웃이 움직이는 문제가
           그대로 남는다. -->
      <div class="text-surface-500 mt-1 text-right font-mono text-xs" title={filePath ?? undefined}>
        {filePath ? middleEllipsis(filePath, 60) : ' '}
      </div>
```

**북마크 줄**은 `{#if localBookmarks.length}` 그대로 둔다 — 녹음이 없으면 비어 있고, 북마크 없는 녹음을 골라도 비어 있어 양쪽이 같다.

**파형** — `peaks`가 `[]`일 때 `Waveform`이 고정 높이로 그려지는지 확인한다. 빈 배열에서 높이가 0이 되면 캔버스에 고정 높이를 주는 것까지 이 태스크에 포함한다. 확인 결과를 보고한다.

- [ ] **Step 4: 통과를 확인하고 뮤테이션으로 못박는다**

Run: `npx vitest run --project client src/routes/recordings/list-header-alignment.svelte.test.ts`
Expected: PASS

그다음 경로 줄을 다시 `{#if filePath}`로 감싸고 같은 명령을 돌려 **RED가 되는지 확인한 뒤 되돌린다.** 두 관찰을 모두 보고한다. 초록으로 남으면 이 테스트는 높이를 고정하지 못하는 것이니 그렇게 말한다.

- [ ] **Step 5: e2e의 우회를 걷어낸다**

`tests/e2e/import-flow.spec.ts`의 인라인 편집 테스트에 있는 다음 줄을 **삭제한다**:

```ts
    await descriptionButton.evaluate((el) => el.scrollIntoView({ block: 'center' }));
```

그 위의 설명 주석도 함께 지운다 — 우회가 없어졌으니 우회를 설명하는 글도 틀린 말이 된다.

이 삭제가 이번 수정의 증거다. 바가 항상 떠 있으면 첫 클릭이 레이아웃을 바꾸지 않으므로 두 번째 클릭이 가로채이지 않는다.

Run: `npm run test:e2e`
Expected: PASS. 여전히 실패하면 바가 아직 클릭을 가로채고 있다는 뜻이다 — **`scrollIntoView`를 되살리지 말고** 무엇이 남았는지 보고한다.

- [ ] **Step 6: `known-issues.md`를 갱신한다**

`docs/known-issues.md`의 `목록 행 더블클릭 편집이 Player 마운트와 경합한다` 항목을 **해결됨으로 표시한다.** 항목을 지우지 말고, 무엇이 원인이었고 어떻게 닫혔는지(바를 항상 렌더해 마운트 순간 자체를 없앰) 한 문단으로 남긴다. 나중에 같은 증상을 다시 만난 사람이 이미 한 번 다뤄졌다는 걸 알아야 한다.

같은 항목의 "관련해서 함께 열어둔 질문"(`pb-80` 고정값, `bind:clientHeight`로 실측)과 북마크로 인한 바 높이 성장은 **여전히 열려 있으므로 그대로 둔다.**

- [ ] **Step 7: 전체 검사**

Run: `npm test` 그리고 `npm run check`
Expected: 유닛·e2e 전부 통과, 타입 에러 0.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/components/Player.svelte src/routes/recordings/list-header-alignment.svelte.test.ts tests/e2e/import-flow.spec.ts docs/known-issues.md
git commit -m "fix: 재생 바를 항상 표시해 더블클릭 편집이 가로채이지 않게 한다"
```

---

### Task 3: 다운로드 파일명을 `제목_녹음일자.확장자`로 바꾼다

**Files:**
- Modify: `src/lib/media.ts`
- Test: `src/lib/media.test.ts`
- Modify: `src/lib/components/Player.svelte` (다운로드 링크)
- Test: `src/lib/components/Player.svelte.test.ts`

**Interfaces:**
- Consumes: `mediaFileExt(format: string, entry: { ext?: string } | undefined): string` — `src/lib/media.ts`에 이미 있다. `'original'`이면 항목의 `ext`를, 아니면 포맷 이름을 돌려준다.
- Produces: `downloadFileName(title: string, recordedAt: string, ext: string): string` — `src/lib/media.ts`.

**지금 무슨 일이 일어나나.** 다운로드 링크가 `<a href="/api/media/{id}/{format}" download>`로 값 없는 `download` 속성만 갖고 있다. 브라우저는 URL의 마지막 조각을 파일명으로 쓰므로 `original`·`mp3`가 되고, 거기에 MIME에서 유추한 확장자가 붙어 `original.qta`·`mp3.mp3`가 된다.

**왜 서버가 아니라 앵커인가.** `/api/media/[id]/[format]`은 다운로드 링크와 `<audio>`의 `src`가 **함께 쓰는** 엔드포인트다. 여기에 `Content-Disposition: attachment`를 무조건 붙이면 재생 경로까지 영향을 받는다. `download` 속성은 동일 출처에서만 동작하는데 이 링크가 정확히 그 경우이므로, 클라이언트에서 이름만 주는 편이 범위가 좁고 재생을 건드리지 않는다. 라우트는 손대지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다 (순수 함수)**

`src/lib/media.test.ts`에 더한다. 이 파일은 node 프로젝트에서 돈다. 파일 맨 위 import에 `downloadFileName`을 더한다.

```ts
describe('downloadFileName', () => {
  it('제목_녹음일자.확장자 형태로 만든다', () => {
    expect(downloadFileName('레인', '2026-07-09T22:36:13+09:00', 'qta')).toBe('레인_2026-07-09.qta');
  });

  it('recordedAt의 앞 10글자만 쓴다 — 오프셋이 붙어 있어 그 부분이 로컬 날짜다', () => {
    expect(downloadFileName('밤', '2026-12-31T23:59:59+09:00', 'mp3')).toBe('밤_2026-12-31.mp3');
  });

  it('경로 구분자와 파일명에 못 쓰는 글자를 바꾼다', () => {
    // 제목은 사용자가 자유롭게 적는 값이라 /, \, : 같은 글자가 들어올 수 있다.
    expect(downloadFileName('a/b\\c:d', '2026-07-09T00:00:00+09:00', 'wav')).toBe('a-b-c-d_2026-07-09.wav');
  });

  it('앞뒤 공백과 마침표를 떨어낸다', () => {
    // 마침표로 시작하면 숨김 파일이 되고, 끝에 있으면 일부 OS가 잘라낸다.
    expect(downloadFileName('  .조용한 밤.  ', '2026-07-09T00:00:00+09:00', 'mp3')).toBe(
      '조용한 밤_2026-07-09.mp3'
    );
  });

  it('제목이 비면 날짜만 쓴다', () => {
    expect(downloadFileName('   ', '2026-07-09T00:00:00+09:00', 'mp3')).toBe('2026-07-09.mp3');
  });

  it('아주 긴 제목은 잘라낸다', () => {
    // 대부분의 파일 시스템이 파일명 255바이트를 넘기지 못한다.
    const name = downloadFileName('가'.repeat(300), '2026-07-09T00:00:00+09:00', 'mp3');
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith('_2026-07-09.mp3')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project server src/lib/media.test.ts`
Expected: FAIL — `downloadFileName`이 없다.

- [ ] **Step 3: 함수를 만든다**

`src/lib/media.ts`에 더한다. 이 모듈은 **브라우저에서도 돌아야 하므로 `node:path`를 쓰지 않는다** — 기존 두 함수가 같은 이유로 문자열만 다룬다.

```ts
/**
 * 제목에서 남길 최대 글자수. 뒤에 붙는 `_YYYY-MM-DD.ext`까지 합쳐도
 * 대부분의 파일 시스템 한도(255바이트)에 여유가 있다.
 */
const MAX_TITLE_CHARS = 80;

/**
 * 다운로드 파일명을 만든다 — `제목_녹음일자.확장자`.
 *
 * 제목은 사용자가 자유롭게 적는 값이라 그대로 파일명에 넣을 수 없다.
 * 경로 구분자와 OS가 거부하는 글자를 하이픈으로 바꾸고, 숨김 파일이
 * 되거나(앞 마침표) 일부 OS가 잘라내는(뒤 마침표) 형태를 피한다.
 */
export function downloadFileName(title: string, recordedAt: string, ext: string): string {
  const date = recordedAt.slice(0, 10);

  const safe = title
    // 제어문자와 파일명에 못 쓰는 글자. Windows가 거부하는 집합이 가장
    // 넓어서 그것을 기준으로 잡는다.
    .replace(/[ -/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, MAX_TITLE_CHARS)
    .trim();

  return safe ? `${safe}_${date}.${ext}` : `${date}.${ext}`;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project server src/lib/media.test.ts`
Expected: PASS — 6개 추가

- [ ] **Step 5: 링크에 이름을 준다**

`src/lib/components/Player.svelte`의 import를 고친다:

```ts
  import { mediaFilePath, mediaFileExt, downloadFileName } from '$lib/media';
```

다운로드 앵커에 값을 준다. 지금은 값 없는 `download`다:

```svelte
              <a class="btn btn-sm preset-tonal" href="/api/media/{recording?.id}/{f}" download
```

이렇게 바꾼다:

```svelte
              <a class="btn btn-sm preset-tonal" href="/api/media/{recording?.id}/{f}"
                download={recording
                  ? downloadFileName(recording.title, recording.recordedAt, mediaFileExt(f, recording.files[f]))
                  : undefined}
```

`mediaFileExt`는 `'original'`이면 항목의 `ext`를, 아니면 포맷 이름을 돌려준다 — 재생 경로를 만들 때 쓰는 것과 같은 규칙이라 다운로드 확장자가 실제 파일과 어긋나지 않는다.

- [ ] **Step 6: 컴포넌트 테스트를 더한다**

`src/lib/components/Player.svelte.test.ts`에 더한다. 기존 setup 헬퍼를 따른다.

```ts
  it('다운로드 링크의 파일명이 제목_녹음일자.확장자다', async () => {
    // 예전에는 값 없는 download 속성이라 브라우저가 URL 마지막 조각을
    // 파일명으로 써서 original.qta, mp3.mp3가 됐다.
    const { getByRole } = await setupWithRecording({
      title: '레인',
      recordedAt: '2026-07-09T22:36:13+09:00',
      files: { original: { ext: 'qta', bytes: 1 }, mp3: { bytes: 1 } }
    });

    const original = getByRole('link', { name: /원본|qta/ });
    await expect.element(original).toHaveAttribute('download', '레인_2026-07-09.qta');
  });
```

기존 헬퍼 이름과 링크 접근 이름이 다르면 그 파일에 실제로 있는 것으로 맞춘다 — **단언하는 `download` 값은 위 그대로 유지한다.**

- [ ] **Step 7: 뮤테이션으로 못박는다**

`download={...}`를 값 없는 `download`로 되돌리고 Step 6의 테스트가 RED가 되는지 확인한 뒤 되돌린다. 두 관찰을 모두 보고한다.

- [ ] **Step 8: 전체 검사**

Run: `npm test` 그리고 `npm run check`
Expected: 유닛·e2e 전부 통과, 타입 에러 0.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/media.ts src/lib/media.test.ts src/lib/components/Player.svelte src/lib/components/Player.svelte.test.ts
git commit -m "feat: 다운로드 파일명을 제목_녹음일자.확장자로 만든다"
```

---

### Task 4: 선택한 녹음을 zip으로 내려주는 엔드포인트

**Files:**
- Create: `src/routes/api/download/+server.ts`
- Test: `src/routes/api/download/server.test.ts`
- Modify: `package.json` (의존성 추가)

**Interfaces:**
- Consumes: `downloadFileName(title, recordedAt, ext)` (Task 3, `$lib/media`), `mediaFileExt(format, entry)`, `mediaFilePath(mediaDir, id, format, ext)` (`$lib/media`), `listAll(config)` / `getById(config, id)` (`$lib/server/store/recordings`), `config` (`$lib/server/config`).
- Produces: `POST /api/download` — 폼 인코딩 바디 `ids`(여러 개), `format`(하나). 응답은 zip 스트림.

**왜 POST 폼인가.** 다운로드는 GET 링크가 자연스럽지만 269개 id를 쿼리스트링에 실으면 10KB가 넘어 URL 길이 한도에 걸린다. 그렇다고 `fetch` + `blob`으로 받으면 zip 전체가 브라우저 메모리에 올라간다 — 원본 오디오는 수 GB가 될 수 있다. **폼 POST로 페이지를 이동시키면** 브라우저가 응답을 다운로드로 처리해 디스크로 흘려보낸다. URL 길이 문제도, 메모리 문제도 없다.

**왜 라이브러리인가.** 오디오는 이미 압축돼 있어 저장(STORE) 방식이면 충분하고, 그 정도는 손으로 짤 수도 있다. 그러나 269개 원본이 4GB를 넘으면 ZIP64가 필요한데 그 부분은 직접 구현하기에 실수가 잦고, 잘못 만든 아카이브는 열리지 않는다. `archiver`가 스트리밍과 ZIP64를 모두 다룬다.

- [ ] **Step 1: 의존성을 넣는다**

```bash
npm install archiver && npm install -D @types/archiver
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`src/routes/api/download/server.test.ts`. 같은 디렉터리 관례는 `src/routes/api/media/[id]/[format]/server.test.ts`를 열어 확인한다 — `config`와 store를 어떻게 모킹하는지 그 파일을 따른다.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 실제 저장소와 디스크를 타지 않도록, 미디어 라우트 테스트와 같은 방식으로 모킹한다.
// (그 파일의 vi.mock 블록을 그대로 참고할 것)

describe('POST /api/download', () => {
  it('고른 id들의 파일을 zip으로 묶어 돌려준다', async () => {
    const res = await post({ ids: ['a', 'b'], format: 'mp3' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
  });

  it('파일명에 제목과 녹음일자가 들어간다', async () => {
    // zip 안의 이름은 Task 3의 downloadFileName과 같은 규칙을 쓴다.
    const names = await zipEntryNames(await post({ ids: ['a'], format: 'mp3' }));
    expect(names).toEqual(['레인_2026-07-09.mp3']);
  });

  it('제목과 날짜가 겹치면 뒤에 번호를 붙여 덮어쓰지 않는다', async () => {
    // zip은 같은 이름을 두 번 담을 수 있지만, 푸는 쪽이 하나를 잃는다.
    const names = await zipEntryNames(await post({ ids: ['a', 'dup'], format: 'mp3' }));
    expect(names).toEqual(['레인_2026-07-09.mp3', '레인_2026-07-09 (2).mp3']);
  });

  it('고른 포맷이 없는 녹음은 건너뛴다', async () => {
    // 변환이 깨진 녹음이 전체 요청을 실패시키면 안 된다.
    const names = await zipEntryNames(await post({ ids: ['a', 'nomp3'], format: 'mp3' }));
    expect(names).toEqual(['레인_2026-07-09.mp3']);
  });

  it('디스크에 파일이 없는 녹음도 건너뛴다', async () => {
    const names = await zipEntryNames(await post({ ids: ['a', 'ghost'], format: 'mp3' }));
    expect(names).toEqual(['레인_2026-07-09.mp3']);
  });

  it('담을 것이 하나도 없으면 404다', async () => {
    // 빈 zip을 내려주면 사용자는 성공한 줄 안다.
    const res = await post({ ids: ['nomp3'], format: 'mp3' });
    expect(res.status).toBe(404);
  });

  it('ids가 비면 400이다', async () => {
    const res = await post({ ids: [], format: 'mp3' });
    expect(res.status).toBe(400);
  });

  it('Content-Disposition에 한글 파일명을 RFC 5987로 싣는다', async () => {
    const res = await post({ ids: ['a'], format: 'mp3' });
    const cd = res.headers.get('content-disposition') ?? '';
    // 한글이 그대로 들어가면 일부 브라우저가 헤더를 깨뜨린다.
    expect(cd).toMatch(/filename\*=UTF-8''/);
  });
});
```

`post()`는 `FormData`를 만들어 `POST` 핸들러를 직접 부르는 얇은 헬퍼다. `zipEntryNames`는 라이브러리 없이 zip 바이트를 훑는다:

```ts
/** zip 로컬 헤더를 훑어 담긴 이름을 순서대로 뽑는다. STORE 방식이라
 *  헤더가 그대로 이어져 있어 이걸로 충분하다. */
async function zipEntryNames(res: Response): Promise<string[]> {
  const buf = Buffer.from(await res.arrayBuffer());
  const names: string[] = [];
  let i = 0;
  while ((i = buf.indexOf('PK\x03\x04', i, 'latin1')) !== -1) {
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    names.push(buf.subarray(i + 30, i + 30 + nameLen).toString('utf8'));
    i += 30 + nameLen + extraLen;
  }
  return names;
}
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run --project server src/routes/api/download/server.test.ts`
Expected: FAIL — 라우트가 없다.

- [ ] **Step 4: 라우트를 만든다**

`src/routes/api/download/+server.ts`:

```ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import archiver from 'archiver';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getById } from '$lib/server/store/recordings';
import { mediaFileExt, mediaFilePath, downloadFileName } from '$lib/media';

/**
 * 같은 제목·같은 날짜의 녹음이 둘 이상이면 zip 안에서 이름이 겹친다. zip
 * 자체는 같은 이름을 두 번 담을 수 있지만 푸는 쪽이 하나를 잃으므로,
 * 두 번째부터 ` (2)`, ` (3)`을 붙인다.
 */
function uniqueName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? '' : name.slice(dot);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData();
  const ids = form.getAll('ids').map(String).filter(Boolean);
  const format = String(form.get('format') ?? '');
  if (!ids.length) throw error(400, '고른 녹음이 없습니다');
  if (!format) throw error(400, '포맷을 지정해야 합니다');

  // 담을 것을 먼저 확정한다 — 스트림을 열어놓고 하나도 못 담는 것보다,
  // 미리 세어보고 404를 주는 편이 정직하다.
  const taken = new Set<string>();
  const entries: { file: string; name: string }[] = [];
  for (const id of ids) {
    const rec = await getById(config, id);
    if (!rec) continue;
    const entry = rec.files[format];
    if (!entry) continue;

    const ext = mediaFileExt(format, entry);
    const file = mediaFilePath(config.mediaDir, rec.id, format, ext);
    try {
      await fsp.stat(file);
    } catch {
      continue;
    }
    entries.push({ file, name: uniqueName(taken, downloadFileName(rec.title, rec.recordedAt, ext)) });
  }

  if (!entries.length) throw error(404, '내려받을 파일이 없습니다');

  // 오디오는 이미 압축돼 있어 다시 압축해봐야 시간만 든다. 저장만 한다.
  const zip = archiver('zip', { store: true });
  for (const e of entries) zip.append(fs.createReadStream(e.file), { name: e.name });
  void zip.finalize();

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `uls-player_${format}_${stamp}.zip`;

  return new Response(zip as unknown as ReadableStream, {
    headers: {
      'content-type': 'application/zip',
      // 한글 제목이 들어갈 수 있으므로 RFC 5987 형식을 함께 싣는다.
      // 앞의 filename=은 그것을 못 읽는 클라이언트용 대비책이다.
      'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
};
```

`content-length`는 싣지 않는다 — 스트리밍이라 미리 알 수 없고, 억지로 계산하려면 전체를 메모리에 올려야 한다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run --project server src/routes/api/download/server.test.ts`
Expected: PASS — 8개

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json src/routes/api/download/
git commit -m "feat: 고른 녹음을 zip으로 내려주는 엔드포인트"
```

---

### Task 5: 선택 영역에 포맷 선택과 다운로드 버튼

**Files:**
- Modify: `src/routes/recordings/+page.svelte`
- Test: `src/routes/recordings/page.svelte.test.ts`
- Test: `tests/e2e/import-flow.spec.ts`

**Interfaces:**
- Consumes: `POST /api/download` (Task 4) — 폼 필드 `ids`(여러 개), `format`(하나).

**어디에 두나.** 목록에는 이미 선택 액션 바가 있다(`{#if selectedIds.size}` 블록: `N개 선택됨`, 태그 추가/제거, 목록에서 제거, 선택 해제). 다운로드도 선택에 대한 동작이므로 같은 줄에 둔다.

**왜 `fetch`가 아니라 폼인가.** `fetch`로 받으면 zip 전체가 브라우저 메모리에 올라간다. 원본 오디오는 수 GB가 될 수 있다. 폼 POST로 이동시키면 브라우저가 응답을 다운로드로 처리해 디스크로 흘려보낸다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/routes/recordings/page.svelte.test.ts`에 더한다. 이 파일의 기존 setup(모킹, `render(Page, { data })`)을 따른다.

```ts
  it('선택이 없으면 다운로드 폼이 없다', async () => {
    const { getByRole } = render(Page, { data: baseData() });
    expect(getByRole('button', { name: /내려받기/ }).elements()).toHaveLength(0);
  });

  it('선택하면 고른 id들이 폼에 실린다', async () => {
    // 폼 POST라 브라우저가 스트리밍으로 받아간다 — fetch로 받으면 zip
    // 전체가 메모리에 올라간다.
    const { getByRole, container } = render(Page, { data: baseData() });
    await getByRole('checkbox', { name: /레인/ }).click();
    await tick();

    const form = container.querySelector('form[action="/api/download"]') as HTMLFormElement;
    expect(form.method.toLowerCase()).toBe('post');
    const ids = [...form.querySelectorAll('input[name="ids"]')].map((el) => (el as HTMLInputElement).value);
    expect(ids).toEqual(['1']);
  });

  it('포맷을 바꾸면 폼에 실리는 값도 바뀐다', async () => {
    const { getByRole, container } = render(Page, { data: baseData() });
    await getByRole('checkbox', { name: /레인/ }).click();
    await tick();

    const select = (await getByLabelText('내려받을 포맷').element()) as HTMLSelectElement;
    select.value = 'wav';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    const form = container.querySelector('form[action="/api/download"]') as HTMLFormElement;
    const format = form.querySelector('input[name="format"]') as HTMLInputElement;
    expect(format.value).toBe('wav');
  });
```

접근 이름과 헬퍼가 이 파일의 기존 것과 다르면 실제 것에 맞춘다 — **단언하는 값(`ids`, `format`, `action`, `method`)은 그대로 유지한다.**

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run --project client src/routes/recordings/page.svelte.test.ts`
Expected: FAIL — 폼이 없다.

- [ ] **Step 3: 선택 액션 바에 폼을 넣는다**

`+page.svelte`의 스크립트에 더한다:

```ts
  /**
   * 일괄 내려받기에 담을 포맷. 용도가 갈리므로(원본 보관 vs mp3 공유)
   * 고를 수 있어야 한다. 기본값은 가장 흔한 용도인 mp3다.
   */
  let downloadFormat = $state('mp3');
```

선택 액션 바(`목록에서 제거` 버튼 근처)에 더한다:

```svelte
        <!-- fetch가 아니라 폼으로 보낸다 — 브라우저가 응답을 다운로드로
             처리해 디스크로 흘려보내므로, 수 GB짜리 zip이 메모리에
             올라가지 않는다. -->
        <form method="POST" action="/api/download" class="flex items-center gap-2">
          {#each [...selectedIds] as id (id)}
            <input type="hidden" name="ids" value={id} />
          {/each}
          <input type="hidden" name="format" value={downloadFormat} />
          <label class="flex items-center gap-1 text-sm">
            <span>포맷</span>
            <select class="select select-sm" aria-label="내려받을 포맷" bind:value={downloadFormat}>
              {#each ['original', ...data.formats] as f (f)}
                <option value={f}>{f}</option>
              {/each}
            </select>
          </label>
          <button type="submit" class="btn btn-sm preset-tonal">
            {selectedIds.size}개 내려받기
          </button>
        </form>
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run --project client src/routes/recordings/page.svelte.test.ts`
Expected: PASS

- [ ] **Step 5: e2e를 더한다**

`tests/e2e/import-flow.spec.ts`에 더한다. Playwright의 `waitForEvent('download')`로 실제 다운로드를 받아 이름과 내용을 확인한다.

```ts
  test('여러 개를 골라 zip으로 한 번에 내려받는다', async ({ page }) => {
    await page.goto('/recordings');

    // 두 녹음을 모두 고른다.
    for (const title of [QTA_TITLE, M4A_TITLE]) {
      await page.getByRole('checkbox', { name: new RegExp(title) }).check();
    }

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /내려받기/ }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^uls-player_mp3_\d{4}-\d{2}-\d{2}\.zip$/);
    // 빈 zip이 아니라 실제로 두 파일이 들어 있는지 본다 — 빈 아카이브도
    // 다운로드는 성공하므로 이름만 봐서는 알 수 없다.
    const path = await file.path();
    const bytes = await readFile(path);
    const entries = [...bytes.toString('latin1').matchAll(/PK\x03\x04/g)];
    expect(entries).toHaveLength(2);
  });
```

체크박스 접근 이름이 다르면 실제 것에 맞춘다. `readFile`은 `node:fs/promises`에서 가져온다.

- [ ] **Step 6: 전체 검사**

Run: `npm test` 그리고 `npm run check`
Expected: 유닛·e2e 전부 통과, 타입 에러 0.

- [ ] **Step 7: 커밋**

```bash
git add src/routes/recordings/+page.svelte src/routes/recordings/page.svelte.test.ts tests/e2e/import-flow.spec.ts
git commit -m "feat: 고른 녹음을 한 번에 zip으로 내려받는다"
```
