<script lang="ts">
import { onMount } from "svelte";
import MemoryCover from "./MemoryCover.svelte";
import { createMemoryPhotoSignedUrls } from "@/lib/memory/real-memory";
import { getSupabaseClient } from "@/lib/supabase/client";

export let path: string;
export let alt: string;
export let active = false;
let element: HTMLDivElement;
let nearby = false;
let requested = false;
let destroyed = false;
let url: string | null = null;
let signing = true;
$: if (active && nearby && !requested) void load();
onMount(() => {
  const observer = new IntersectionObserver(entries => {
    nearby = entries.some(entry => entry.isIntersecting);
  }, { rootMargin: "160px" });
  observer.observe(element);
  return () => { destroyed = true; observer.disconnect(); };
});
async function load() {
  requested = true;
  try {
    const urls = await createMemoryPhotoSignedUrls(getSupabaseClient(), [path]);
    if (!destroyed) url = urls.get(path) ?? null;
  } catch { /* MemoryCover provides a manual retry when signing fails. */ }
  finally { if (!destroyed) signing = false; }
}
</script>

<div class="chronicle-photo" bind:this={element}>
  <MemoryCover {path} {url} {signing} {alt} />
</div>
