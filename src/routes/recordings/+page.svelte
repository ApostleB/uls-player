<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { afterNavigate, goto } from '$app/navigation';
  import type { Bookmark, Filter, Recording } from '$lib/types';
  import { applyFilter, filterFromParams, filterToParams } from '$lib/filter';
  import { registerListFilter } from '$lib/listFilterBridge';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import TagInput from '$lib/components/TagInput.svelte';
  import Player from '$lib/components/Player.svelte';

  let { data } = $props();

  // svelte-ignore state_referenced_locally -- 최초 SSR/마운트 렌더가 곧바로
  // 올바르도록 초기값만 한 번 캡처한다. data가 이후에 실제로 바뀌는 경우
  // (아래 $effect)는 그때 다시 반영되므로 의도된 스냅샷이다.
  let recordings = $state<Recording[]>(data.recordings);
  // svelte-ignore state_referenced_locally
  let tags = $state(data.tags);
  let filter = $state<Filter>(filterFromParams(page.url.searchParams));
  let selectedIds = $state<Set<string>>(new Set());
  let editingId = $state<string | null>(null);
  let editingDescriptionId = $state<string | null>(null);
  // 태그 편집은 TagInput을 감싸 쓰는 쪽이라 blur 한 번으로 끝나지 않는다
  // (칩을 추가/삭제할 때마다 내부 포커스가 이동한다) — 그래서 제목·설명과
  // 달리 명시적인 "완료" 버튼으로 커밋 시점을 못박는다. tagsDraft는 그
  // 커밋 전까지의 작업 사본이고, 실제 rec.tags는 서버 응답이 온 뒤에만
  // (recordings 전체 교체를 통해) 바뀐다.
  let editingTagsId = $state<string | null>(null);
  let tagsDraft = $state<string[]>([]);
  // 일괄 태그 추가/제거에 쓸 작업 중인 태그 집합. 목록 화면 전체에서
  // 하나뿐이라 행별 편집(tagsDraft)과는 별개다.
  let bulkTags = $state<string[]>([]);

  // send() 실패를 화면에 보여줄 메시지. /import가 form.message를
  // preset-tonal-error 카드로 보여주는 것과 같은 패턴을 따른다.
  let errorMessage = $state<string | null>(null);

  // Task 15의 시접(seam): 행을 클릭하면 이 값만 바뀐다 — 페이지 이동도,
  // 목록 접힘도 없다. Task 15가 이 값을 읽어 하단 고정 플레이어에 녹음을
  // 로드한다.
  let selectedId = $state<string | null>(null);
  const selected = $derived(recordings.find((r) => r.id === selectedId) ?? null);

  // data는 SvelteKit이 load를 다시 실행할 때마다(예: /import에서 돌아오는
  // 내비게이션, invalidateAll 등) 새 참조로 바뀐다. 이 이펙트는 그 순간마다
  // recordings·tags를 최신 load 결과로 되돌린다 — 그러지 않으면 위 $state
  // 초기값이 마운트 시점 스냅샷으로 굳어버려서, 가져오기 화면에서 새로
  // 등록한 녹음이 목록으로 돌아와도 새로고침 전까지 보이지 않는다.
  // send()가 PATCH 응답으로 recordings·tags를 직접 덮어쓰는 경로와는
  // 충돌하지 않는다 — 여기서는 오직 data.recordings/data.tags만 읽고
  // recordings/tags 자체는 읽지 않으므로, send()의 로컬 갱신이 이 이펙트를
  // 다시 돌리지 않는다.
  $effect(() => {
    recordings = data.recordings;
  });
  $effect(() => {
    tags = data.tags;
  });

  const shown = $derived(applyFilter(recordings, filter));
  // 행 인라인 태그 편집·일괄 태그 추가/제거의 자동완성 후보.
  const tagNames = $derived(tags.map((t) => t.tag));

  // 선택은 필터가 바뀌어도 유지된다(스펙 의도: 필터로 골라낸 뒤 다시
  // 넓혀서 일괄 작업을 계속할 수 있어야 한다) — 다만 지금 화면에 없는
  // 선택 행이 섞여 있으면 일괄 작업이 안 보이는 행에도 적용된다는 걸
  // 툴바에서 알려준다.
  const hiddenSelectedCount = $derived(
    [...selectedIds].filter((id) => !shown.some((r) => r.id === id)).length
  );

  // SvelteKit 클라이언트 라우터는 하이드레이션이 끝난 뒤에야 goto 같은
  // 내비게이션 함수를 안전하게 받아준다. 이 컴포넌트의 첫 $effect 실행은
  // 하이드레이션 과정 그 자체(같은 마운트 배치) 안에서 일어나므로, 라우터가
  // "시작됨" 표시를 하기 *전에* 아래 goto가 불릴 위험이 있다 — 이 이펙트가
  // replaceState를 쓰던 시절엔 실제로 "Cannot call replaceState(...)
  // before router is initialized" 예외를 던졌다(node_modules/@sveltejs/kit의
  // client.js에서 pushState·replaceState는 `if (!started) throw`로 이
  // 예외를 던지지만, goto는 그런 가드가 없다 — DEV에서도 서버 호출·외부
  // URL만 막고 라우터 초기화 여부는 안 본다). 즉 이 가드가 막던 그 구체적인
  // 예외는 goto로 바뀐 뒤로는 안 던져진다는 뜻이라 이론적으로는 이 가드
  // 없이도 괜찮을 수 있지만, 실제로 없애 봐도 안전한지(하이드레이션
  // 도중 goto를 부르는 다른 부작용이 없는지)는 별도로 검증하지 않았다 —
  // 그래서 가드 자체(routerReady)는 그대로 두고, 주석의 "여전히 예외를
  // 던진다"는 낡은 서술만 정정한다(최종 브랜치 리뷰 발견 2).
  //
  // 실제로 관찰한 결과 프로덕션 빌드(vite preview)에서는 (replaceState를
  // 쓰던 시절) 이 예외가 이 배치의 나머지 이펙트 커밋 자체를 흔들어,
  // 이후 검색창에 타이핑해도 목록이 전혀 좁혀지지 않는 상태로 굳어버렸다
  // (dev 서버에서는 첫 호출만 실패하고 이후 갱신은 살아났지만, preview
  // 빌드에서는 필터링 자체가 죽었다) — 실제 브라우저로 프로덕션 빌드를
  // 눌러보지 않고서는(컴포넌트 테스트는 $app/navigation을 통째로 모킹해
  // 이 경합을 피해 간다) 잡을 수 없던 버그였다. afterNavigate는 최초
  // 진입 내비게이션을 포함해 라우터가 실제로 준비된 뒤에만 불리므로,
  // 그 신호가 오기 전까지는 URL 동기화를 미룬다.
  let routerReady = $state(false);
  afterNavigate(() => {
    routerReady = true;
  });

  // 메뉴바(+layout.svelte, 항상 떠 있다)의 검색이 이 화면의 filter.q를
  // 직접 바꿀 수 있도록 등록한다 — 자세한 이유는 $lib/listFilterBridge.ts
  // 참고(최종 브랜치 리뷰 발견 1: 메뉴바 검색과 아래 필터 → URL 이펙트가
  // 각자 goto를 부르면 서로 다른 순간의 스냅샷을 기준으로 겹쳐 써서 한쪽
  // 변경이 사라지는 경합이 있었다). 이 화면이 언마운트되면(다른 페이지로
  // 이동) 해제해, 더 이상 존재하지 않는 filter를 메뉴바가 계속 바꾸려는
  // 일이 없게 한다.
  onMount(() => registerListFilter((q) => (filter.q = q)));

  // URL → 필터. 메뉴바 검색처럼 이 화면 밖에서 URL이 바뀌는 경우를 따라간다.
  //
  // 아래의 필터 → URL 이펙트와 짝이라 루프가 될 수 있다. 들어온 값을
  // 같은 방식으로 직렬화해 지금 필터와 비교하고, 다를 때만 반영해서
  // 끊는다 — 우리가 쓴 URL이 되돌아오면 문자열이 같으므로 아무 일도
  // 일어나지 않는다.
  //
  // 비교의 오른쪽 절반(현재 filter)은 반드시 untrack으로 감싸 읽어야
  // 한다. filterToParams(filter)는 filter.q·filter.tags 등 필드를
  // 하나하나 읽는데, 이 읽기가 (untrack(() => filter)처럼 참조 하나만
  // 감싸는 게 아니라) 통째로 untrack 밖에서 일어나면 그 필드들이 이
  // 이펙트의 의존성으로 잡힌다. 그러면 "URL이 바뀔 때"뿐 아니라
  // "filter가 바뀔 때"(검색창 타이핑 등)에도 이 이펙트가 다시 돈다.
  // 실제 브라우저(프로덕션 빌드 포함)로 확인해 보니, 이 SvelteKit
  // 버전에서 replaceState는 page.url을 갱신하지 않는다(얕은 라우팅용으로
  // page.state만 갱신한다) — 그래서 로컬 타이핑만으로 이 이펙트가 다시
  // 돌면, page.url은 최초 진입 시 그대로라 지금 막 입력한 filter와
  // "다르다"고 잘못 판단해 그 자리에서 옛 URL 값으로 덮어써 버린다(검색창에
  // 아무 것도 입력할 수 없는 상태가 됨을 직접 재현·확인함). 비교 전체를
  // untrack으로 감싸야 filter 필드 읽기까지 전부 추적에서 빠져, 이
  // 이펙트가 오직 page.url이 실제로 바뀔 때만 돈다.
  $effect(() => {
    const incoming = filterFromParams(page.url.searchParams);
    if (untrack(() => filterToParams(incoming).toString() === filterToParams(filter).toString()))
      return;
    filter = incoming;
  });

  // 필터를 URL에 반영해 새로고침과 링크 공유에서 유지되게 한다.
  //
  // 얕은 라우팅(replaceState)이 아니라 진짜 내비게이션(goto)을 쓴다 — Fix
  // round 1~2에서 드러난 문제들(메뉴바 검색이 태그·기간을 잃어버리는 버그,
  // 초기화 후에도 메뉴바 검색창에 옛 검색어가 남는 버그)이 전부 같은
  // 원인에서 나왔다: @sveltejs/kit@2.70.3의 replaceState/pushState는
  // page.url을 절대 갱신하지 않는다(client.js 확인) — 얕은 라우팅으로
  // 쓴 필터는 브라우저 주소창에는 보이지만 SvelteKit이 아는 page.url에는
  // 영영 반영되지 않아, page.url을 읽는 다른 코드(메뉴바의 q prop 등)가
  // 전부 낡은 값을 본다. goto로 바꾸면 모든 필터 변경이 진짜 내비게이션이
  // 되어 page.url이 항상 최신이 되므로, 이 클래스의 버그 전체가 뿌리에서
  // 사라진다.
  //
  // 비용 확인(추측 아님, 실측): 이 라우트의 +page.server.ts load는
  // event.url을 전혀 읽지 않는다(매개변수조차 받지 않는 `async () => ({...})`
  // 형태) — SvelteKit은 load가 실제로 사용한 URL 부분만 추적해 내비게이션이
  // 그 부분을 바꿨을 때만 다시 부른다(node_modules/@sveltejs/kit/src/runtime/
  // client/client.js의 has_changed/uses.search_params 로직, 서버 쪽은
  // load_data.js의 동일한 uses 추적). load()에 호출 카운터를 임시로 넣고
  // dev 서버로 이 이펙트를 goto로 바꿔 기간·태그를 다섯 번 연속으로 바꿔봤더니
  // load()는 최초 마운트 한 번만 불렸다(카운트가 계속 1에 머묾) — 네트워크
  // 요청 목록에도 데이터 요청이 전혀 안 잡혔다. 즉 필터를 바꿀 때마다
  // 전체 목록을 서버에서 다시 불러오는 일은 없다.
  //
  // (아래 URL → 필터 이펙트의 untrack은 여전히 필요하다 — 실제로 지워보고
  // 확인했다. "빠르게 연속으로 바꿔야만" 깨지는 게 아니다 — 로컬 변경
  // 딱 한 번만으로도 곧바로 깨진다. goto는 비동기라 필터가 바뀐 바로 그
  // 순간에는 아직 page.url에 반영되지 않은 옛 값 그대로다. untrack 없는
  // 이 이펙트는 filter 변경 자체에 의존하므로, goto가 그 값을 URL에
  // 채 쓰기도 전에(같은 리액티브 플러시 안에서) 옛 page.url과 새 filter를
  // 비교해 "다르다"고 잘못 판단하고 방금 바꾼 값을 그 자리에서 되돌린다.
  // 뮤테이션 테스트로 확인한 결과, 태그 칩을 "한 번" 클릭하는 것만으로
  // page.svelte.test.ts의 4개 테스트가 즉시 깨졌다(연속 입력은 필요
  // 없었다) — 그중 "태그를 눌러 바꾼 값이 그 자리에서 되돌아가지 않는다"
  // 테스트가 정확히 이 단일 클릭 시나리오를 재현한다. 프로덕션 빌드(vite
  // preview)로도 재현했다. 그래서 이번 라운드에서도 그대로 둔다.)
  //
  // 이 이펙트는 이제 이 화면에서 URL로 goto를 부르는 유일한 지점이다 —
  // 메뉴바 검색은 더 이상 자기 goto를 따로 부르지 않고, 위 onMount에서
  // 등록한 대로 filter.q만 바꾼다(최종 브랜치 리뷰 발견 1). 태그·기간·
  // 검색어가 전부 이 하나의 filter 객체를 거쳐서만 URL에 반영되므로,
  // "지금 쿼리가 뭐냐"를 이 이펙트 밖에서 스냅샷으로 다시 읽어 병합할
  // 필요가 없다 — 그런 스냅샷이 없으니 두 writer가 서로 다른 순간의
  // 값을 기준으로 겹쳐 써서 한쪽 변경을 지우는 경합도 성립하지 않는다.
  $effect(() => {
    if (!routerReady) return;
    const qs = filterToParams(filter).toString();
    // 빈 필터일 때 '/'로 두면 목록이 아니라 메인으로 튕긴다.
    void goto(qs ? `?${qs}` : '/recordings', { replaceState: true, keepFocus: true, noScroll: true });
  });

  // 태그를 편집하던 행이 필터에 걸리거나(검색어 변경 등) 새 load
  // 결과에서 아예 사라지면(예: 삭제) 완료 버튼이 없는 화면 밖에 초안만
  // 남는다 — 행을 바꿀 때와 같은 규칙으로 그 자리에서 저장하고 편집을
  // 닫는다.
  $effect(() => {
    if (editingTagsId !== null && !shown.some((r) => r.id === editingTagsId)) {
      saveTags(editingTagsId, tagsDraft);
      editingTagsId = null;
    }
  });

  // 실패를 호출한 쪽에 boolean으로 돌려준다 — 그래야 각 호출부가
  // "성공했을 때만" 선택·초안을 비운다. 예전에는 실패해도 그냥
  // return해서, 호출부는 무조건 .then()에서 상태를 비웠다 — 400/500이
  // 나도(동시에 삭제된 행, updateJson 쓰기 실패 등) 툴바가 그대로
  // 닫히며 성공한 것처럼 보이고, 252개 중 골라둔 선택이 이유 없이
  // 사라졌다.
  async function send(body: unknown): Promise<boolean> {
    const res = await fetch('/api/recordings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      // API는 400에서 { message } JSON을 돌려준다 — 그 문구를 그대로
      // 보여준다. 본문을 못 읽으면(예상 밖의 500 등) 상태 코드만이라도.
      const failure = await res.json().catch(() => null);
      errorMessage =
        (failure && typeof failure.message === 'string' && failure.message) ||
        `요청이 실패했습니다 (${res.status})`;
      return false;
    }
    errorMessage = null;
    const next = await res.json();
    recordings = next.recordings;
    tags = next.tags;
    return true;
  }

  function toggle(id: string) {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    selectedIds = s;
  }

  function fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  }

  // 순수하게 서버로 보내기만 한다 — editingTagsId를 어떻게 다룰지는
  // 호출하는 쪽(완료 버튼 vs 다른 행/필터로 전환)이 각자 정한다.
  // commitTags가 여기서 editingTagsId까지 건드리면, startEditTags가 이미
  // 다음 행으로 넘어간 뒤에 이전 저장이 뒤늦게 끝나면서 방금 연 행의
  // 편집 상태를 지워버리는 경쟁 상태가 생긴다.
  function saveTags(id: string, draftTags: string[]) {
    return send({ op: 'patch', id, tags: draftTags });
  }

  function commitTags(id: string) {
    saveTags(id, tagsDraft).then((ok) => {
      if (ok) editingTagsId = null;
    });
  }

  function startEditTags(rec: Recording) {
    // 다른 행의 태그를 편집하던 중이면(완료를 안 누르고) 그 초안을 먼저
    // 저장한다 — 제목·설명은 blur로 이미 "옮겨가면 저장된다"가 되어
    // 있으니 태그도 같은 규칙을 따른다. 저장이 끝나길 기다리지 않는다
    // — 확인창도, 더러움 표시도 없이 그냥 저장하고 곧장 다음 행을 연다.
    if (editingTagsId !== null && editingTagsId !== rec.id) {
      saveTags(editingTagsId, tagsDraft);
    }
    tagsDraft = [...rec.tags];
    editingTagsId = rec.id;
  }

  // 플레이어가 현재 위치에 북마크를 추가할 때 호출한다. id는 서버가 아니라
  // 여기서 발급한다 — patch가 bookmarks 배열을 통째로 받아 검증하는
  // 구조라, id 없는 항목을 보내면 그 시점부터 이미 형식이 어긋난다.
  //
  // (Task 16 후속 리뷰에서 확인·의도적으로 남겨둔 잔여 경쟁 상태) 이
  // 함수는 Player의 localBookmarks가 아니라 selected.bookmarks(서버가
  // 마지막으로 확인해준 값)를 베이스로 배열을 만든다. 그래서 이 PATCH가
  // 아직 끝나기 전에 플레이어에서 메모 편집·삭제가 시작되면(그쪽은
  // localBookmarks를 베이스로 하므로 이 추가를 아직 모른다), 두 PATCH가
  // 서로 다른 스냅샷에서 계산돼 늦게 도착하는 응답이 상대의 변경을
  // 지울 수 있다 — 편집·삭제끼리는 localBookmarks 덕분에 이 문제가
  // 없지만(위 Player.svelte 주석 참고), "추가"는 id를 여기서(프론트)
  // 새로 발급해야 해서 Player가 응답이 오기 전엔 그 id를 몰라 자신의
  // 로컬 사본에 미리 반영해둘 수 없다. id 발급 위치를 바꾸지 않는 한
  // 구조적으로 못 고치는 한계라 이번 범위에서는 손대지 않았다
  // (.superpowers/sdd/2026-09-01-uls-player/task-16-report.md 참고).
  async function addBookmark(b: Omit<Bookmark, 'id'>) {
    if (!selected) return;
    const next = [...selected.bookmarks, { ...b, id: crypto.randomUUID() }];
    await send({ op: 'patch', id: selected.id, bookmarks: next });
  }

  // 플레이어의 북마크 목록에서 메모를 고치거나 항목을 지울 때 호출한다.
  // 이미 완성된 배열을 통째로 받아 그대로 patch에 넘긴다 — send()가
  // 실패를 errorMessage로 잡아 카드에 띄우므로 실패 표시 자체는 여기서
  // 따로 할 게 없다. 다만 성공 여부(send()의 반환값)는 그대로
  // Player에게 돌려준다 — Player가 낙관적으로 반영해둔 편집을 실패
  // 시 되돌리려면 이 결과가 필요하다(그냥 await만 하고 버리면, 에러
  // 카드는 뜨는데 메모칸은 방금 입력한 값을 그대로 보여주는 채로
  // 남는다).
  async function changeBookmarks(bookmarks: Bookmark[]): Promise<boolean> {
    if (!selected) return false;
    return send({ op: 'patch', id: selected.id, bookmarks });
  }
