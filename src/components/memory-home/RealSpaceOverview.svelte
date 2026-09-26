<script lang="ts">
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
import { perfNavMark } from "@/lib/memory/perf-nav";
import { loadSpaceData } from "@/lib/memory/real-memory";
import { spaceDataVersion } from "@/lib/realtime/invalidation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { togetherSummary, writtenBy, monthDays } from "@/lib/memory/together";
import { getMemoryDetailHref } from "@/lib/memory/detail-href";
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
let selectedAuthor = "";
let selectedMonth = "";
let selectedDate = "";
let dayLimit = 3;
let waitingLimit = 3;
$: summary = togetherSummary(memories, members.map(member => member.userId), context.user?.id ?? "");
$: if (!members.some(member => member.userId === selectedAuthor)) selectedAuthor = members[0]?.userId ?? "";
$: latestWritten = summary.memories.find(memory => writtenBy(memory, selectedAuthor));
$: if (!summary.months.includes(selectedMonth)) selectedMonth = summary.months[0] ?? "";
$: monthMemories = summary.memories.filter(memory => memory.date.startsWith(selectedMonth));
$: byDay = groupDays(monthMemories);
function groupDays(items: Memory[]) {
  const days = new Map<string, Memory[]>();
  for (const memory of items) {
    const day = days.get(memory.date);
    if (day) day.push(memory);
    else days.set(memory.date, [memory]);
  }
  return days;
}
$: if (!byDay.has(selectedDate)) { selectedDate = monthMemories[0]?.date ?? ""; dayLimit = 3; }
$: dayMemories = byDay.get(selectedDate) ?? [];
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

function name(id: string) {
  return members.find(member => member.userId === id)?.profile?.displayName ?? "成员";
}
function dateLabel(date: string) { return date.replace(/-/g, "."); }
function title(memory: Memory) { return memory.title?.trim() || memory.note?.trim() || memory.perspectives.find(item => item.content.trim())?.content.trim() || "那一天的记录"; }
function dayDescription(date: string) {
  const items = byDay.get(date) ?? [];
  const authors = members.filter(member => items.some(item => writtenBy(item, member.userId))).map(member => name(member.userId));
  return `${date}，${items.length}段记录${authors.length ? `，${authors.join("、")}写过文字` : ""}`;
}
</script>

