import type { RealtimeChannel } from "@supabase/supabase-js";

import { notifySpaceChanged } from "@/lib/realtime/invalidation";
import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * 挂在 Persistent AuthRuntime 下的 Space-level Realtime Runtime。
 *
 * 整个站点只保留一个 channel（realtime-space-{spaceId}）。
 * Home / Timeline / Memories / Map 各自创建 channel 是被禁止的。
 *
 * 职责边界：
 * - Realtime 事件只作为 invalidation 信号（经过 250ms debounce 合并后 bump 一次总线）。
 * - 不读取 payload 的 new/old，不携带任何行内容进入 UI。
 * - 网络重连成功后（channel 从异常状态回到 SUBSCRIBED）主动做一次 catch-up，
 *   让当前页面重新 query 最新状态，避免断网期间的事件永久丢失。
 */

const REALTIME_DEBOUNCE_MS = 250;

const TABLE_EVENTS = [
	{ table: "memories" },
	{ table: "perspectives" },
	{ table: "memory_photos" },
] as const;

let activeChannel: RealtimeChannel | null = null;
let activeSpaceId: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSpaceId: string | null = null;
let reconnectCatchUp = false;

export function startSpaceRealtime(spaceId: string): void {
	if (activeSpaceId === spaceId && activeChannel) return;

	stopSpaceRealtime();
	activeSpaceId = spaceId;

	const supabase = getSupabaseClient();
	const channel = supabase.channel(`realtime-space-${spaceId}`);

	for (const { table } of TABLE_EVENTS) {
		channel.on(
			"postgres_changes",
			{ event: "*", schema: "public", table },
			(payload) => {
				handleRealtimeEvent(spaceId, payload.table, payload.eventType);
			},
		);
	}

	activeChannel = channel;
	realtimeDebug("channel subscribe", { spaceIdPresent: Boolean(spaceId) });

	channel.subscribe((status) => {
		if (activeChannel !== channel) return;
		if (status === "SUBSCRIBED") {
			realtimeDebug("channel ready", {});
			notifySpaceChanged(spaceId);
			if (reconnectCatchUp) {
				reconnectCatchUp = false;
				realtimeDebug("channel resubscribed catch-up", {});

			}
		} else if (
			status === "CHANNEL_ERROR" ||
			status === "TIMED_OUT" ||
			status === "CLOSED"
		) {
			reconnectCatchUp = true;
			realtimeDebug("channel state", { status });
		}
	});
}

function handleRealtimeEvent(
	spaceId: string,
	table: string,
	eventType: string,
): void {
	realtimeDebug("event received", { event: eventType, table });
	scheduleSignal(spaceId);
}

function scheduleSignal(spaceId: string): void {
	pendingSpaceId = spaceId;

	if (debounceTimer) return;

	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		const nextSpaceId = pendingSpaceId;
		pendingSpaceId = null;

		if (nextSpaceId) {
			realtimeDebug("invalidation signal", {
				spaceIdPresent: Boolean(nextSpaceId),
			});
			notifySpaceChanged(nextSpaceId);
		}
	}, REALTIME_DEBOUNCE_MS);
}

export function stopSpaceRealtime(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
		pendingSpaceId = null;
	}

	if (activeChannel) {
		realtimeDebug("channel cleanup", {});
		void getSupabaseClient().removeChannel(activeChannel);
		activeChannel = null;
	}

	reconnectCatchUp = false;
	activeSpaceId = null;
}

function realtimeDebug(
	message: string,
	details?: Record<string, unknown>,
): void {
	if (!import.meta.env.DEV) return;

	if (details) {
		console.info(`[REALTIME] ${message}`, details);
		return;
	}

	console.info(`[REALTIME] ${message}`);
}
