<script lang="ts">
import { onDestroy } from "svelte";
import { createMemoryPhotoSignedUrls } from "@/lib/memory/real-memory";
import { getSupabaseClient } from "@/lib/supabase/client";

export let path: string | null;
export let url: string | null;
export let signing = false;
export let alt = "生活照片";
let refreshedUrl: string | null = null;
let loaded = false;
let failed = false;
let retrying = false;
let retried = false;
let attempt = 0;
let destroyed = false;
$: source = refreshedUrl ?? url;
onDestroy(() => { destroyed = true; });

async function retry() {
  if (!path || retrying) return;
  retrying = true;
  failed = false;
  loaded = false;
  retried = true;
  try {
    const urls = await createMemoryPhotoSignedUrls(getSupabaseClient(), [path], true);
    if (destroyed) return;
    refreshedUrl = urls.get(path) ?? null;
    failed = !refreshedUrl;
    attempt++;
  } catch {
    if (!destroyed) failed = true;
  } finally {
    if (!destroyed) retrying = false;
  }
}
function imageError() {
  loaded = false;
  if (!retried) void retry();
  else failed = true;
}
</script>

<div class="memory-real-card__photo" class:is-empty={!source || failed} aria-busy={signing || retrying || (!!source && !loaded && !failed)}>
  {#if source && !failed}
    {#key source + attempt}
      <img src={source} {alt} loading="lazy" decoding="async" on:load={() => { loaded = true; failed = false; }} on:error={imageError} />
    {/key}
  {/if}
  {#if !path}
    <span>还没有照片</span>
  {:else if failed || (!source && !signing && !retrying)}
    <div class="cover-status"><span>照片暂时无法加载</span><button type="button" on:click={retry}>重新加载照片</button></div>
  {:else if !loaded}
    <span class="cover-status" aria-live="polite">正在加载照片…</span>
  {/if}
</div>

<style>
  .memory-real-card__photo { position: relative; }
  .cover-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: .6rem; pointer-events: none; }
  .cover-status button { pointer-events: auto; padding: .4rem .7rem; border: 1px solid currentColor; border-radius: .5rem; background: var(--memory-paper, #faf8f2); color: inherit; cursor: pointer; font: inherit; }
</style>
