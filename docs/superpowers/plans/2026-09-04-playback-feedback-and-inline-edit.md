# 재생 피드백과 인라인 편집 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목록에서 행을 눌렀을 때 무슨 일이 일어나는지 알 수 있게 하고, 행 안의 세 인라인 편집이 같은 규칙을 따르게 한다.

**Architecture:** 죽은 클릭 영역을 먼저 없애 증상의 주된 원인을 제거한다. 그 위에 `<audio>`가 이미 발생시키는 이벤트로 로딩·오류 상태를 만들고, 그 상태가 준비된 뒤에 자동 재생을 켠다. 인라인 편집은 저장 경로를 blur 하나로 유지한 채 트리거만 늘린다.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, Skeleton v5, vitest(browser mode) + vitest-browser-svelte, Playwright

## Global Constraints

- Svelte 5 룬만 쓴다: `$state`, `$derived`, `$effect`, `$props`, `$bindable`. Svelte 4 스토어·`export let` 금지
- 주석은 무엇이 아니라 **왜**를 적는다. 한국어로, 주변 문체에 맞춘다. 코드에 대해 사실이 아닌 주석은 결함이다
- 모든 테스트는 그것이 지키는 동작이 깨지면 실패해야 한다. 뮤테이션으로 증명하고 실제 출력을 보고한다
- 테스트에 고정 `setTimeout`/sleep 대기를 쓰지 않는다. Svelte 5는 상태를 동기로 바꾸지만 DOM 반영은 마이크로태스크로 미루므로, 렌더 결과에 대한 단언은 재시도하는 assertion을 쓴다
- **`audio.play()`/`audio.pause()`를 직접 부르지 않는다.** 재생은 `bind:paused`가 소유한다 — 직접 부르면 바인딩이 반응형 상태와 어긋난다(`Player.svelte`의 기존 주석이 그 이유를 설명한다)
- 행 안의 `stopPropagation`은 유지한다. 없애면 편집 중인 입력창을 클릭할 때도 행 선택이 다시 일어난다
- 배치나 접근 이름을 재는 테스트는 `app.css`를 직접 import하는 별도 파일에 둔다 — 컴포넌트 테스트는 `+layout.svelte` 없이 페이지를 단독 마운트해 Tailwind가 적용되지 않는다

---

### Task 1: 죽은 클릭 영역을 없앤다

증상의 주된 원인이다. 이것만으로도 "눌러도 아무 일 없음"은 사라진다.

**Files:**
- Modify: `src/routes/recordings/+page.svelte`
- Test: `src/routes/recordings/page.svelte.test.ts`

