<script lang="ts">
import { buildFootprints } from "@/lib/memory/footprints";
import MemoryCover from "./MemoryCover.svelte";
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";

import {
	getErrorCode,
	getErrorMessage,
	getErrorStatus,
	getPerfDuration,
	getPerfTime,
	perfDebug,
} from "@/lib/auth/debug";
import { authState } from "@/lib/auth/state";
import { getMemoryDetailHref } from "@/lib/memory/detail-href";
import { perfNavMark } from "@/lib/memory/perf-nav";
import { createMemoryPhotoSignedUrls, loadSpaceData } from "@/lib/memory/real-memory";
import { spaceDataVersion } from "@/lib/realtime/invalidation";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Memory } from "@/types/memory";

export let active = false;
let coverUrls = new Map<string, string>();
let signingPhotos = false;
let coverRequestVersion = 0;
let loadedCoverKey = "";
let memories: Memory[] = [];
let loading = true;
let errorMessage = "";
let loadedSpaceId: string | null = null;
let selectedGroupKey: string | null = null;
let refreshInFlight = false;
let refreshPending = false;
let destroyed = false;

$: context = $authState;
$: mapGroups = buildFootprints(memories);
$: selectedGroup = mapGroups.find(group => group.key === selectedGroupKey) ?? mapGroups[0] ?? null;
$: photoCount = memories.reduce((total, memory) => total + memory.photos.length, 0);
$: placeCount = mapGroups.filter(group => !group.pending).length;
$: selectedPhotos = (selectedGroup?.memories ?? []).flatMap(memory => memory.photos.map(photo => ({ photo, memory }))).slice(0, 3);
$: coverKey = selectedPhotos.map(item => item.photo.storagePath).join("|");
$: if (active && coverKey !== loadedCoverKey) void loadCovers(selectedPhotos.map(item => item.photo.storagePath), coverKey);
async function loadCovers(paths: string[], key: string) {
  loadedCoverKey = key; const version = ++coverRequestVersion; signingPhotos = true; coverUrls = new Map();
  try { const urls = await createMemoryPhotoSignedUrls(getSupabaseClient(), paths); if (!destroyed && version === coverRequestVersion) coverUrls = urls; }
  catch { /* Each cover offers its own retry if the initial request fails. */ }
  finally { if (!destroyed && version === coverRequestVersion) signingPhotos = false; }
}
$: if (!selectedGroupKey && mapGroups.length > 0) {
	selectedGroupKey = mapGroups[0].key;
}
$: if (
	selectedGroupKey &&
	mapGroups.length > 0 &&
	!mapGroups.some((group) => group.key === selectedGroupKey)
) {
	selectedGroupKey = mapGroups[0].key;
}
$: if (
	context.status === "authenticated" &&
	context.space?.id &&
	context.space.id !== loadedSpaceId
) {
	void reloadMap();
}

onDestroy(() => { destroyed = true; });

onMount(() => {
	perfNavMark("island mount", { page: "map" });

	if (
		context.status === "authenticated" &&
		context.space?.id &&
		!loadedSpaceId
	) {
		void reloadMap();
	}
	return subscribeToSpaceChanges();
});

onDestroy(() => {
	perfDebug("map destroy", { path: window.location.pathname });
});

function subscribeToSpaceChanges() {
	const initialSignalVersion = get(spaceDataVersion).version;

	return spaceDataVersion.subscribe((signal) => {
		if (signal.version <= initialSignalVersion) return;
		if (signal.spaceId !== context.space?.id) return;
		void refreshMapSilently();
	});
}

async function refreshMapSilently() {
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
			console.warn("[MAP] silent refresh failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		refreshInFlight = false;
		if (refreshPending && !destroyed) void refreshMapSilently();
	}
}

