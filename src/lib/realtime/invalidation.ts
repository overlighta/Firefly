import { writable } from "svelte/store";

/**
 * 全局轻量 invalidation 总线。
 *
 * Realtime runtime 只负责在这里发出「数据变了」的信号（{ version, spaceId }），
 * 页面组件订阅后调用各自的现有 loader 重新查询。
 * 信号里不携带任何行内容 —— Realtime payload 永远不会进入这里。
 */
export interface SpaceChangeSignal {
	version: number;
	spaceId: string;
}

const initialSignal: SpaceChangeSignal = {
	spaceId: "",
	version: 0,
};

export const spaceDataVersion = writable<SpaceChangeSignal>(initialSignal);

export function notifySpaceChanged(spaceId: string): void {
	spaceDataVersion.update((signal) => ({
		spaceId,
		version: signal.version + 1,
	}));
}
