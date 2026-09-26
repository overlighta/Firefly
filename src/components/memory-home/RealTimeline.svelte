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

let memories: Memory[] = [];
let loading = true;
let errorMessage = "";
let loadedSpaceId: string | null = null;
let refreshInFlight = false;
let refreshPending = false;
let destroyed = false;

$: context = $authState;
$: groups = groupTimelineMemories(memories);
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

function groupTimelineMemories(items: Memory[]): YearGroup[] {
	const years = new Map<string, Map<string, Memory[]>>();

	for (const memory of items) {
		const date = parseMemoryDate(memory.date);
		const year = String(date.getFullYear());
		const month = String(date.getMonth() + 1).padStart(2, "0");

		if (!years.has(year)) {
			years.set(year, new Map());
		}

		const months = years.get(year);
		if (!months) continue;

		const list = months.get(month) ?? [];
		list.push(memory);
		months.set(month, list);
	}

	return [...years.entries()].map(([year, months]) => ({
		months: [...months.entries()].map(([month, monthMemories]) => ({
			key: `${year}-${month}`,
			label: getMonthLabel(Number(month)),
			memories: monthMemories,
		})),
		storyCount: [...months.values()].reduce(
			(total, monthMemories) => total + monthMemories.length,
			0,
		),
		year,
	}));
}

function parseMemoryDate(value: string) {
	return new Date(`${value}T00:00:00`);
}

function getMonthLabel(month: number) {
	return new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(
		new Date(2026, month - 1, 1),
	);
}

function getDay(value: string) {
	return `${String(parseMemoryDate(value).getDate()).padStart(2, "0")}日`;
}

function getMonth(value: string) {
	return new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(
		parseMemoryDate(value),
	);
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
	return [memory.location, memory.weather ?? memory.temperature]
		.filter(Boolean)
		.join(" · ");
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
	<section class="memory-real-state memory-timeline-state">
		<h1>正在翻开时间轴…</h1>
	</section>
{:else if errorMessage}
	<section class="memory-real-state memory-timeline-state">
		<h1>时间轴暂时无法打开。</h1>
		<span>{errorMessage}</span>
		<button type="button" on:click={reloadTimeline}>再试一次</button>
	</section>
{:else if memories.length === 0}
	<section class="memory-real-empty memory-timeline-empty">
		<h1>这里还没有留下时间的痕迹。</h1>
		<span>写下第一条记忆后，它会出现在两个人共同的时间轴里。</span>
		<a href="/">记录今天</a>
	</section>
{:else}
	<div class="memory-year-filter" aria-label="年份筛选">
		{#each groups as group, index}
			<a class:is-active={index === 0} href={`#year-${group.year}`}>{group.year}</a>
		{/each}
	</div>
	<div class="memory-timeline">
		{#each groups as group}
			<section id={`year-${group.year}`} class="memory-timeline-year">
				<header>
					<span>{group.year}</span>
					<p>{group.storyCount} 段记忆</p>
				</header>
				<div>
					{#each group.months as month}
						<section class="memory-timeline-month" aria-label={month.label}>
							<header>{month.label}</header>
							{#each month.memories as memory}
								<article class="memory-timeline-item" data-memory-id={memory.id}>
									<time datetime={memory.date}>
										<strong>{getDay(memory.date)}</strong>
										<span>{getMonth(memory.date)}</span>
									</time>
									<div class="memory-timeline-item__line"><i></i></div>
									<div class="memory-timeline-item__body memory-timeline-item__body--real">
										<div class="memory-timeline-item__copy">
											<p>{getMemoryMeta(memory) || "未记录地点"}</p>
											<h2>{getMemorySummary(memory)}</h2>
											<footer>
												<div class="memory-timeline-perspectives">
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
												<span>📷 {memory.photos.length} 张</span>
												<a class="memory-view-detail" href={getMemoryDetailHref(memory.id)}>查看详情 →</a>
											</footer>
										</div>
									</div>
								</article>
							{/each}
						</section>
					{/each}
				</div>
			</section>
		{/each}
	</div>
{/if}

<style>
	.memory-timeline-state,
	.memory-timeline-empty {
		min-height: min(420px, 56vh);
	}

	.memory-timeline-empty a {
		border: 1px solid var(--memory-text);
		border-radius: 999px;
		padding: 0.78rem 1.1rem;
		background: var(--memory-text);
		color: var(--memory-surface);
		text-decoration: none;
	}

	.memory-timeline-month + .memory-timeline-month {
		margin-top: 1.8rem;
	}

	.memory-timeline-month > header {
		margin: 0 0 1rem 0.9rem;
		color: var(--memory-terracotta);
		font: 600 0.58rem var(--memory-serif);
		letter-spacing: 0.16em;
	}

	.memory-timeline-item__body--real {
		grid-template-columns: minmax(0, 1fr);
	}

	.memory-timeline-perspectives {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.7rem;
	}

	.memory-timeline-perspectives span {
		color: var(--memory-muted);
		font-size: 0.62rem;
		white-space: nowrap;
	}

	.memory-timeline-perspectives .is-complete {
		color: var(--memory-text);
	}
	.memory-timeline-item__copy footer .memory-view-detail {
		margin-left: auto;
		color: var(--memory-terracotta);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}

	.memory-timeline-item__copy footer .memory-view-detail:hover {
		text-decoration: underline;
	}

</style>