{#if loading}
  <section class="memory-real-state memory-space-state"><h1>正在整理我们的空间…</h1></section>
{:else if errorMessage}
  <section class="memory-real-state memory-space-state"><h1>我们的空间暂时无法打开。</h1><span>{errorMessage}</span><button type="button" on:click={reloadSpaceOverview}>再试一次</button></section>
{:else}
  <div class="together" aria-label="我们的共同扉页">
    <section class="together-cover">
      <div class="together-cover__main">
        <p class="together-eyebrow">THE TWO OF US <span>共同执笔 / {context.space?.name || "我们"}</span></p>
        <h1>故事的主角，<br />一直是我们<span>。</span></h1>
        <div class="together-signatures" aria-label="这本手记的记录者">
          {#each members as member, index (member.userId)}
            {#if index > 0}<span class="together-ampersand" aria-hidden="true">&</span>{/if}
            <div><span>执笔人 {String(index + 1).padStart(2, "0")}</span><strong>{name(member.userId)}</strong><small>{member.userId === context.user?.id ? "这一边，是你" : "另一边，也是生活"}</small></div>
          {/each}
        </div>
        <p class="together-cover__line">同一天，可以有两种心情。<br />写在一起，就成了只属于我们的故事。</p>
      </div>
      <div class="together-colophon">
        <span class="together-colophon__label">这本手记，已经收藏</span>
        <p><strong>{summary.days.length}</strong><span>个有记录的日子</span></p>
        <div class="together-colophon__rule" aria-hidden="true">✳</div>
        {#if summary.first}<span>最早的一页</span><a href={getMemoryDetailHref(summary.first.id)}>{dateLabel(summary.first.date)} <span>↗</span></a>{:else}<span>第一张空白页</span><a href="/">留给今天 ↗</a>{/if}
        <small>把普通的日子，认真收好。</small>
      </div>
    </section>

    <div class="together-ribbon"><span><strong>{memories.length}</strong> 段共同记忆</span><i aria-hidden="true">·</i><span><strong>{summary.shared.length}</strong> 段留下两种笔迹</span><a href="/">今天，也写一点 ↗</a></div>

    <div class="together-body">
      <section class="together-handwriting">
        <header class="together-section-title"><span>01 / 两种笔迹</span><h2>换一个视角，读读我们。</h2><p>各自最近一段记录，放在同一页。</p></header>
        <div class="together-author-switch" aria-label="选择谁的笔迹">{#each members as member, index}<button type="button" aria-pressed={selectedAuthor === member.userId} on:click={() => selectedAuthor = member.userId}><i class:ink-blue={index % 2 === 1} aria-hidden="true"></i>{name(member.userId)}</button>{/each}</div>
        <div class="together-quote" class:ink-blue={members.findIndex(member => member.userId === selectedAuthor) % 2 === 1} aria-live="polite">
          <span class="together-quote__mark" aria-hidden="true">“</span>
          {#if latestWritten}
            <blockquote>{latestWritten.perspectives.find(item => item.userId === selectedAuthor && item.content.trim())?.content}</blockquote>
            <footer><span>{name(selectedAuthor)}<small>{dateLabel(latestWritten.date)}</small></span><a href={getMemoryDetailHref(latestWritten.id)}>读这一天 ↗</a></footer>
          {:else}<blockquote class="together-quote__empty">这一页，还在等{name(selectedAuthor)}的笔迹。</blockquote><footer><span>不必写得很长，一句话也好。</span><a href="/">去记录 ↗</a></footer>{/if}
        </div>
      </section>

      <section class="together-calendar-section">
        <header class="together-section-title"><span>02 / 共同日历</span><h2>落笔的日子，会亮起来。</h2><p>每个小点，都是一个人留下的文字。</p></header>
        {#if summary.months.length}
          <div class="together-calendar">
            <div class="together-calendar__toolbar"><label for="together-month">翻到这个月</label><select id="together-month" bind:value={selectedMonth}>{#each summary.months as month}<option value={month}>{month.slice(0, 4)}年{Number(month.slice(5))}月</option>{/each}</select></div>
            <div class="together-weekdays" aria-hidden="true">{#each ["一", "二", "三", "四", "五", "六", "日"] as day}<span>{day}</span>{/each}</div>
            <div class="together-days" aria-label="选择有记录的日期">
              {#each monthDays(selectedMonth) as date}
                {#if date}
                  <button type="button" class:has-entry={byDay.has(date)} aria-pressed={selectedDate === date} aria-label={dayDescription(date)} disabled={!byDay.has(date)} on:click={() => { selectedDate = date; dayLimit = 3; }}><span>{Number(date.slice(8))}</span><span class="together-days__dots" aria-hidden="true">{#each members as member, index}<i class:is-written={(byDay.get(date) ?? []).some(item => writtenBy(item, member.userId))} class:ink-blue={index % 2 === 1}></i>{/each}</span></button>
                {:else}<span></span>{/if}
              {/each}
            </div>
            <div class="together-legend">{#each members as member, index}<span><i class:ink-blue={index % 2 === 1}></i>{name(member.userId)}</span>{/each}</div>
            <div class="together-day-stories" aria-live="polite"><p>{dateLabel(selectedDate)} <span>{dayMemories.length} 段记录</span></p>{#each dayMemories.slice(0, dayLimit) as memory}<a href={getMemoryDetailHref(memory.id)}><span>{title(memory)}</span><small>翻开 ↗</small></a>{/each}{#if dayMemories.length > dayLimit}<button type="button" on:click={() => dayLimit += 5}>展开这天的其他记录</button>{/if}</div>
          </div>
        {:else}<div class="together-calendar-empty"><span aria-hidden="true">✳</span><h3>第一盏小灯，还没亮起。</h3><p>写下一段日常，这里就会留下它的日期。</p><a href="/">记下第一天 ↗</a></div>{/if}
      </section>

      <section class="together-unfinished">
        <div><span class="together-eyebrow">03 / 留给你的一页</span><h2>{summary.waiting.length ? "那一天，你还记得什么？" : "下一段，继续一起写。"}</h2><p>{summary.waiting.length ? `有 ${summary.waiting.length} 段记录，对方留下了文字，还没有你的视角。` : memories.length ? "目前没有等你补写的记录。不急，生活还在继续。" : "从一件小事开始，把两个人的视角留在同一天。"}</p></div>
        <div class="together-unfinished__list">{#each summary.waiting.slice(0, waitingLimit) as memory}<a href={getMemoryDetailHref(memory.id)}><time datetime={memory.date}>{dateLabel(memory.date)}</time><span>{title(memory)}</span><strong>补上我的视角 ↗</strong></a>{:else}<a class="together-new-page" href="/"><span>今天发生了什么？</span><strong>记下一笔 ↗</strong></a>{/each}{#if summary.waiting.length > waitingLimit}<button type="button" on:click={() => waitingLimit += 5}>再看看其他 {summary.waiting.length - waitingLimit} 段</button>{/if}</div>
      </section>
      <p class="together-closing">不必每天都有大事发生。<span>有你，有我，就是值得留下的一页。</span></p>
    </div>
  </div>
{/if}
