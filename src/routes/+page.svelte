<script lang="ts">
  // 스펙 4절: 지금은 자리만 잡는다. 무엇을 담을지는 따로 정하기로 했으므로
  // 여기에 임의의 내용을 넣지 않는다 — 넣으면 실제 요구가 왔을 때 걷어내야 한다.
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
</div>
