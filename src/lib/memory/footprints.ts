import { findCity } from "@/lib/memory/locations";
import type { Memory, MemoryCoordinates } from "@/types/memory";

export interface Footprint {
	key: string;
	location: string;
	coordinates: MemoryCoordinates | null;
	memories: Memory[];
	pending: boolean;
	x: number;
	y: number;
}

function validCoordinates(value: MemoryCoordinates | null) {
	return value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
		&& Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180 ? value : null;
}

// Group the travel album by named city, not by slightly different saved pins.
// Only the presentation uses the city center; original memories stay untouched.
export function buildFootprints(memories: Memory[]): Footprint[] {
	const groups = new Map<string, Footprint>();
	for (const memory of [...memories].sort((a, b) => b.date.localeCompare(a.date))) {
		const city = findCity(memory.location);
		const location = city?.name ?? memory.location?.trim() ?? "";
		const point = validCoordinates(memory.coordinates);
		const key = city ? `city:${city.name}` : location ? `place:${location}` : point ? `point:${point.latitude}:${point.longitude}` : "pending";
		const coordinates = city ? { latitude: city.latitude, longitude: city.longitude } : point;
		const existing = groups.get(key);
		if (existing) {
			existing.memories.push(memory);
			existing.coordinates ??= coordinates;
		} else {
			groups.set(key, { key, location: location || (point ? "未命名地点" : "待补充地点"), coordinates, pending: key === "pending", memories: [memory], x: 50, y: 50 });
		}
	}
	const result = [...groups.values()].sort((a, b) => Number(a.pending) - Number(b.pending));
	const positioned = result.filter(group => group.coordinates);
	const latitudes = positioned.map(group => group.coordinates!.latitude);
	const longitudes = positioned.map(group => group.coordinates!.longitude);
	const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
	const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
	for (const group of positioned) {
		const point = group.coordinates!;
		group.x = maxLon === minLon ? 50 : 18 + (point.longitude - minLon) / (maxLon - minLon) * 64;
		group.y = maxLat === minLat ? 50 : 24 + (maxLat - point.latitude) / (maxLat - minLat) * 48;
	}
	return result;
}
