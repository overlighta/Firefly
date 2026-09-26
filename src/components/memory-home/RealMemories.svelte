<script lang="ts">
import { drawRecollection, filterRecollections, memoryMoods, type RecollectionFilter } from "@/lib/memory/recollections";
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
import MemoryCover from "./MemoryCover.svelte";
import {
	createMemoryPhotoSignedUrls,
	loadSpaceData,
} from "@/lib/memory/real-memory";
import { spaceDataVersion } from "@/lib/realtime/invalidation";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Memory } from "@/types/memory";

export let active = false;
let letterElement: HTMLElement | undefined;
let filter: RecollectionFilter = "all";
let mood = "";
let seenIds: string[] = [];
let selectionKey = "";
let visibleCount = 6;
let memories: Memory[] = [];
let signedUrlsByPath = new Map<string, string>();
let loading = true;
let signingPhotos = false;
let photoRequestVersion = 0;
let errorMessage = "";
let loadedSpaceId: string | null = null;
let signedPathsKey = "";
let randomMemoryId: string | null = null;
let refreshInFlight = false;
let refreshPending = false;
let destroyed = false;

$: context = $authState;
$: localToday = getLocalToday();
$: onThisDayMemories = getLastYearTodayMemories(memories, localToday);
$: moods = [...new Set(memories.flatMap(memoryMoods))];
$: filteredMemories = filterRecollections(memories, filter, mood);
$: nextSelectionKey = JSON.stringify([filter, mood, filteredMemories.map(memory => memory.id)]);
$: if (nextSelectionKey !== selectionKey) { selectionKey = nextSelectionKey; seenIds = []; visibleCount = 6; const draw = drawRecollection(filteredMemories, null, []); randomMemoryId = draw.id; seenIds = draw.seen; }
$: randomMemory = filteredMemories.find(memory => memory.id === randomMemoryId) ?? null;
$: visiblePhotoPaths = randomMemory?.photos[0]?.storagePath ? [randomMemory.photos[0].storagePath] : [];
$: visiblePhotoPathsKey = visiblePhotoPaths.join("|");
$: if (
	context.status === "authenticated" &&
	context.space?.id &&
	context.space.id !== loadedSpaceId
) {
	void reloadMemoriesPage();
}
$: if (
	active &&
	context.status === "authenticated" &&
	visiblePhotoPathsKey !== signedPathsKey
) {
	void reloadVisiblePhotoSignedUrls(visiblePhotoPaths, visiblePhotoPathsKey);
}

onDestroy(() => { destroyed = true; });

onMount(() => {
	perfNavMark("island mount", { page: "memories" });

	if (
		context.status === "authenticated" &&
		context.space?.id &&
		!loadedSpaceId
	) {
		void reloadMemoriesPage();
	}
	const unsubscribe = subscribeToSpaceChanges();
	return () => {
		unsubscribe?.();
	};
});

function subscribeToSpaceChanges() {
	const initialSignalVersion = get(spaceDataVersion).version;

	return spaceDataVersion.subscribe((signal) => {
		if (signal.version <= initialSignalVersion) return;
		if (signal.spaceId !== context.space?.id) return;
		void refreshMemoriesPageSilently();
	});
}

