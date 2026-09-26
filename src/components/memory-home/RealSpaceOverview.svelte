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
import { perfNavMark } from "@/lib/memory/perf-nav";
import { loadSpaceData } from "@/lib/memory/real-memory";
import { spaceDataVersion } from "@/lib/realtime/invalidation";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Memory } from "@/types/memory";

let memories: Memory[] = [];
let loading = true;
let errorMessage = "";
let loadedSpaceId: string | null = null;
let refreshInFlight = false;
let refreshPending = false;
let destroyed = false;

$: context = $authState;
$: members =
	context.status === "authenticated" ? (context.space?.members ?? []) : [];
$: photoCount = memories.reduce(
	(total, memory) => total + memory.photos.length,
	0,
);
$: locationCount = new Set(
	memories.map((memory) => memory.location).filter(Boolean),
).size;
$: coordinateCount = memories.filter((memory) => memory.coordinates).length;
$: if (
	context.status === "authenticated" &&
	context.space?.id &&
	context.space.id !== loadedSpaceId
) {
	void reloadSpaceOverview();
}

onDestroy(() => { destroyed = true; });

onMount(() => {
	perfNavMark("island mount", { page: "space" });
	if (
		context.status === "authenticated" &&
		context.space?.id &&
		!loadedSpaceId
	) {
		void reloadSpaceOverview();
	}
	return subscribeToSpaceChanges();
});

function subscribeToSpaceChanges() {
	const initialSignalVersion = get(spaceDataVersion).version;

	return spaceDataVersion.subscribe((signal) => {
		if (signal.version <= initialSignalVersion) return;
		if (signal.spaceId !== context.space?.id) return;
		void refreshSpaceOverviewSilently();
	});
}

async function refreshSpaceOverviewSilently() {
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
			console.warn("[SPACE] silent refresh failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		refreshInFlight = false;
		if (refreshPending && !destroyed) void refreshSpaceOverviewSilently();
	}
}

async function reloadSpaceOverview() {
	if (context.status !== "authenticated" || !context.space?.id) return;

	const startedAt = getPerfTime();
	const spaceId = context.space.id;
	loadedSpaceId = spaceId;
	loading = true;
	errorMessage = "";
	perfNavMark("page query start", { page: "space" });

	try {
		const result = await loadSpaceData(
			getSupabaseClient(),
			spaceId,
			"timeline",

		);
		memories = result.memories;
		perfNavMark("page query end", {
			page: "space",
			count: memories.length,
			ms: getPerfDuration(startedAt),
		});
	} catch (error) {
		errorMessage = "我们的空间暂时无法读取。请稍后重试。";
		if (import.meta.env.DEV) {
			console.warn("[SPACE] overview query failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		loading = false;
		if (refreshPending && !destroyed) void refreshSpaceOverviewSilently();
	}
}

function getInitial(name: string | null | undefined) {
	return name?.trim().slice(0, 1).toUpperCase() || "·";
}

function getMemberColor(index: number) {
	return index % 2 === 0 ? "sage" : "blue";
}
</script>

{#if loading}
	<section class="memory-real-state memory-space-state">
		<h1>正在整理我们的空间…</h1>
	</section>
{:else if errorMessage}
	<section class="memory-real-state memory-space-state">
		<h1>我们的空间暂时无法打开。</h1>
		<span>{errorMessage}</span>
		<button type="button" on:click={reloadSpaceOverview}>再试一次</button>
	</section>
{:else}
	<section class="memory-space-portrait memory-space-portrait--real">
		<div class="memory-space-portrait__people">
			{#each members as member, index (member.userId)}
				<article
					class={`memory-space-person memory-space-person--${
						context.user?.id === member.userId ? "sage" : "blue"
					}`}
				>
					<span
						class={`memory-avatar memory-avatar--${getMemberColor(index)} memory-avatar--medium`}
						title={member.profile?.displayName ?? "成员"}
					>
						<span aria-hidden="true">{getInitial(member.profile?.displayName)}</span>
					</span>
					<h2>{member.profile?.displayName ?? "成员"}</h2>
					<span>
						{context.user?.id === member.userId
							? "你的视角和照片，都收在这里。"
							: "对方的视角和照片，也收在这里。"}
					</span>
				</article>
			{/each}
		</div>
		<div class="memory-space-portrait__archive">
			<p>我们的空间</p>
			<h2>{context.space?.name ?? "我们"}</h2>
			<span>这里收藏着我们共同写下的记忆、照片与去过的地点。</span>
		</div>
	</section>

	<section class="memory-space-stats" aria-label="共同档案概览">
		<div><strong>{memories.length}</strong><span>共同记忆</span></div>
		<div><strong>{photoCount}</strong><span>收藏的照片</span></div>
		<div><strong>{locationCount}</strong><span>去过的地点</span></div>
		<div><strong>{coordinateCount}</strong><span>地图上亮起的日子</span></div>
	</section>

	<section class="memory-space-notes">
		<header>
			<p>关于这里</p>
			<h2>我们的小小空间</h2>
		</header>
		<div>
			<article>
				<span>01</span>
				<h3>我们一起记录</h3>
				<p>每一段记忆里，都留着两个人各自的眼睛、语气和忘不掉的细节。</p>
			</article>
			<article>
				<span>02</span>
				<h3>照片只属于我们</h3>
				<p>这些照片安静地待在我们的空间里，只有我们两个人能翻开。</p>
			</article>
			<article>
				<span>03</span>
				<h3>地点慢慢连成地图</h3>
				<p>留下过坐标的日子，会在我们的地图上一点一点亮起来。</p>
			</article>
		</div>
		<footer>
			<a href="/timeline/">翻阅时间轴</a>
			<a href="/memories/">打开回忆</a>
		</footer>
	</section>
{/if}

<style>
	.memory-space-state {
		min-height: min(420px, 56vh);
	}

	.memory-space-portrait__archive {
		display: grid;
		align-content: center;
		min-height: 330px;
		padding: 2rem;
		border: 1px solid var(--memory-line);
		border-radius: 10px;
		background:
			linear-gradient(135deg, rgba(249, 247, 242, 0.82), rgba(233, 227, 216, 0.76)),
			radial-gradient(circle at 20% 20%, rgba(169, 181, 167, 0.28), transparent 34%);
	}

	.memory-space-portrait__archive p {
		margin: 0 0 0.7rem;
		color: var(--memory-terracotta);
		font-size: var(--memory-eyebrow);
		letter-spacing: var(--memory-eyebrow-ls);
	}

	.memory-space-portrait__archive h2 {
		margin: 0;
		font: 400 clamp(2rem, 4vw, 3.2rem) / 1 var(--memory-serif);
	}

	.memory-space-portrait__archive span {
		display: block;
		max-width: 24rem;
		margin-top: 1rem;
		color: var(--memory-muted);
		font-size: 0.74rem;
		line-height: 1.75;
	}
</style>
