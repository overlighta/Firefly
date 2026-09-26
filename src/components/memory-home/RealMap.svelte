<script lang="ts">
import { findCity } from "@/lib/memory/locations";
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

interface PositionedMapGroup {
	key: string;
	latitude: number;
	longitude: number;
	location: string;
	memories: Memory[];
	x: number;
	y: number;
}

let memories: Memory[] = [];
let loading = true;
let errorMessage = "";
let loadedSpaceId: string | null = null;
let selectedGroupKey: string | null = null;
let refreshInFlight = false;
let refreshPending = false;
let destroyed = false;

$: context = $authState;
$: coordinateMemories = memories.filter(hasValidCoordinates);
$: noCoordinateCount = memories.length - coordinateMemories.length;
$: mapGroups = positionMapGroups(groupMapMemories(coordinateMemories));
$: selectedGroup = getSelectedGroup(mapGroups, selectedGroupKey);
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
		const nextCoordinateMemories = result.memories.filter(hasValidCoordinates);
		const nextMapGroups = groupMapMemories(nextCoordinateMemories);
		perfNavMark("page query end", {
			page: "map",
			count: memories.length,
			ms: getPerfDuration(startedAt),
		});
		perfDebug("map marker count", {
			count: nextCoordinateMemories.length,
			groupCount: nextMapGroups.length,
			noCoordinateCount: result.memories.length - nextCoordinateMemories.length,
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

function hasValidCoordinates(memory: Memory) {
	const latitude = memory.coordinates?.latitude;
	const longitude = memory.coordinates?.longitude;

	return (
		typeof latitude === "number" &&
		typeof longitude === "number" &&
		Number.isFinite(latitude) &&
		Number.isFinite(longitude) &&
		latitude >= -90 &&
		latitude <= 90 &&
		longitude >= -180 &&
		longitude <= 180
	);
}

function groupMapMemories(items: Memory[]) {
	const groups = new Map<string, Omit<PositionedMapGroup, "x" | "y">>();

	for (const memory of items) {
		if (!memory.coordinates) continue;

		const latitude = memory.coordinates.latitude;
		const longitude = memory.coordinates.longitude;
		const city = findCity(memory.location);
		const atCityCenter = city && Math.abs(city.latitude - latitude) < 0.00001 && Math.abs(city.longitude - longitude) < 0.00001;
		const key = `${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
		const existing = groups.get(key);

		if (existing) {
			existing.memories.push(memory);
			continue;
		}

		groups.set(key, {
			key,
			latitude,
			location: atCityCenter ? city.name : memory.location ?? "未命名地点",
			longitude,
			memories: [memory],
		});
	}

	return [...groups.values()];
}

function positionMapGroups(
	groups: Omit<PositionedMapGroup, "x" | "y">[],
): PositionedMapGroup[] {
	if (groups.length === 0) return [];

	if (groups.length === 1) {
		return groups.map((group) => ({ ...group, x: 50, y: 50 }));
	}

	const latitudes = groups.map((group) => group.latitude);
	const longitudes = groups.map((group) => group.longitude);
	const minLatitude = Math.min(...latitudes);
	const maxLatitude = Math.max(...latitudes);
	const minLongitude = Math.min(...longitudes);
	const maxLongitude = Math.max(...longitudes);
	const latitudeRange = maxLatitude - minLatitude || 1;
	const longitudeRange = maxLongitude - minLongitude || 1;
	const padding = 12;
	const scale = 100 - padding * 2;

	return groups.map((group) => ({
		...group,
		x: padding + ((group.longitude - minLongitude) / longitudeRange) * scale,
		y: padding + (1 - (group.latitude - minLatitude) / latitudeRange) * scale,
	}));
}

function getSelectedGroup(
	groups: PositionedMapGroup[],
	key: string | null,
): PositionedMapGroup | null {
	if (groups.length === 0) return null;
	return groups.find((group) => group.key === key) ?? groups[0];
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
	<section class="memory-real-state memory-map-state">
		<h1>正在展开地图…</h1>
	</section>
{:else if errorMessage}
	<section class="memory-real-state memory-map-state">
		<h1>地图暂时无法打开。</h1>
		<span>{errorMessage}</span>
		<button type="button" on:click={reloadMap}>再试一次</button>
	</section>
{:else}
	<section class="memory-map-layout memory-map-layout--real">
		<div
			class:is-empty={mapGroups.length === 0}
			class="memory-map-canvas memory-map-canvas--real"
			aria-label="我们的足迹示意图"
		>
			<div class="memory-map-canvas__watermark">OUR<br />PLACES</div>
			<p class="journal-map-note">足迹示意 · 城市标记为大致位置</p>
			{#if mapGroups.length === 0}
				<div class="memory-map-empty">
					<h2>这些记忆还没有留下地图位置。</h2>
					<span>编辑一条记录，选择它发生的城市，就能点亮第一处足迹。</span>
				</div>
			{:else}
				{#each mapGroups as group}
					<button
						aria-label={`${group.location}：${group.memories.length} 段记忆`}
						class:is-active={selectedGroup?.key === group.key}
						class="memory-map-pin memory-map-pin--real"
						style={`--pin-x:${group.x}%;--pin-y:${group.y}%`}
						type="button"
						on:click={() => selectGroup(group.key)}
					>
						<i></i>
						<span>
							{group.location}
							{#if group.memories.length > 1}
								<small>{group.memories.length}</small>
							{/if}
						</span>
					</button>
				{/each}
			{/if}
			<div class="memory-map-legend">
				<span><i></i>{coordinateMemories.length} 段有位置的记忆</span>
				<span>{noCoordinateCount} 段还没有地图位置</span>
			</div>
		</div>

		<aside class="memory-place-list memory-place-list--real">
			<header>
				<p>{selectedGroup ? selectedGroup.location : "地图上的地点"}</p>
				<span>{mapGroups.length} 个地点</span>
			</header>
			{#if selectedGroup}
				<section class="memory-map-selected">
					<p>
						{selectedGroup.memories.length > 1
							? `这里有 ${selectedGroup.memories.length} 段记忆`
							: "这里有一段记忆"}
					</p>
				</section>
				{#each selectedGroup.memories as memory}
					<article data-memory-id={memory.id}>
						<div class="memory-place-list__date">
							<time datetime={memory.date}>{formatDate(memory.date)}</time>
							<span>📷 {memory.photos.length} 张</span>
						</div>
						<div>
							<h2>{memory.location ?? "未命名地点"}</h2>
							<p>{getMemorySummary(memory)}</p>
							<footer>
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
								<a class="memory-view-detail" href={getMemoryDetailHref(memory.id)}>查看详情 →</a>
							</footer>
						</div>
					</article>
				{/each}
			{:else if memories.length === 0}
				<div class="memory-map-aside-empty">
					<h2>还没有可以标记的记忆。</h2>
					<p>写下第一条记忆后，地点会先安静地记下来。</p>
				</div>
			{:else}
				<div class="memory-map-aside-empty">
					<h2>有些记忆还没有保存地图位置。</h2>
					<p>已经有 {memories.length} 段记忆。在记录中选择城市，就能把它们放上地图。</p>
				</div>
			{/if}
		</aside>
	</section>
{/if}

<style>
	.memory-map-state {
		min-height: min(420px, 56vh);
	}

	.memory-map-layout--real {
		align-items: start;
	}

	.memory-map-canvas--real {
		isolation: isolate;
	}

	.memory-map-canvas--real.is-empty {
		background-color: #e9e3d8;
	}

	.memory-map-pin--real {
		border: 0;
		background: transparent;
		cursor: pointer;
	}

	.memory-map-pin--real small {
		display: inline-grid;
		place-items: center;
		min-width: 1rem;
		height: 1rem;
		margin-left: 0.35rem;
		border-radius: 999px;
		background: var(--memory-terracotta);
		color: var(--memory-surface);
		font-size: 0.52rem;
	}

	.memory-map-empty {
		position: absolute;
		z-index: 2;
		inset: 0;
		display: grid;
		align-content: center;
		justify-items: center;
		padding: 2rem;
		text-align: center;
	}

	.memory-map-empty > span {
		margin: 0 0 0.7rem;
		color: var(--memory-terracotta);
		font-size: 0.56rem;
		letter-spacing: 0.16em;
	}

	.memory-map-empty h2 {
		max-width: 25rem;
		margin: 0;
		font: 400 clamp(1.55rem, 2.4vw, 2.2rem) / 1.25 var(--memory-serif);
	}

	.memory-map-empty span {
		display: block;
		max-width: 22rem;
		margin-top: 0.8rem;
		color: var(--memory-muted);
		font-size: 0.72rem;
		line-height: 1.7;
	}

	.memory-place-list--real article {
		grid-template-columns: minmax(76px, 0.28fr) minmax(0, 1fr);
	}

	.memory-place-list__date {
		display: grid;
		gap: 0.45rem;
		align-content: center;
	}

	.memory-place-list__date span {
		color: var(--memory-muted);
		font-size: 0.58rem;
	}

	.memory-map-selected {
		padding: 1rem 0 0.25rem;
		border-bottom: 1px solid var(--memory-line);
	}

	.memory-map-selected p {
		margin: 0;
		color: var(--memory-muted);
		font: 400 1.05rem/1.55 var(--memory-serif);
	}

	.memory-place-list--real footer {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.65rem;
		margin-top: 0.65rem;
		color: var(--memory-muted);
		font-size: 0.58rem;
	}

	.memory-place-list--real footer .is-complete {
		color: var(--memory-text);
	}

	.memory-map-aside-empty {
		padding: 2.2rem 0;
		border-bottom: 1px solid var(--memory-line);
	}

	.memory-map-aside-empty h2 {
		margin: 0 0 0.55rem;
		font: 400 1.25rem/1.35 var(--memory-serif);
	}

	.memory-map-aside-empty p {
		margin: 0;
		color: var(--memory-muted);
		font-size: 0.7rem;
		line-height: 1.7;
	}
	.memory-place-list--real footer .memory-view-detail {
		margin-left: auto;
		color: var(--memory-terracotta);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}

	.memory-place-list--real footer .memory-view-detail:hover {
		text-decoration: underline;
	}

</style>
