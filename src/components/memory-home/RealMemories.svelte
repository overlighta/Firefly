<script lang="ts">
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

let memories: Memory[] = [];
let signedUrlsByPath = new Map<string, string>();
let loading = true;
let signingPhotos = false;
let photoRequestVersion = 0;
let errorMessage = "";
let loadedSpaceId: string | null = null;
let signedPathsKey = "";
let visibleMemoriesKey = "";
let randomMemoryId: string | null = null;
let refreshInFlight = false;
let refreshPending = false;
let destroyed = false;

$: context = $authState;
$: localToday = getLocalToday();
$: onThisDayMemories = getLastYearTodayMemories(memories, localToday);
$: currentMonthMemories = getCurrentMonthMemories(memories, localToday).slice(
	0,
	8,
);
$: randomMemory = randomMemoryId
	? memories.find((memory) => memory.id === randomMemoryId)
	: null;
$: visibleMemories = getVisibleMemories(
	onThisDayMemories,
	currentMonthMemories,
	randomMemory,
);
$: visibleMemoriesKey = logVisibleMemoryCount(
	visibleMemories.length,
	visibleMemoriesKey,
);
$: visiblePhotoPaths = getVisiblePhotoPaths(visibleMemories);
$: visiblePhotoPathsKey = visiblePhotoPaths.join("|");
$: if (
	context.status === "authenticated" &&
	context.space?.id &&
	context.space.id !== loadedSpaceId
) {
	void reloadMemoriesPage();
}
$: if (
	context.status === "authenticated" &&
	visiblePhotoPathsKey &&
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
			randomMemoryId = pickRandomMemoryId(result.memories, null);
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
		randomMemoryId = pickRandomMemoryId(result.memories, null);
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

function getCurrentMonthMemories(items: Memory[], today: { month: number }) {
	return items.filter(
		(memory) => parseMemoryDate(memory.date).getMonth() + 1 === today.month,
	);
}

function getVisibleMemories(
	onThisDay: Memory[],
	monthItems: Memory[],
	random: Memory | null | undefined,
) {
	const map = new Map<string, Memory>();

	for (const memory of [...onThisDay, ...monthItems]) {
		map.set(memory.id, memory);
	}

	if (random) {
		map.set(random.id, random);
	}

	return [...map.values()];
}

function logVisibleMemoryCount(count: number, previousKey: string) {
	const nextKey = String(count);

	if (import.meta.env.DEV && nextKey !== previousKey) {
		perfDebug("memories visible count", { count });
	}

	return nextKey;
}

function getVisiblePhotoPaths(items: Memory[]) {
	return items
		.map((memory) => memory.photos[0]?.storagePath)
		.filter((path): path is string => Boolean(path));
}

function pickRandomMemoryId(items: Memory[], currentId: string | null) {
	if (items.length === 0) return null;
	if (items.length === 1) return items[0].id;

	const candidates = currentId
		? items.filter((memory) => memory.id !== currentId)
		: items;
	const index = Math.floor(Math.random() * candidates.length);
	return candidates[index]?.id ?? items[0].id;
}

function turnRandomPage() {
	randomMemoryId = pickRandomMemoryId(memories, randomMemoryId);
}

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

function getMonthTitle(month: number) {
	return `${new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(
		new Date(2026, month - 1, 1),
	)}里的我们`;
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

function getPerspectiveStatus(memory: Memory) {
	return (context.space?.members ?? []).map((member) => ({
		hasPerspective: memory.perspectives.some(
			(perspective) => perspective.userId === member.userId,
		),
		label: member.profile?.displayName ?? "成员",
		userId: member.userId,
	}));
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
	<div class="memory-real-archive" aria-busy={signingPhotos}>
		<section class="memory-archive-feature">
			<header>
				<h2>去年今日</h2>
			</header>
			{#if onThisDayMemories.length === 0}
				<p class="memory-archive-module-empty">去年的今天，还没有留下记录。</p>
			{:else}
				<div class="memory-archive-feature__grid">
					{#each onThisDayMemories as memory}
						{@render MemoryPreview(memory, getCoverUrl(memory))}
					{/each}
				</div>
			{/if}
		</section>

		<section class="memory-archive-feature">
			<header>
				<h2>{getMonthTitle(localToday.month)}</h2>
			</header>
			{#if currentMonthMemories.length === 0}
				<p class="memory-archive-module-empty">这个月，还没有可以翻看的记录。</p>
			{:else}
				<div class="memory-archive-grid memory-archive-grid--real">
					{#each currentMonthMemories as memory}
						{@render MemoryPreview(memory, getCoverUrl(memory), true)}
					{/each}
				</div>
			{/if}
		</section>

		<section class="memory-archive-feature memory-archive-random">
			<header>
				<div>
					<h2>随机翻到一页</h2>
				</div>
				<button type="button" on:click={turnRandomPage} disabled={memories.length <= 1}>
					再翻一页
				</button>
			</header>
			{#if randomMemory}
				{@render MemoryPreview(randomMemory, getCoverUrl(randomMemory), false, true)}
			{/if}
		</section>
	</div>
{/if}

{#snippet MemoryPreview(memory: Memory, coverUrl: string | null, compact = false, wide = false)}
	<article
		class:memory-real-card--compact={compact}
		class:memory-real-card--wide={wide}
		class="memory-real-card"
		data-memory-id={memory.id}
	>
		{#key memory.photos[0]?.storagePath ?? memory.id}
			<MemoryCover path={memory.photos[0]?.storagePath ?? null} url={coverUrl} signing={signingPhotos} alt={memory.title ?? memory.location ?? "生活照片"} />
		{/key}
		<div class="memory-real-card__body">
			<p>{getMemoryMeta(memory)}</p>
			<h3>{getMemorySummary(memory)}</h3>
			<footer>
				<div class="memory-real-card__perspectives">
					{#each getPerspectiveStatus(memory) as item}
						<span
							class:is-complete={item.hasPerspective}
							title={`${item.hasPerspective ? "已记录" : "未记录"} · ${item.label}`}
						>
							<span aria-hidden="true">{item.hasPerspective ? "●" : "○"}</span
							><span class="memory-sr-only">{item.hasPerspective ? "已记录" : "未记录"}</span
							>{item.label}
						</span>
					{/each}
				</div>
				<div class="memory-real-card__footer-meta">
					<span>📷 {memory.photos.length}</span>
					<a class="memory-view-detail" href={getMemoryDetailHref(memory.id)}>查看详情 →</a>
				</div>
			</footer>
		</div>
	</article>
{/snippet}

<style>
	.memory-real-card__perspectives .is-complete {
		color: var(--memory-text);
	}

	.memory-real-card__footer-meta .memory-view-detail {
		color: var(--memory-terracotta);
		font-weight: 600;
		text-decoration: none;
	}

	.memory-real-card__footer-meta .memory-view-detail:hover {
		text-decoration: underline;
	}

</style>