async function refreshMemoriesPageSilently() {
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
		signedPathsKey = "";
		errorMessage = "";
		if (
			randomMemoryId &&
			!result.memories.some((memory) => memory.id === randomMemoryId)
		) {
			randomMemoryId = null;
		}
	} catch (error) {
		if (import.meta.env.DEV) {
			console.warn("[MEMORIES] silent refresh failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		refreshInFlight = false;
		if (refreshPending && !destroyed) void refreshMemoriesPageSilently();
	}
}

async function reloadMemoriesPage() {
	if (context.status !== "authenticated" || !context.space?.id) return;

	const startedAt = getPerfTime();
	const spaceId = context.space.id;
	loadedSpaceId = spaceId;
	loading = true;
	errorMessage = "";
	signedUrlsByPath = new Map();
	signedPathsKey = "";
	perfNavMark("page query start", { page: "memories" });

	try {
		const result = await loadSpaceData(
			getSupabaseClient(),
			spaceId,
			"timeline",

		);
		memories = result.memories;
		randomMemoryId = null;
		perfNavMark("page query end", {
			page: "memories",
			count: memories.length,
			ms: getPerfDuration(startedAt),
		});
	} catch (error) {
		errorMessage = "回忆暂时无法读取。请稍后重试。";
		if (import.meta.env.DEV) {
			console.warn("[MEMORIES] query failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		loading = false;
		if (refreshPending && !destroyed) void refreshMemoriesPageSilently();
	}
}

async function reloadVisiblePhotoSignedUrls(paths: string[], nextKey: string) {
	const version = ++photoRequestVersion;
	if (paths.length === 0) {
		signingPhotos = false;
		signedUrlsByPath = new Map();
		signedPathsKey = nextKey;
		return;
	}

	const startedAt = getPerfTime();
	signingPhotos = true;
	signedPathsKey = nextKey;
	perfNavMark("signed urls start", {
		page: "memories",
		count: paths.length,
	});

	try {
		const urls = await createMemoryPhotoSignedUrls(
			getSupabaseClient(),
			paths,
		);
		if (destroyed || version !== photoRequestVersion) return;
		signedUrlsByPath = new Map([...signedUrlsByPath, ...urls]);
		perfNavMark("signed urls end", {
			page: "memories",
			count: signedUrlsByPath.size,
			ms: getPerfDuration(startedAt),
		});
	} catch (error) {
		if (import.meta.env.DEV) {
			console.warn("[MEMORIES] signed photos failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		if (version === photoRequestVersion) signingPhotos = false;
	}
}

function getLocalToday() {
	const now = new Date();
	return {
		day: now.getDate(),
		month: now.getMonth() + 1,
		year: now.getFullYear(),
	};
}

function getLastYearTodayMemories(
	items: Memory[],
	today: { day: number; month: number; year: number },
) {
	const targetYear = today.year - 1;

	if (today.month === 2 && today.day === 29) {
		return [];
	}

	return items.filter((memory) => {
		const date = parseMemoryDate(memory.date);
		return (
			date.getFullYear() === targetYear &&
			date.getMonth() + 1 === today.month &&
			date.getDate() === today.day
		);
	});
}

function turnRandomPage() {
 const draw = drawRecollection(filteredMemories, randomMemoryId, seenIds);
 randomMemoryId = draw.id; seenIds = draw.seen;
}
function readLetter(id: string) {
 randomMemoryId = id; seenIds = [...new Set([...seenIds, id])];
 if (letterElement && letterElement.getBoundingClientRect().top < 0) {
   letterElement.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
 }
}
function readAnniversary(id: string) {
 filter = "all"; mood = "";
 const allKey = JSON.stringify(["all", "", memories.map(memory => memory.id)]);
 selectionKey = allKey; seenIds = [id]; randomMemoryId = id; visibleCount = 6;
}
function authorName(userId: string) { return context.space?.members.find(member => member.userId === userId)?.profile?.displayName ?? "成员"; }
function parseMemoryDate(value: string) {
	return new Date(`${value}T00:00:00`);
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		day: "2-digit",
		month: "long",
		year: "numeric",
	}).format(parseMemoryDate(value));
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

function getMemoryMeta(memory: Memory) {
	return [formatDate(memory.date), memory.location].filter(Boolean).join(" · ");
}

function getCoverUrl(memory: Memory) {
	const path = memory.photos[0]?.storagePath;
	if (!path) return null;
	return signedUrlsByPath.get(path) ?? null;
}

</script>

{#if loading}
	<section class="memory-real-state memory-memories-state">
		<h1>正在翻找过去…</h1>
	</section>
{:else if errorMessage}
	<section class="memory-real-state memory-memories-state">
		<h1>回忆暂时无法打开。</h1>
		<span>{errorMessage}</span>
		<button type="button" on:click={reloadMemoriesPage}>再试一次</button>
	</section>
{:else if memories.length === 0}
	<section class="memory-real-empty memory-memories-empty">
		<h1>还没有可以翻看的过去。</h1>
		<span>第一条记忆，会成为这里最早的一页。</span>
		<a href="/">记录今天</a>
	</section>
{:else}
  <section class="recollection-room" aria-label="我们的旧信匣">
    {#if onThisDayMemories.length > 0}
      <div class="recollection-anniversary"><span>去年今日，留过这些话</span>{#each onThisDayMemories as memory}<button type="button" on:click={() => readAnniversary(memory.id)}>{getMemorySummary(memory)} ↗</button>{/each}</div>
    {/if}
    <div class="recollection-filters">
      <div><span>今天，想重读哪一种？</span><div class="recollection-filter-buttons" aria-label="回忆类型">
        <button type="button" aria-pressed={filter === "all"} class:is-active={filter === "all"} on:click={() => { filter = "all"; }}>所有旧信 <small>{memories.length}</small></button>
        <button type="button" aria-pressed={filter === "both"} class:is-active={filter === "both"} on:click={() => { filter = "both"; }}>两人都写过 <small>{filterRecollections(memories, "both", "").length}</small></button>
        <button type="button" aria-pressed={filter === "photos"} class:is-active={filter === "photos"} on:click={() => { filter = "photos"; }}>夹着照片的 <small>{filterRecollections(memories, "photos", "").length}</small></button>
      </div></div>
      {#if moods.length > 0}<label class="recollection-mood"><span>按当时的心情</span><select bind:value={mood}><option value="">所有心情</option>{#each moods as label}<option value={label}>{label}</option>{/each}</select></label>{/if}
    </div>
    {#if randomMemory}
      <div class="recollection-desk">
        <article bind:this={letterElement} class="recollection-letter" data-memory-id={randomMemory.id}>
          <div class="recollection-letter__top"><span>DEAR US / 写给那时的我们</span><time datetime={randomMemory.date}>{formatDate(randomMemory.date)}</time></div>
          {#key randomMemory.id}
            <div class="recollection-letter__body">
              <p class="recollection-letter__salutation">还记得这一天吗，</p>
              <h2>{randomMemory.title || "那天，我们这样记得。"}</h2>
              <div class="recollection-voices">
                {#each context.space?.members ?? [] as member, index (member.userId)}
                  {@const perspective = randomMemory.perspectives.find(item => item.userId === member.userId)}
                  <section class:recollection-voice--other={index % 2 === 1}>
                    <header><span class="recollection-initial" aria-hidden="true">{(member.profile?.displayName ?? "我").slice(0, 1)}</span><h3>{member.profile?.displayName ?? "成员"}<small>那天写下</small></h3>{#if perspective?.mood}<em>{perspective.mood}</em>{/if}</header>
                    {#if perspective?.content}<blockquote>{perspective.content}</blockquote>{:else}<p class="recollection-unwritten">这一页，还没留下{member.userId === context.user?.id ? "你的" : "对方的"}文字。</p>{#if member.userId === context.user?.id}<a href={getMemoryDetailHref(randomMemory.id)}>补写我的视角 ↗</a>{/if}{/if}
                  </section>
                {/each}
              </div>
              <div class="recollection-letter__signoff"><span>有些话，重读时才知道珍贵。</span><span>—— 那时的我们</span></div>
            </div>
          {/key}
          <footer><span>{randomMemory.location || "一个平常的日子"}{randomMemory.weather ? ` · ${randomMemory.weather}` : ""}</span><a href={getMemoryDetailHref(randomMemory.id)}>读完整的这一天 ↗</a></footer>
        </article>
        <aside class="recollection-box">
          <div class="recollection-draw">
            <span class="recollection-draw__label">THE MEMORY BOX</span>
            <div class="recollection-envelope" aria-hidden="true"><span>致 · 我们</span><i>W</i></div>
            <h2>把那一天，<br />再读一遍。</h2>
            <p>{filteredMemories.length > 1 ? `这里收着 ${filteredMemories.length} 段符合选择的回忆。抽一封，看看那时的我们。` : "这次选择里只有这一封。慢慢写，信匣也会慢慢装满。"}</p>
            <button type="button" on:click={turnRandomPage} disabled={filteredMemories.length <= 1}><span aria-hidden="true">↻</span> 再抽一封</button>
            <small aria-live="polite">这一轮已翻开 {Math.min(seenIds.length, filteredMemories.length)} / {filteredMemories.length} 封</small>
          </div>
          {#if randomMemory.photos.length > 0 && active}
            <figure class="recollection-enclosure">
              {#key randomMemory.photos[0].storagePath}
                <MemoryCover path={randomMemory.photos[0].storagePath} url={getCoverUrl(randomMemory)} signing={signingPhotos} alt={randomMemory.photos[0].alt ?? "夹在旧信里的照片"} />
              {/key}
              <figcaption><span>夹在信里的照片</span><a href={getMemoryDetailHref(randomMemory.id)}>共 {randomMemory.photos.length} 张 ↗</a></figcaption>
            </figure>
          {:else if !randomMemory.photos.length}<div class="recollection-word-note"><span aria-hidden="true">“</span><p>没有照片也没关系，<br />文字记得那一天。</p></div>{/if}
        </aside>
      </div>
      <section class="recollection-index" aria-label="选择一封旧信">
        <header><div><p>WORDS WE LEFT BEHIND</p><h2>还有这些话，值得再读</h2></div><span>{filteredMemories.length} 段回忆</span></header>
        <div class="recollection-index__list">
          {#each filteredMemories.slice(0, visibleCount) as memory (memory.id)}
            <button type="button" class:is-active={randomMemory.id === memory.id} aria-pressed={randomMemory.id === memory.id} on:click={() => readLetter(memory.id)}>
              <time datetime={memory.date}>{formatDate(memory.date)}</time><strong>{memory.perspectives.find(item => item.content.trim())?.content || memory.title || memory.note || "一段还没写完的记忆"}</strong><span>{memory.perspectives.map(item => authorName(item.userId)).join(" / ") || "等待写下视角"}</span><i aria-hidden="true">{randomMemory.id === memory.id ? "正在读" : "打开 ↑"}</i>
            </button>
          {/each}
        </div>
        {#if visibleCount < filteredMemories.length}<button class="recollection-more" type="button" on:click={() => { visibleCount += 6; }}>再展开几封旧信</button>{/if}
      </section>
    {:else}
      <div class="recollection-no-match"><span aria-hidden="true">✉</span><h2>这一格，还没有放进旧信。</h2><p>换一种心情，或打开全部回忆看看。</p><button type="button" on:click={() => { filter = "all"; mood = ""; }}>查看所有旧信</button></div>
    {/if}
  </section>
{/if}
