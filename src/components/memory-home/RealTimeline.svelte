<script lang="ts">
import TimelinePhoto from "./TimelinePhoto.svelte";
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";

import {
	getErrorCode,
	getErrorMessage,
	getErrorStatus,
	getPerfDuration,
	getPerfTime,
} from "@/lib/auth/debug";
import { authState } from "@/lib/auth/state";
import { getMemoryDetailHref } from "@/lib/memory/detail-href";
import { perfNavMark } from "@/lib/memory/perf-nav";
import { loadSpaceData } from "@/lib/memory/real-memory";
import { spaceDataVersion } from "@/lib/realtime/invalidation";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Memory } from "@/types/memory";

interface MonthGroup {
	key: string;
	label: string;
	memories: Memory[];
}

interface YearGroup {
	months: MonthGroup[];
	storyCount: number;
	year: string;
}

export let active = false;
let oldestFirst = false;
let memories: Memory[] = [];
let loading = true;
let errorMessage = "";
let loadedSpaceId: string | null = null;
let refreshInFlight = false;
let refreshPending = false;
let destroyed = false;

$: context = $authState;
$: groups = groupTimelineMemories(memories, oldestFirst);
$: if (
	context.status === "authenticated" &&
	context.space?.id &&
	context.space.id !== loadedSpaceId
) {
	void reloadTimeline();
}

onDestroy(() => { destroyed = true; });

onMount(() => {
	perfNavMark("island mount", { page: "timeline" });
	if (
		context.status === "authenticated" &&
		context.space?.id &&
		!loadedSpaceId
	) {
		void reloadTimeline();
	}
	return subscribeToSpaceChanges();
});

function subscribeToSpaceChanges() {
	const initialSignalVersion = get(spaceDataVersion).version;

	return spaceDataVersion.subscribe((signal) => {
		if (signal.version <= initialSignalVersion) return;
		if (signal.spaceId !== context.space?.id) return;
		void refreshTimelineSilently();
	});
}

