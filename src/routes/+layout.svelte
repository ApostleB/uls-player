<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import MenuBar from '$lib/components/MenuBar.svelte';

  let { children } = $props();
</script>

<MenuBar pathname={page.url.pathname} />

{@render children()}