**Interfaces:**
- Produces: 설명·태그를 한 번 클릭하면 `selectedId`가 그 행이 된다. Task 3의 자동 재생이 이 경로 위에서 동작한다

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/recordings/page.svelte.test.ts` 맨 아래에 추가한다. 이 파일에 이미 있는 `rec()`·`pageData()` 헬퍼를 쓴다.

```ts
describe('+page.svelte — 행에서 죽은 클릭 영역이 없다', () => {
  /** 하단 재생기가 이 제목으로 떴는지 본다 — 행이 재생 대상이 됐다는 뜻이다. */
  async function playerShows(title: string) {
    await expect.element(page.getByText(title, { exact: true })).toBeInTheDocument();
  }

  it('설명을 한 번 클릭하면 그 행이 재생 대상이 된다', async () => {
    // 설명 버튼에는 ondblclick만 있었고 부모 div가 stopPropagation을 해서,
    // 한 번 클릭하면 아무 일도 일어나지 않았다 — 사용자가 클릭이 씹혔다고
    // 여기고 다시 누르게 되던 자리다.
    render(Page, { data: pageData([rec({ id: '1', title: '레인', description: '빗소리' })]) });

    await page.getByText('빗소리').click();

    await playerShows('레인');
  });

  it('태그를 한 번 클릭하면 그 행이 재생 대상이 된다', async () => {
    render(Page, { data: pageData([rec({ id: '1', title: '레인', tags: ['데모'] })]) });

    await page.getByText('데모', { exact: true }).click();

    await playerShows('레인');
  });

  it('설명이 비어 있어도("설명 없음") 클릭이 먹는다', async () => {
    render(Page, { data: pageData([rec({ id: '1', title: '레인' })]) });

    await page.getByText('설명 없음').click();

    await playerShows('레인');
  });

  it('태그가 없어도("태그 없음") 클릭이 먹는다', async () => {
    render(Page, { data: pageData([rec({ id: '1', title: '레인' })]) });

    await page.getByText('태그 없음').click();

    await playerShows('레인');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/routes/recordings/page.svelte.test.ts
```

Expected: 새 4개가 FAIL — 클릭해도 재생기가 뜨지 않는다

- [ ] **Step 3: 설명 버튼에 onclick을 더한다**

`src/routes/recordings/+page.svelte`에서 설명 버튼을 찾는다.

```svelte
                  <button type="button" class="text-surface-500 text-left text-sm"
                    ondblclick={() => (editingDescriptionId = rec.id)}>
```

이렇게 바꾼다.

```svelte
                  <!-- 제목 버튼과 같은 이유로 onclick을 직접 갖는다 — 부모
                       div가 행 클릭을 끊으므로, 여기 없으면 설명을 눌렀을 때
                       아무 일도 일어나지 않는다. 더블클릭 편집은 그대로다:
                       첫 클릭이 행을 고르고 두 번째 클릭에서 편집이 열린다. -->
                  <button type="button" class="text-surface-500 text-left text-sm"
                    onclick={() => (selectedId = rec.id)}
                    ondblclick={() => (editingDescriptionId = rec.id)}>
```

- [ ] **Step 4: 태그 버튼에 onclick을 더한다**

같은 파일에서 태그 버튼을 찾는다.

```svelte
                  <button type="button" class="flex flex-wrap gap-1 text-left"
                    ondblclick={() => startEditTags(rec)}>
```

이렇게 바꾼다.

```svelte
                  <!-- 설명 버튼과 같은 이유다 — 태그 칸은 열 하나를 통째로
                       차지해서, 여기가 죽어 있으면 행에서 가장 누르기 쉬운
                       자리가 반응하지 않는다. -->
                  <button type="button" class="flex flex-wrap gap-1 text-left"
                    onclick={() => (selectedId = rec.id)}
                    ondblclick={() => startEditTags(rec)}>
```

- [ ] **Step 5: 통과 확인**

```bash
npx vitest run src/routes/recordings/page.svelte.test.ts
```

Expected: 새 4개 포함 전부 PASS. **기존 더블클릭 편집 테스트가 그대로 통과해야 한다** — 그것이 이 수정이 지켜야 할 경계다

- [ ] **Step 6: 뮤테이션으로 판별력 확인**

두 가지를 각각 해보고 되돌린 뒤, 실제 출력과 함께 보고한다.

1. 설명 버튼의 `onclick`을 다시 지운다 → 설명 관련 테스트 2개가 실패해야 한다
2. 태그 버튼의 `onclick`을 다시 지운다 → 태그 관련 테스트 2개가 실패해야 한다

- [ ] **Step 7: 네 가지 검증과 커밋**

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

```bash
git add -A
git commit -m "fix: 목록 행의 설명·태그를 눌러도 아무 일도 없던 것을 고친다

설명·태그 버튼에는 ondblclick만 있는데 부모 div가 행 클릭을
stopPropagation으로 끊어, 행에서 가장 누르기 쉬운 두 자리가 죽어
있었다. 제목만 자기 onclick으로 선택을 처리하고 있었다.

사용자가 '클릭이 씹혔는지 불러오는 중인지 모르겠다'며 여러 번 누르게
되던 증상의 주된 원인이다."
```

---

### Task 2: 불러오는 중과 실패를 보여준다

**Files:**
- Modify: `src/lib/components/Player.svelte`
- Test: `src/lib/components/Player.svelte.test.ts`

**Interfaces:**
- Produces: `loadState` 상태(`'idle' | 'loading' | 'ready' | 'error'`)와 그것을 반영하는 재생 버튼. Task 3이 이 위에서 자동 재생을 켠다

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/components/Player.svelte.test.ts` 맨 아래에 추가한다. 이 파일에 이미 있는 `rec()` 헬퍼를 쓴다.

```ts
describe('Player.svelte — 불러오는 중과 실패', () => {
  /** 렌더된 <audio>에 실제 미디어 이벤트를 흘려보낸다. */
  function audioEl(): HTMLAudioElement {
    const el = document.querySelector('audio');
    if (!el) throw new Error('audio 엘리먼트가 없다');
    return el as HTMLAudioElement;
  }

  it('불러오기가 시작되면 재생 버튼 자리에 진행 표시가 뜨고 누를 수 없다', async () => {
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));

    await expect.element(page.getByRole('button', { name: '불러오는 중' })).toBeDisabled();
  });

  it('재생 가능해지면 재생 버튼으로 돌아온다', async () => {
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));
    audioEl().dispatchEvent(new Event('canplay'));

    await expect.element(page.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });

  it('불러오기가 실패하면 실패했다고 보여준다', async () => {
    // 지금은 <audio>에 error 핸들러가 아예 없어서, 파일을 못 읽어도
    // 화면은 조용히 '재생' 버튼만 보여준다 — 눌러도 아무 일이 없다.
    render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));
    audioEl().dispatchEvent(new Event('error'));

    await expect.element(page.getByText('불러오지 못했습니다')).toBeInTheDocument();
  });

  it('제목은 불러오는 동안에도 바로 보인다', async () => {
    // 클릭이 먹었다는 것을 알리는 가장 빠른 신호다.
    render(Player, { recording: rec({ id: 'aaaa', title: '레인' }), formats: ['mp3'] });

    audioEl().dispatchEvent(new Event('loadstart'));

    await expect.element(page.getByText('레인')).toBeInTheDocument();
  });

  it('다른 녹음으로 바꾸면 실패 표시가 남지 않는다', async () => {
    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });
    audioEl().dispatchEvent(new Event('error'));
    await expect.element(page.getByText('불러오지 못했습니다')).toBeInTheDocument();

    await screen.rerender({ recording: rec({ id: 'bbbb', title: '정류장' }), formats: ['mp3'] });

    expect(document.body.textContent).not.toContain('불러오지 못했습니다');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/components/Player.svelte.test.ts
```

Expected: 새 5개 중 최소 4개가 FAIL — 로딩·오류 상태가 아직 없다

- [ ] **Step 3: 상태를 만든다**

`src/lib/components/Player.svelte`의 `<script>`에서 `let peaks = $state<number[]>([]);` 아래에 더한다.

```ts
  /**
   * <audio>가 지금 어느 단계인지. 지금까지 이 컴포넌트는 로딩·오류
   * 이벤트를 하나도 듣지 않아서, 파일을 못 읽어도 화면은 조용히 '재생'
   * 버튼만 보여줬다 — 눌러도 아무 일이 없고 이유도 알 수 없다.
   *
   * 별도 타이머를 두지 않고 <audio>가 이미 내는 이벤트만 쓴다.
   */
  let loadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
```

녹음이 바뀔 때 상태를 되돌려야 한다. 기존 `lastId` 이펙트 안, `current = 0;` 옆에 더한다.

```ts
      current = 0;
      loopA = loopB = null;
      // 이전 녹음의 실패 표시가 새 녹음 위에 남지 않게 한다.
      loadState = 'loading';
```

- [ ] **Step 4: audio에 이벤트를 연결한다**

같은 파일의 `<audio>` 태그에 더한다. 기존 속성은 그대로 둔다.

```svelte
      onloadstart={() => (loadState = 'loading')}
      oncanplay={() => (loadState = 'ready')}
      onerror={() => (loadState = 'error')}
```

- [ ] **Step 5: 재생 버튼이 상태를 반영하게 한다**

같은 파일에서 재생 버튼을 찾는다.

```svelte
        <button type="button" class="btn preset-filled-primary-500" onclick={toggle}>
          {playing ? '일시정지' : '재생'}
        </button>
```

이렇게 바꾼다.

```svelte
        <!-- 상태를 재생 버튼 자리에 둔다 — 사용자가 이미 보고 있는 곳이고,
             "지금은 누를 수 없다"까지 같은 자리에서 전달된다. -->
        <button type="button" class="btn preset-filled-primary-500"
          disabled={loadState === 'loading'}
          onclick={toggle}>
          {loadState === 'loading' ? '불러오는 중' : playing ? '일시정지' : '재생'}
        </button>
        {#if loadState === 'error'}
          <span class="text-error-500 text-sm">불러오지 못했습니다</span>
        {/if}
```

- [ ] **Step 6: 통과 확인**

```bash
npx vitest run src/lib/components/Player.svelte.test.ts
```

Expected: 새 5개 포함 전부 PASS

- [ ] **Step 7: 늦게 도착한 이벤트가 문제가 되는지 직접 확인한다**

스펙 3.3은 "이전 녹음의 `error`나 `canplay`가 나중에 도착해 현재 표시를 덮으면 안 된다"고 적었다. 그런데 `<audio>`는 **하나뿐**이고 `src`만 바뀐다 — 그렇다면 이벤트는 언제나 현재 `src`에 대한 것이고, 덮어쓸 이전 응답이라는 게 존재하지 않을 수 있다.

**추측하지 말고 확인한다.** 빠르게 녹음을 바꾸는 상황을 만들어 이전 `src`의 이벤트가 실제로 도착하는지 본다.

- 실제로 도착한다면: 파형 `fetch`가 쓰는 것과 같은 방식으로 막고, 그것을 지키는 테스트를 더한다
- 도착하지 않는다면: **가드를 넣지 않는다.** 검증할 수 없는 방어 코드를 남기지 말고, 무엇을 어떻게 확인했는지 보고한다

- [ ] **Step 8: 뮤테이션으로 판별력 확인**

두 가지를 각각 해보고 되돌린 뒤, 실제 출력과 함께 보고한다.

1. `onerror` 핸들러를 지운다 → 실패 표시 테스트가 실패해야 한다
2. 버튼의 `disabled`를 지운다 → 불러오는 중 테스트가 실패해야 한다

- [ ] **Step 9: 네 가지 검증과 커밋**

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

```bash
git add -A
git commit -m "feat: 재생기에 불러오는 중과 실패를 보여준다

<audio>에 로딩·오류 이벤트가 하나도 연결돼 있지 않아, 파일을 못 읽어도
화면은 조용히 '재생' 버튼만 보여줬다 — 눌러도 아무 일이 없고 이유도
알 수 없었다.

상태를 재생 버튼 자리에 둔다. 사용자가 이미 보고 있는 곳이고, '지금은
누를 수 없다'까지 같은 자리에서 전달된다."
```

---

### Task 3: 행을 누르면 재생을 시작한다

**Files:**
- Modify: `src/lib/components/Player.svelte`
- Test: `src/lib/components/Player.svelte.test.ts`

**Interfaces:**
- Consumes: Task 2의 `loadState`

- [ ] **Step 1: 실패 테스트 작성**

Task 2가 만든 describe 아래에 새 describe를 더한다.

```ts
describe('Player.svelte — 녹음을 바꾸면 재생을 시작한다', () => {
  function audioEl(): HTMLAudioElement {
    const el = document.querySelector('audio');
    if (!el) throw new Error('audio 엘리먼트가 없다');
    return el as HTMLAudioElement;
  }

  it('다른 녹음으로 바뀌면 재생 상태로 들어간다', async () => {
    // 행을 누르는 것은 듣겠다는 뜻이다. 예전에는 일부러 자동 재생을
    // 하지 않았는데, 실사용에서 "눌렀는데 안 울려서 클릭이 씹힌 줄
    // 알았다"로 드러나 뒤집은 결정이다.
    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    await screen.rerender({ recording: rec({ id: 'bbbb', title: '정류장' }), formats: ['mp3'] });
    audioEl().dispatchEvent(new Event('canplay'));

    await expect.element(page.getByRole('button', { name: '일시정지' })).toBeInTheDocument();
  });

  it('같은 녹음이 새 객체로 다시 들어와도 재생을 새로 시작하지 않는다', async () => {
    // 목록의 관련 없는 행을 patch하면 recordings 배열이 통째로 교체돼
    // 같은 id의 새 객체가 내려온다. 그때마다 재생이 리셋되면 안 된다.
    const screen = render(Player, { recording: rec({ id: 'aaaa' }), formats: ['mp3'] });
    audioEl().dispatchEvent(new Event('canplay'));

    await page.getByRole('button', { name: '재생' }).click();
    await expect.element(page.getByRole('button', { name: '일시정지' })).toBeInTheDocument();

    audioEl().currentTime = 30;
    await screen.rerender({ recording: rec({ id: 'aaaa' }), formats: ['mp3'] });

    expect(audioEl().currentTime).toBe(30);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/components/Player.svelte.test.ts
```

Expected: 첫 번째가 FAIL — 녹음을 바꿔도 재생이 시작되지 않는다

- [ ] **Step 3: 자동 재생을 켠다**

`src/lib/components/Player.svelte`의 `lastId` 이펙트 안, Task 2가 넣은 `loadState = 'loading';` 아래에 더한다.

```ts
      // 행을 누르는 것은 듣겠다는 뜻으로 본다. 예전에는 일부러 자동
      // 재생을 하지 않았고 그 근거도 아래 주석에 남아 있었는데, 실사용에서
      // "눌렀는데 안 울려서 클릭이 씹힌 줄 알았다"로 드러나 뒤집었다.
      //
      // paused를 직접 false로 두기만 한다 — audio.play()를 부르지 않는다.
      // 재생은 bind:paused가 소유하고, 여기서 직접 부르면 그 바인딩이
      // 반응형 상태와 어긋난다.
      paused = false;
```

**같은 이펙트 안의 기존 주석에서 자동 재생을 하지 않는다고 설명하는 문단을 지운다.** 그대로 두면 코드와 정면으로 어긋나는 주석이 남는다.

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/lib/components/Player.svelte.test.ts
```

Expected: 새 2개 포함 전부 PASS. **Task 2의 "다른 녹음으로 바꾸면 실패 표시가 남지 않는다"와 기존 A-B 리셋 테스트가 그대로 통과해야 한다**

- [ ] **Step 5: 브라우저가 자동 재생을 거부할 때를 확인한다**

스펙 3.2는 자동 재생이 거부되면 오류 경로로 처리한다고 적었다. 그런데 `bind:paused`가 `play()`를 소유하므로 **거부 사유가 이 컴포넌트에 보이지 않는다.** 직접 `play()`를 부르면 전역 제약이 금지하는 일을 하게 된다.

거부되면 `paused`가 true로 남고 버튼이 '재생'으로 돌아온다 — 사용자에게는 "시작되지 않았다"가 정직하게 전달된다. **오류 상태를 지어내지 않는다.**

`npm run dev`로 실제 브라우저에서 확인한다: 페이지를 새로 열고 아무 상호작용 없이 행을 클릭했을 때 재생이 시작되는지, 거부된다면 버튼이 어떤 상태로 남는지. 본 것을 보고한다. 브라우저를 못 띄우면 그렇게 밝힌다.

- [ ] **Step 6: 뮤테이션으로 판별력 확인**

`paused = false;`를 지운다 → "다른 녹음으로 바뀌면 재생 상태로 들어간다"가 실패해야 한다. 되돌린 뒤 실제 출력과 함께 보고한다.

- [ ] **Step 7: 네 가지 검증과 커밋**

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

```bash
git add -A
git commit -m "feat: 행을 누르면 재생을 시작한다

예전에는 일부러 자동 재생을 하지 않았다 — 목록을 훑다 소리가 튀어나오면
당황스럽다는 이유였다. 실사용에서는 반대로 '눌렀는데 안 울려서 클릭이
씹힌 줄 알았다'로 드러나 뒤집는다.

paused를 false로 두기만 하고 audio.play()는 부르지 않는다. 재생은
bind:paused가 소유하고, 직접 부르면 그 바인딩이 반응형 상태와 어긋난다."
```

---

### Task 4: 제목·설명 편집을 태그 편집과 같은 규칙으로 맞춘다

**Files:**
- Modify: `src/routes/recordings/+page.svelte`
- Test: `src/routes/recordings/page.svelte.test.ts`

**Interfaces:**
- Consumes: 없음(앞 태스크와 독립적이다)

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/recordings/page.svelte.test.ts` 맨 아래에 추가한다.

```ts
describe('+page.svelte — 제목·설명 인라인 편집', () => {
  /** 편집 중인 입력창을 찾는다. */
  function editInput(label: string): HTMLInputElement {
    const el = document.querySelector(`input[aria-label="${label}"]`);
    if (!el) throw new Error(`${label} 입력창이 없다`);
    return el as HTMLInputElement;
  }

  /**
   * 이 파일은 fetch를 테스트마다 각자 모킹한다(파일 전역 모킹이 없다).
   * typeof fetch로 시그니처를 못박는 것도 기존 테스트와 같은 이유다 —
   * 안 하면 mock.calls의 각 항목이 빈 튜플이 되어 인자 접근이 컴파일
   * 에러가 난다.
   */
  function stubFetch() {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ recordings: [], tags: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('설명 편집에서 Enter를 누르면 저장된다', async () => {
    const fetchMock = stubFetch();
    render(Page, { data: pageData([rec({ id: '1', title: '레인', description: '빗소리' })]) });

    await page.getByText('빗소리').dblClick();
    const input = editInput('설명 수정');
    input.value = '고친 설명';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/recordings',
        expect.objectContaining({
          body: expect.stringContaining('고친 설명')
        })
      )
    );
  });

  it('조합 중인 Enter로는 저장하지 않는다', async () => {
    // TagInput이 이미 같은 함정에 빠진 적이 있다 — "정준일"을 치고
    // Enter를 누르면 조합 중 keydown과 확정 후 keydown이 둘 다 들어와
    // 값이 갈라졌다.
    const fetchMock = stubFetch();
    render(Page, { data: pageData([rec({ id: '1', title: '레인', description: '빗소리' })]) });

    await page.getByText('빗소리').dblClick();
    const input = editInput('설명 수정');
    input.value = '정준일';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true } as KeyboardEventInit)
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('설명 편집의 완료 버튼을 누르면 저장된다', async () => {
    const fetchMock = stubFetch();
    render(Page, { data: pageData([rec({ id: '1', title: '레인', description: '빗소리' })]) });

    await page.getByText('빗소리').dblClick();
    const input = editInput('설명 수정');
    input.value = '고친 설명';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await page.getByRole('button', { name: '설명 편집 완료' }).click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('완료 버튼을 눌러도 저장 요청은 한 번만 나간다', async () => {
    // 완료 버튼은 blur를 일으키기만 하고, 저장은 onblur 한 곳에서만
    // 한다 — 버튼이 따로 저장하면 blur 저장과 겹쳐 두 번 나간다.
    const fetchMock = stubFetch();
    render(Page, { data: pageData([rec({ id: '1', title: '레인', description: '빗소리' })]) });

    await page.getByText('빗소리').dblClick();
    const input = editInput('설명 수정');
    input.value = '고친 설명';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await page.getByRole('button', { name: '설명 편집 완료' }).click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('제목 편집에도 Enter와 완료 버튼이 있다', async () => {
    const fetchMock = stubFetch();
    render(Page, { data: pageData([rec({ id: '1', title: '레인' })]) });

    await page.getByRole('button', { name: '레인' }).dblClick();
    const input = editInput('제목 수정');
    input.value = '고친 제목';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await expect.element(page.getByRole('button', { name: '제목 편집 완료' })).toBeInTheDocument();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
```

이 파일에는 파일 전역 `fetch` 모킹이 없다. 기존 테스트가 각자 `vi.fn<typeof fetch>` + `vi.stubGlobal`로 세우는 방식을 그대로 따라 위 `stubFetch()` 헬퍼로 묶었다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/routes/recordings/page.svelte.test.ts
```

Expected: 새 5개 중 대부분이 FAIL — Enter 처리도 완료 버튼도 없고, 제목 입력창에 `aria-label`이 없다

- [ ] **Step 3: 공통 keydown 핸들러를 만든다**

`src/routes/recordings/+page.svelte`의 `<script>`에 더한다.

```ts
  /**
   * 제목·설명 편집에서 Enter로 저장을 마친다. 저장 자체는 onblur 한
   * 곳에서만 하므로, 여기서는 blur만 시킨다 — 트리거는 셋(blur·Enter·완료
   * 버튼)이지만 저장 경로는 하나다.
   *
   * 조합 중인 Enter는 무시한다. 한글에서는 조합 중에도 keydown이 오는데
   * 그때 처리하면 TagInput이 겪었던 것처럼 값이 갈라진다. 조합이 끝나면
   * 브라우저가 Enter를 한 번 더 주므로 저장할 기회를 잃지 않는다.
   */
  function commitOnEnter(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key !== 'Enter') return;
    (e.currentTarget as HTMLInputElement).blur();
  }
```

- [ ] **Step 4: 제목 편집을 고친다**

같은 파일에서 제목 입력창을 찾는다.

```svelte
                  <input class="input" value={rec.title}
                    onblur={(e) => {
```

`aria-label`, `onkeydown`, 줄인 크기를 더하고 완료 버튼을 붙인다. `onblur` 내용은 그대로 둔다.

```svelte
                  <div class="flex items-center gap-2">
                    <!-- py-1로 줄인다 — 기본 높이 그대로면 편집을 시작할 때
                         행이 커져서 아래 행들이 밀린다. -->
                    <input class="input py-1" value={rec.title} aria-label="제목 수정"
                      onkeydown={commitOnEnter}
                      onblur={(e) => {
                        send({ op: 'patch', id: rec.id, title: e.currentTarget.value }).then(
                          (ok) => {
                            if (ok) editingId = null;
                          }
                        );
                      }} />
                    <!-- 저장하지 않는다 — blur만 일으킨다. 저장은 위
                         onblur 하나가 맡는다. -->
                    <button type="button" class="btn btn-sm preset-filled shrink-0"
                      aria-label="제목 편집 완료">완료</button>
                  </div>
```

- [ ] **Step 5: 설명 편집을 고친다**

같은 파일에서 설명 입력창을 찾아 같은 모양으로 바꾼다. `text-sm`은 유지한다.

```svelte
                  <div class="flex items-center gap-2">
                    <input class="input py-1 text-sm" value={rec.description} aria-label="설명 수정"
                      onkeydown={commitOnEnter}
                      onblur={(e) => {
                        send({ op: 'patch', id: rec.id, description: e.currentTarget.value }).then(
                          (ok) => {
                            if (ok) editingDescriptionId = null;
                          }
                        );
                      }} />
                    <button type="button" class="btn btn-sm preset-filled shrink-0"
                      aria-label="설명 편집 완료">완료</button>
                  </div>
```

- [ ] **Step 6: 완료 버튼이 실제로 blur를 일으키는지 확인한다**

완료 버튼에는 `onclick`이 없다. 버튼을 누르면 입력창에서 포커스가 빠지면서 `onblur`가 저장한다는 전제다.

**이 전제를 직접 확인한다.** 브라우저에 따라 버튼 클릭이 포커스를 옮기지 않을 수 있다(Safari의 오래된 동작이 대표적이다).

```bash
npx vitest run src/routes/recordings/page.svelte.test.ts
```

Expected: 완료 버튼 테스트 2개가 PASS

**실패한다면** 버튼에 `onclick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement)?.blur()}`처럼 명시적으로 blur를 부르되, **저장은 여전히 `onblur`에서만** 한다. 어느 쪽을 택했는지와 왜인지를 보고한다.

- [ ] **Step 7: 통과 확인과 기존 테스트 점검**

```bash
npx vitest run
```

Expected: 전부 통과. 기존 제목·설명 편집 테스트가 깨졌다면 **셀렉터만 고치고 검증 내용은 바꾸지 않는다.** 무엇을 왜 고쳤는지 보고한다

- [ ] **Step 8: 뮤테이션으로 판별력 확인**

세 가지를 각각 해보고 되돌린 뒤, 실제 출력과 함께 보고한다.

1. `commitOnEnter`의 `if (e.isComposing) return;`을 지운다 → 조합 중 Enter 테스트가 실패해야 한다
2. `onkeydown={commitOnEnter}`를 지운다 → Enter 저장 테스트가 실패해야 한다
3. 완료 버튼에 `onclick`으로 `send(...)`를 직접 더한다(저장 경로를 둘로 만든다) → "저장 요청은 한 번만" 테스트가 실패해야 한다

- [ ] **Step 9: 실제로 써본다**

```bash
npm run dev
```

제목·설명 편집을 열었을 때 **행 높이가 눈에 띄게 변하지 않는지**, 한글로 설명을 입력하고 Enter를 눌렀을 때 값이 갈라지지 않고 한 번에 저장되는지, 완료 버튼이 동작하는지 확인하고 본 것을 보고한다. 브라우저를 못 띄우면 그렇게 밝힌다.

- [ ] **Step 10: 네 가지 검증과 커밋**

```bash
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test
```

```bash
git add -A
git commit -m "feat: 제목·설명 편집에 완료 버튼과 Enter를 더한다

같은 행 안에서 태그 편집만 완료 버튼이 있고 제목·설명은 blur로만
저장돼, 세 편집이 서로 다르게 동작했다.

저장 경로는 onblur 하나로 유지한다 — Enter와 완료 버튼은 blur를
일으키기만 한다. 둘이 각자 저장하면 완료 버튼 클릭이 blur 저장과
겹쳐 두 번 나간다.

조합 중인 Enter는 무시한다. TagInput이 겪었던 것과 같은 이유다.

입력창 높이를 줄였다. 기본 높이 그대로면 편집을 시작할 때 행이 커져
아래 행들이 밀린다."
```

---

## 자체 검토

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| 2절 죽은 클릭 영역 | Task 1 |
| 3.1 설명·태그에 onclick | Task 1 Step 3·4 |
| 3.1 stopPropagation 유지 | 전역 제약 |
| 3.2 행 클릭 시 재생 | Task 3 |
| 3.2 같은 행 재클릭 시 위치 유지 | Task 3 Step 1의 두 번째 테스트(기존 `lastId` 가드가 지킨다) |
| 3.3 로딩·오류 표시 | Task 2 |
| 3.3 제목 즉시 표시 | Task 2 Step 1의 네 번째 테스트 |
| 3.3 늦은 응답 | Task 2 Step 7 — 확인 후 판단 |
| 4.1 저장 경로 단일 | Task 4 Step 3·6, Step 8 뮤테이션 3 |
| 4.2 Enter와 한글 조합 | Task 4 Step 3, Step 8 뮤테이션 1 |
| 4.3 입력창 크기 | Task 4 Step 4·5, Step 9 수동 확인 |
| 4.4 완료 버튼 | Task 4 Step 4·5 |

**스펙에서 조정한 것**

스펙 3.2는 자동 재생이 거부되면 "오류 표시 경로로 처리한다"고 적었으나, `bind:paused`가 `play()`를 소유하므로 거부 사유가 컴포넌트에 도달하지 않는다. 직접 `play()`를 부르는 것은 전역 제약이 금지한다. 거부되면 `paused`가 true로 남아 버튼이 '재생'으로 돌아오고, 그것이 정직한 신호다 — 오류 상태를 지어내지 않는다. Task 3 Step 5가 이 판단과 실제 브라우저 확인을 함께 담는다.

**플레이스홀더 점검**

TBD·TODO류 없음. 조건부 지시가 셋 있고 모두 "확인 후 판단"과 "안 되면 보고"를 명시했다 — Task 2 Step 7(늦은 이벤트가 실재하는지), Task 3 Step 5(자동 재생 거부), Task 4 Step 6(완료 버튼이 blur를 일으키는지). 셋 다 문서가 정할 수 없고 실행해야 아는 사실이라 값을 지어내지 않았다.

**타입 일관성**

`loadState`는 Task 2가 정의하고 Task 3이 같은 이름으로 참조한다. `commitOnEnter(e: KeyboardEvent)`는 Task 4 안에서 정의·사용한다. `aria-label`은 `제목 수정`·`설명 수정`·`제목 편집 완료`·`설명 편집 완료` 넷을 쓰고 테스트가 같은 문자열로 찾는다.

**남는 위험 하나**

Task 4의 테스트는 `stubFetch()`가 돌려주는 응답이 `{ recordings: [], tags: [] }`라, 저장 후 화면이 빈 목록으로 갱신된다. 저장 요청이 나갔는지만 보는 테스트에는 문제가 없지만, 저장 뒤 화면 내용까지 단언하려 들면 어긋난다 — 그런 단언이 필요해지면 기존 테스트들이 하듯 응답에 실제 항목을 담아야 한다.
