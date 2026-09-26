import type { Memory } from "@/types/memory";

export type RecollectionFilter = "all" | "both" | "photos";

export function memoryMoods(memory: Memory): string[] {
	return [...new Set(memory.perspectives.map(item => item.mood?.trim()).filter((mood): mood is string => Boolean(mood)))];
}

export function filterRecollections(items: Memory[], filter: RecollectionFilter, mood: string) {
	return items.filter(memory =>
		(filter !== "both" || new Set(memory.perspectives.map(item => item.userId)).size >= 2) &&
		(filter !== "photos" || memory.photos.length > 0) &&
		(!mood || memoryMoods(memory).includes(mood)));
}

// Read every available letter before starting a new round. Never repeat the
// current letter at a round boundary when another letter is available.
export function drawRecollection(items: Memory[], currentId: string | null, seen: string[], random = Math.random) {
	if (!items.length) return { id: null, seen: [] as string[] };
	const validSeen = seen.filter(id => items.some(item => item.id === id));
	let candidates = items.filter(item => !validSeen.includes(item.id) && item.id !== currentId);
	let nextSeen = validSeen;
	if (!candidates.length) {
		candidates = items.filter(item => item.id !== currentId);
		nextSeen = [];
	}
	const selected = candidates[Math.floor(random() * candidates.length)] ?? items[0];
	return { id: selected.id, seen: [...new Set([...nextSeen, selected.id])] };
}
