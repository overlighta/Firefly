<script lang="ts">
import { onMount } from "svelte";
import { authState } from "@/lib/auth/state";
import { loadSpaceData } from "@/lib/memory/real-memory";
import { getMemoryDetailHref } from "@/lib/memory/detail-href";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Memory } from "@/types/memory";
import { spaceDataVersion } from "@/lib/realtime/invalidation";
let query = "";
let memories: Memory[] = [];
let loading = true;
let error = "";
let inFlight = false;
let pending = false;
let disposed = false;
$: normalized = query.trim().toLocaleLowerCase();
$: results = normalized ? memories.filter(memory => [memory.title, memory.date, memory.location, memory.note, ...memory.perspectives.map(p => p.content)].some(text => text?.toLocaleLowerCase().includes(normalized))) : [];
async function load() {
  if (!$authState.space) return;
  if (inFlight) { pending = true; return; }
  inFlight = true; pending = false;
  loading = true; error = "";
  try { memories = (await loadSpaceData(getSupabaseClient(), $authState.space.id, "timeline")).memories; }
  catch { error = "暂时无法读取记忆，请稍后重试。"; }
  finally { loading = false; inFlight = false; if (pending && !disposed) void load(); }
}
onMount(() => {
  const unsubscribe = spaceDataVersion.subscribe(() => { void load(); });
  return () => { disposed = true; unsubscribe(); };
});
</script>
<section class="journal-search">
  <label for="memory-search">搜索我们的记忆</label>
  <input id="memory-search" type="search" bind:value={query} placeholder="试试：散步、旅行、2026-09…" autocomplete="off" />
  <p class="journal-search__meta" aria-live="polite">{loading ? "正在整理记忆…" : error ? error : normalized ? `找到 ${results.length} 段记忆` : `在 ${memories.length} 段共同记忆中寻找`}</p>
  {#if error}<button class="app-secondary" on:click={load}>重试</button>{/if}
  <div class="journal-search__results">{#each results as memory (memory.id)}<a href={getMemoryDetailHref(memory.id)}><time>{memory.date}</time><h2>{memory.title || memory.location || "平凡而珍贵的一天"}</h2><p>{(memory.perspectives[0]?.content || memory.note || "打开这段记忆").slice(0, 140)}</p><span>{memory.location || "我们的日常"} <i>翻开这一页 →</i></span></a>{/each}</div>
  {#if normalized && !results.length && !loading && !error}<div class="journal-empty"><span>还没找到这一页</span><p>换一个词，或用日期再试试。</p></div>{/if}
</section>