async function reloadMap() {
	if (context.status !== "authenticated" || !context.space?.id) return;

	const startedAt = getPerfTime();
	const spaceId = context.space.id;
	loadedSpaceId = spaceId;
	loading = true;
	errorMessage = "";
	selectedGroupKey = null;
	perfNavMark("page query start", { page: "map" });

	try {
		const result = await loadSpaceData(
			getSupabaseClient(),
			spaceId,
			"timeline",

		);
		memories = result.memories;
		const nextMapGroups = buildFootprints(result.memories);
		perfNavMark("page query end", {
			page: "map",
			count: memories.length,
			ms: getPerfDuration(startedAt),
		});
		perfDebug("map marker count", {
			count: result.memories.length,
			groupCount: nextMapGroups.length,
			noCoordinateCount: result.memories.filter(memory => !memory.coordinates).length,
		});
	} catch (error) {
		errorMessage = "地图数据暂时无法读取。请稍后重试。";
		if (import.meta.env.DEV) {
			console.warn("[MAP] query failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		loading = false;
		if (refreshPending && !destroyed) void refreshMapSilently();
	}
}

function selectGroup(key: string) {
	selectedGroupKey = key;
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(new Date(`${value}T00:00:00`));
}

function getMemorySummary(memory: Memory) {
	return (
		memory.title ??
		memory.perspectives[0]?.content ??
		memory.note ??
		memory.location ??
		"一段新的共同记忆。"
	);
}

function getAuthorNames(memory: Memory) {
	return memory.perspectives.map(item => item.profile?.displayName ??
		context.space?.members.find(member => member.userId === item.userId)?.profile?.displayName ?? "成员").join(" / ") || "共同记忆";
}

</script>

{#if loading}
	<section class="memory-real-state memory-map-state">
		<h1>正在展开地图…</h1>
	</section>
{:else if errorMessage}
	<section class="memory-real-state memory-map-state">
		<h1>地图暂时无法打开。</h1>
		<span>{errorMessage}</span>
		<button type="button" on:click={reloadMap}>再试一次</button>
	</section>
{:else if memories.length === 0}
  <section class="travel-empty"><span>OUR TRAVEL JOURNAL</span><h2>第一站，可以是家门口。</h2><p>写一段记忆，选一个地点。以后再来这里，就能翻到那天的照片和心情。</p><a href="/">写下第一段记忆 ↗</a></section>
{:else}
  <section class="travel-album" aria-label="我们的旅行手帐">
    <div class="travel-summary"><span>OUR PLACES <i> / 地点收藏</i></span><div><strong>{placeCount}</strong> 处地方 <b>·</b> <strong>{memories.length}</strong> 页记忆 <b>·</b> <strong>{photoCount}</strong> 张照片</div></div>
    <div class="travel-tabs" aria-label="选择一个地点">
      {#each mapGroups as group, index (group.key)}
        <button type="button" aria-pressed={selectedGroup?.key === group.key} class:is-active={selectedGroup?.key === group.key} on:click={() => selectGroup(group.key)}><small>{String(index + 1).padStart(2, "0")}</small><span>{group.location}</span><em>{group.memories.length} 页</em></button>
      {/each}
    </div>
    {#if selectedGroup}
      <div class="travel-spread">
        <div class="travel-photos" class:travel-photos--single={selectedPhotos.length <= 1}>
          {#if selectedPhotos.length && active}
            {#each selectedPhotos as item, index (item.photo.storagePath)}
              <figure class:travel-photo--hero={index === 0}>
                <MemoryCover path={item.photo.storagePath} url={coverUrls.get(item.photo.storagePath) ?? null} signing={signingPhotos} alt={item.photo.alt ?? item.memory.title ?? selectedGroup.location} />
                <figcaption><span>{formatDate(item.memory.date)}</span><a href={getMemoryDetailHref(item.memory.id)} aria-label={`查看照片所在记忆：${getMemorySummary(item.memory)}`}>翻开这一天 ↗</a></figcaption>
              </figure>
            {/each}
          {:else}
            <div class="travel-no-photo"><span aria-hidden="true">✳</span><p>还没贴上照片，<br />故事已经留在这里。</p><a href={getMemoryDetailHref(selectedGroup.memories[0].id)}>为这一页添张照片 ↗</a></div>
          {/if}
        </div>
        <aside class="travel-letter">
          <div class="travel-letter__top"><span>写给我们的一张明信片</span><div class="travel-postmark" aria-label={`${selectedGroup.memories.length}页共同记忆`}><small>共同收藏</small><strong>{String(selectedGroup.memories.length).padStart(2, "0")}</strong><small>页记忆</small></div></div>
          <p class="travel-letter__eyebrow">在这里，有我们的故事</p>
          <h2>{selectedGroup.location}</h2>
          <p class="travel-letter__dates">{formatDate(selectedGroup.memories[selectedGroup.memories.length - 1].date)}{selectedGroup.memories[0].date !== selectedGroup.memories[selectedGroup.memories.length - 1].date ? ` — ${formatDate(selectedGroup.memories[0].date)}` : ""}</p>
          <p class="travel-letter__quote">{selectedGroup.memories[0].perspectives[0]?.content || selectedGroup.memories[0].note || "有些地方，因为一起去过，就变得不一样。"}</p>
          <a class="travel-read" href={getMemoryDetailHref(selectedGroup.memories[0].id)}>翻开最近的一页 <span aria-hidden="true">→</span></a>
          <div class="travel-locator" aria-label="地点方位示意">
            <span class="travel-locator__north" aria-hidden="true">N ↑</span>
            {#if selectedGroup.coordinates}
              {#each mapGroups.filter(group => group.coordinates) as group (group.key)}
                <button type="button" class:is-active={selectedGroup.key === group.key} style={`left:${group.x}%;top:${group.y}%`} on:click={() => selectGroup(group.key)} aria-label={`切换到${group.location}`}><i></i><span>{group.location}</span></button>
              {/each}
            {:else}<p>地点已经收好，<br />以后也可以再补上城市。</p>{/if}
            <small>地点方位示意 · 非导航地图</small>
          </div>
        </aside>
      </div>
      <section class="travel-stories" aria-label={`${selectedGroup.location}的记忆`}>
        <header><div><p>THE DAYS WE KEEP</p><h2>在{selectedGroup.pending ? "这些日子" : selectedGroup.location}，留下的 {selectedGroup.memories.length} 页</h2></div><span>从最近的一天翻起</span></header>
        <div class="travel-story-list">
          {#each selectedGroup.memories as memory (memory.id)}
            <a class="travel-story" href={getMemoryDetailHref(memory.id)}>
              <time datetime={memory.date}><strong>{memory.date.slice(8)}</strong><span>{memory.date.slice(0, 7).replace("-", " / ")}</span></time>
              <div><p>{memory.location || "还没写下地点"}{memory.weather ? ` · ${memory.weather}` : ""}</p><h3>{getMemorySummary(memory)}</h3><span>{getAuthorNames(memory)} · {memory.photos.length} 张照片</span></div><span class="travel-story__arrow" aria-hidden="true">↗</span>
            </a>
          {/each}
        </div>
      </section>
    {/if}
  </section>
{/if}