</script>

<div class="mx-auto max-w-6xl space-y-4 p-6 pb-40">
  <header class="flex items-baseline justify-between">
    <h1 class="h2">ULS Player</h1>
    <a href="/import" class="btn preset-filled">가져오기</a>
  </header>

  <FilterBar bind:filter {tags} total={recordings.length} shown={shown.length} />

  {#if errorMessage}
    <aside class="card preset-tonal-error p-4">{errorMessage}</aside>
  {/if}

  {#if selectedIds.size}
    <div class="card preset-tonal-primary flex flex-wrap items-center gap-3 p-3">
      <span class="shrink-0 text-sm">
        {selectedIds.size}개 선택됨
        {#if hiddenSelectedCount}
          <span class="text-surface-500">(현재 필터에 없는 {hiddenSelectedCount}개 포함)</span>
        {/if}
      </span>

      <!-- 252개 중 여러 행을 골라 태그를 한 번에 붙이는 게 이 화면의
           핵심 동선이라, 삭제보다 먼저·더 넓게 배치한다. -->
      <div class="flex grow flex-wrap items-center gap-2">
        <TagInput bind:tags={bulkTags} suggestions={tagNames} />
        <button type="button" class="btn btn-sm preset-filled"
          disabled={!bulkTags.length}
          onclick={() =>
            send({ op: 'addTags', ids: [...selectedIds], tags: bulkTags }).then((ok) => {
              if (ok) bulkTags = [];
            })}>
          태그 추가
        </button>
        <button type="button" class="btn btn-sm preset-tonal"
          disabled={!bulkTags.length}
          onclick={() =>
            send({ op: 'removeTags', ids: [...selectedIds], tags: bulkTags }).then((ok) => {
              if (ok) bulkTags = [];
            })}>
          태그 제거
        </button>
      </div>

      <button type="button" class="btn btn-sm preset-tonal"
        onclick={() =>
          send({ op: 'delete', ids: [...selectedIds] }).then((ok) => {
            if (ok) selectedIds = new Set();
          })}>
        목록에서 제거
      </button>
      <button type="button" class="btn btn-sm preset-tonal"
        onclick={() => (selectedIds = new Set())}>선택 해제</button>
    </div>
  {/if}

  {#if shown.length}
    <!-- 열 정의를 여기 한 곳에 두고 헤더 줄과 각 행이 함께 참조한다.
         행은 각각 독립된 그리드 컨테이너라, 내용에 따라 폭이 정해지는
         트랙(auto·min-content·max-content·fit-content)을 쓰면 행마다
         계산 결과가 달라져 열이 다시 어긋난다 — 특히 확장자 배지는
         행마다 개수가 다르다. 그래서 전부 fr과 고정 rem으로만 적는다.
         가변 열의 minmax(0, ...)에서 0 최소값을 빼면 긴 제목이 트랙을
         밀어낸다. 이 min-w 래퍼는 실제 열이 있는 행이 있을 때만
         의미가 있어서 이 {#if} 안에 둔다 — 밖에 두면 아래 {:else}의
         빈 상태 카드까지 56rem 밑으로 못 내려가게 가둬서, 좁은 화면에서
         "전체 폭을 쓴다"(스펙 6절)는 카드가 오히려 옆으로 스크롤해야
         보이는 회귀가 생긴다. -->
    <div class="overflow-x-auto" style="--row-cols: 2rem minmax(0,3fr) minmax(0,2fr) 11rem 5rem 9rem;">
      <div class="min-w-[56rem]">
        <!-- 이 목록은 table이 아니라 ul/li라 이 줄은 셀과 의미적으로
             연결되지 않는다. 각 셀은 이미 자기 내용을 읽을 수 있게
             갖고 있으므로(제목 버튼, 날짜·길이 텍스트, 포맷 배지),
             연결 없는 라벨이 따로 읽히지 않도록 장식으로 둔다. -->
        <div data-testid="list-header" aria-hidden="true"
          class="text-surface-500 grid items-center gap-3 p-3 text-sm"
          style="grid-template-columns: var(--row-cols);">
          <span>선택</span>
          <span>제목</span>
          <span>태그</span>
          <span>녹음일자</span>
          <span>길이</span>
          <span>저장된 확장자</span>
        </div>

        <ul class="space-y-1">
          {#each shown as rec (rec.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <!-- 행 아무 데나 눌러도 재생 대상으로 고른다(Task 15 시접, 스펙:
                 "행을 클릭하면 하단 플레이어에 로드"). li 자체를 새 키보드
                 타깃으로 만들 필요는 없다 — 제목이 이미 진짜 <button>이라
                 Tab·Enter로도 같은 동작에 닿고, li에 role="button"은
                 listitem이 가질 수 없는 role이라 줄 수도 없다. 그래서 li의
                 클릭은 그 외 빈 영역(날짜·길이·포맷 배지)만을 위한 포인터
                 전용 편의로 남긴다. 체크박스·제목/설명 칸·태그 칸은 각자
                 onclick에서 stopPropagation해 이 클릭이 거기까지 번지지
                 않게 막는다. -->
            <li class="card hover:preset-tonal grid items-center gap-3 p-3"
              style="grid-template-columns: var(--row-cols);"
              class:preset-tonal-primary={selectedId === rec.id}
              onclick={() => (selectedId = rec.id)}>
              <input type="checkbox" class="checkbox"
                checked={selectedIds.has(rec.id)}
                onchange={() => toggle(rec.id)}
                onclick={(e) => e.stopPropagation()} />

              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <!-- 이 컬럼 안의 클릭은 행 선택으로 안 번진다 — 제목은 자기
                   onclick으로 이미 선택을 직접 처리하고(그래서 stopPropagation
                   이후에도 그대로 동작), 설명의 보기/편집 컨트롤은 선택과
                   무관한 별개 동작이다. 이 div 자체를 새 상호작용 요소로 만드는
                   게 아니라, 그 안의 실제 컨트롤(버튼·입력)에게 이미 있는
                   동작을 행 선택이 가리지 않게 전파만 끊는 것이다. -->
              <div class="flex min-w-0 flex-col gap-1" onclick={(e) => e.stopPropagation()}>
                {#if editingId === rec.id}
                  <input class="input" value={rec.title}
                    onblur={(e) => {
                      send({ op: 'patch', id: rec.id, title: e.currentTarget.value }).then(
                        (ok) => {
                          if (ok) editingId = null;
                        }
                      );
                    }} />
                {:else}
                  <!-- 재생 대상 선택(Task 15의 시접)과 제목 수정 진입을 같은
                       버튼에 둔다 — 이미 포커스·키보드 조작이 되는 실제 버튼이라
                       li 자체를 인위적으로 상호작용 요소로 만들 필요가 없다. -->
                  <button type="button" class="text-left"
                    onclick={() => (selectedId = rec.id)}
                    ondblclick={() => (editingId = rec.id)}>
                    {rec.title}
                  </button>
                {/if}

                {#if editingDescriptionId === rec.id}
                  <input class="input text-sm" value={rec.description} aria-label="설명 수정"
                    onblur={(e) => {
                      send({ op: 'patch', id: rec.id, description: e.currentTarget.value }).then(
                        (ok) => {
                          if (ok) editingDescriptionId = null;
                        }
                      );
                    }} />
                {:else}
                  <!-- 제목 버튼과 같은 이유로 onclick을 직접 갖는다 — 부모
                       div가 행 클릭을 끊으므로, 여기 없으면 설명을 눌렀을 때
                       아무 일도 일어나지 않는다. 더블클릭 편집은 그대로다:
                       첫 클릭이 행을 고르고 두 번째 클릭에서 편집이 열린다. -->
                  <button type="button" class="text-surface-500 text-left text-sm"
                    onclick={() => (selectedId = rec.id)}
                    ondblclick={() => (editingDescriptionId = rec.id)}>
                    {rec.description || '설명 없음'}
                  </button>
                {/if}
              </div>

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
                  <!-- 설명 버튼과 같은 이유다 — 태그 칸은 열 하나를 통째로
                       차지해서, 여기가 죽어 있으면 행에서 가장 누르기 쉬운
                       자리가 반응하지 않는다. -->
                  <button type="button" class="flex flex-wrap gap-1 text-left"
                    onclick={() => (selectedId = rec.id)}
                    ondblclick={() => startEditTags(rec)}>
                    {#each rec.tags as t (t)}<span class="chip preset-tonal">{t}</span>{/each}
                    {#if !rec.tags.length}<span class="text-surface-500 text-sm">태그 없음</span>{/if}
                  </button>
                {/if}
              </div>

              <span class="text-surface-500 text-sm tabular-nums">
                {rec.recordedAt.replace('T', ' ').slice(0, 16)}
              </span>
              <span class="text-sm tabular-nums">{fmt(rec.durationSec)}</span>
              <div class="flex gap-1">
                {#each Object.keys(rec.files) as f (f)}
                  <span class="badge preset-tonal text-xs uppercase">{f === 'original' ? rec.files[f].ext : f}</span>
                {/each}
              </div>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {:else}
    <!-- 빈 상태 카드는 열 정의(--row-cols)를 쓰지 않는다(스펙 6절:
         "빈 상태 카드는 그리드 템플릿을 쓰지 않고 전체 폭을 쓴다") —
         그래서 위 min-w-[56rem]/overflow-x-auto 래퍼 밖에 따로 둔다.
         그 래퍼 안에 있었다면 실제 열이 하나도 없는데도 56rem 밑으로
         못 내려가 좁은 화면에서 카드가 옆으로 밀려나 보였을 것이다. -->
    <ul class="space-y-1">
      <li class="card preset-tonal p-8 text-center">
        {recordings.length ? '조건에 맞는 녹음이 없습니다' : '아직 가져온 녹음이 없습니다'}
      </li>
    </ul>
  {/if}
</div>

<Player
  recording={selected}
  formats={['original', ...data.formats]}
  mediaDir={data.mediaDir}
  onbookmark={addBookmark}
  onbookmarkchange={changeBookmarks}
/>
