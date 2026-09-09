<script lang="ts">
  let { data } = $props();
</script>

<div class="mx-auto max-w-3xl space-y-6 p-8">
  <header class="space-y-2">
    <h1 class="h1">ULS Player</h1>
    <p class="text-surface-600-400">
      애플 음성 메모로 녹음한 파일을 정리하고 재생합니다.
    </p>
  </header>

  <div class="flex flex-wrap gap-3">
    <a href="/recordings" class="btn preset-filled-primary-500">녹음 목록</a>
    <a href="/import" class="btn preset-tonal">가져오기</a>
  </div>

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
    <!--
      제목과 달리 "언제 추가됐는가" 하나만으로 정렬되지 않는다: 배치
      임포트로 들어온 녹음은 전부 같은 createdAt을 가지므로, 동률일 때는
      recordedAt이 더 최근인 쪽이 앞선다(+page.server.ts의 byTimeDesc).
      자세한 내용은 docs/known-issues.md 참고.
    -->
    <h2 class="h3">최근 추가된 음악</h2>
    <ul class="space-y-1">
      {#each data.recent as r (r.id)}
        <li><a class="anchor" href="/recordings?play={r.id}">{r.title}</a></li>
      {/each}
    </ul>
  </section>
</div>