async function refreshTimelineSilently() {
	if (destroyed) return;
	if (refreshInFlight || loading) { refreshPending = true; return; }
	refreshPending = false;
	if (context.status !== "authenticated" || !context.space?.id) return;

	refreshInFlight = true;
	try {
		const result = await loadSpaceData(
			getSupabaseClient(),
			context.space.id,
			"timeline",

		);
		memories = result.memories;
		errorMessage = "";
	} catch (error) {
		if (import.meta.env.DEV) {
			console.warn("[TIMELINE] silent refresh failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		refreshInFlight = false;
		if (refreshPending && !destroyed) void refreshTimelineSilently();
	}
}

async function reloadTimeline() {
	if (context.status !== "authenticated" || !context.space?.id) return;

	const startedAt = getPerfTime();
	const spaceId = context.space.id;
	loadedSpaceId = spaceId;
	loading = true;
	errorMessage = "";
	perfNavMark("page query start", { page: "timeline" });

	try {
		const result = await loadSpaceData(
			getSupabaseClient(),
			spaceId,
			"timeline",

		);
		memories = result.memories;
		perfNavMark("page query end", {
			page: "timeline",
			count: memories.length,
			ms: getPerfDuration(startedAt),
		});
	} catch (error) {
		errorMessage = "时间轴暂时无法读取。请稍后重试。";
		if (import.meta.env.DEV) {
			console.warn("[TIMELINE] query failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		loading = false;
		if (refreshPending && !destroyed) void refreshTimelineSilently();
	}
}

function groupTimelineMemories(items: Memory[], oldestFirst: boolean): YearGroup[] {
  const years = new Map<string, Map<string, Memory[]>>();
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  if (oldestFirst) sorted.reverse();
  for (const memory of sorted) {
    const [year, month] = memory.date.split("-");
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year)!;
    months.set(month, [...(months.get(month) ?? []), memory]);
  }
  return [...years].map(([year, months]) => ({
    year,
    storyCount: [...months.values()].reduce((sum, items) => sum + items.length, 0),
    months: [...months].map(([month, memories]) => ({ key: `${year}-${month}`, label: `${Number(month)}月`, memories })),
  }));
}
function excerpt(memory: Memory) {
  return memory.note?.trim() || memory.perspectives.find(item => item.content.trim())?.content.trim() || "";
}
function entryTitle(memory: Memory) {
  return memory.title?.trim() || excerpt(memory).split("\n")[0].slice(0, 60) || "把这一天留在这里";
}
function authorName(id: string) {
  return context.space?.members.find(member => member.userId === id)?.profile?.displayName ?? "我们";
}
function weekday(date: string) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${date}T12:00:00`));
}
function turnToMonth(key: string) {
  const target = document.getElementById(`chapter-${key}`);
  target?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  target?.focus({ preventScroll: true });
}
</script>

{#if loading}
  <section class="memory-real-state memory-timeline-state"><h1>正在翻开时间轴…</h1></section>
{:else if errorMessage}
  <section class="memory-real-state memory-timeline-state"><h1>时间轴暂时无法打开。</h1><span>{errorMessage}</span><button type="button" on:click={reloadTimeline}>再试一次</button></section>
{:else if memories.length === 0}
  <section class="memory-real-empty memory-timeline-empty"><h1>年册的第一页，留给今天。</h1><span>写下一件小事，往后的日子就从这里接起来。</span><a href="/">记录今天 →</a></section>
{:else}
  <section class="chronicle" aria-label="我们的生活年册">
    <div class="chronicle-toolbar">
      <div><span class="chronicle-kicker">OUR DAYS / 生活年册</span><p><strong>{memories.length}</strong> 段日常，装订成 <strong>{groups.length}</strong> 本年册</p></div>
      <label>翻阅顺序<select bind:value={oldestFirst}><option value={false}>从最近看</option><option value={true}>从最早看</option></select></label>
    </div>
    <div class="chronicle-layout">
      <aside class="chronicle-directory" aria-label="年月目录">
        <p>翻到那个月 <span aria-hidden="true">↘</span></p>
        {#each groups as group}
          <div class="chronicle-directory__year">
            <strong>{group.year}<small>{group.storyCount} 段</small></strong>
            <div>{#each group.months as month}<button type="button" on:click={() => turnToMonth(month.key)} aria-label={`翻到${group.year}年${month.label}`}><span>{month.label}</span><small>{month.memories.length}</small></button>{/each}</div>
          </div>
        {/each}
        <span class="chronicle-directory__note">一天一页<br />慢慢成为我们。</span>
      </aside>
      <div class="chronicle-chapters">
        {#each groups as group (group.year)}
          {#each group.months as month (month.key)}
            <section id={`chapter-${month.key}`} class="chronicle-month" tabindex="-1" aria-label={`${group.year}年${month.label}`}>
              <header class="chronicle-month__heading">
                <div><span>{group.year} / 生活切片</span><h2>{month.label}<i aria-hidden="true">.</i></h2></div>
                <p>{month.memories.length} 段记忆<span>{month.memories.reduce((sum, item) => sum + item.photos.length, 0)} 张照片</span></p>
              </header>
              <div class="chronicle-entries">
                {#each month.memories as memory, index (memory.id)}
                  <article class="chronicle-entry" class:chronicle-entry--photo={memory.photos.length > 0} class:chronicle-entry--opening={index === 0} data-memory-id={memory.id}>
                    <div class="chronicle-entry__date"><time datetime={memory.date}><strong>{memory.date.slice(8)}</strong><span>{weekday(memory.date)}</span></time><span>{memory.location || "日常一页"}</span></div>
                    <div class="chronicle-entry__sheet">
                      {#if memory.photos[0]}
                        <figure class="chronicle-picture">
                          {#key memory.photos[0].storagePath}<TimelinePhoto path={memory.photos[0].storagePath} alt={memory.photos[0].alt || `${memory.date}的生活照片`} {active} />{/key}
                          <figcaption><span>{memory.date.replaceAll("-", ".")}</span><span>共 {memory.photos.length} 张</span></figcaption>
                        </figure>
                      {/if}
                      <div class="chronicle-entry__copy">
                        <div class="chronicle-entry__meta"><span>{memory.weather || "日常收集"}{memory.temperature ? ` · ${memory.temperature}` : ""}</span><span>第 {String(index + 1).padStart(2, "0")} 页</span></div>
                        <h3><a href={getMemoryDetailHref(memory.id)}>{entryTitle(memory)}</a></h3>
                        {#if excerpt(memory) && excerpt(memory) !== entryTitle(memory)}<p class="chronicle-excerpt">{excerpt(memory)}</p>{:else if !excerpt(memory)}<p class="chronicle-excerpt chronicle-excerpt--empty">{memory.photos.length ? "照片收好了，文字留给下一次。" : "日子先记下，故事慢慢补。"}</p>{/if}
                        {#if memory.song?.title}<p class="chronicle-song">♫ <span>{memory.song.title}{memory.song.artist ? ` · ${memory.song.artist}` : ""}</span></p>{/if}
                        <footer><div class="chronicle-authors">{#each [...new Set(memory.perspectives.map(item => item.userId))] as id}<span><i aria-hidden="true">{authorName(id).slice(0, 1)}</i>{authorName(id)}</span>{/each}</div><a href={getMemoryDetailHref(memory.id)}>翻开这一天 <span aria-hidden="true">↗</span></a></footer>
                      </div>
                    </div>
                  </article>
                {/each}
              </div>
              <div class="chronicle-month__end"><span aria-hidden="true">✳</span> {group.year}年{month.label}，收好。</div>
            </section>
          {/each}
        {/each}
        <a class="chronicle-next" href="/"><span>下一页，还在生活里。</span><strong>记下今天 →</strong></a>
      </div>
    </div>
  </section>
{/if}
