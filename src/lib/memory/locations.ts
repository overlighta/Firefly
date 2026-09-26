import { cities } from "@/lib/memory/cities";

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s'’]/g, "").replace(/市$/, "");

// Only recognize a whole city name or our explicit city · place format.
// Never guess coordinates from an arbitrary place name such as 南京路.
export function findCity(location: string | null | undefined) {
	const name = normalize((location ?? "").split("·")[0]);
	if (!name) return null;
	return cities.find(city => normalize(city.name) === name || normalize(city.search) === name) ?? null;
}

export function cityCoordinates(location: string | null | undefined) {
	const city = findCity(location);
	return city ? { latitude: city.latitude, longitude: city.longitude } : null;
}

export function searchCities(query: string) {
	const name = normalize(query.split("·")[0]);
	return cities.filter(city => !name || normalize(city.name).includes(name) || normalize(city.search).includes(name)).slice(0, 8);
}
