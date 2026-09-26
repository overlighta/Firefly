import type { Database } from "@/types/database";
import { cityCoordinates } from "@/lib/memory/locations";
import type {
	Memory,
	MemoryPhoto,
	Perspective,
	Space,
	SpaceMember,
	UserProfile,
} from "@/types/memory";

type PublicTables = Database["public"]["Tables"];
type ProfileRow = PublicTables["profiles"]["Row"];
type SpaceRow = PublicTables["spaces"]["Row"];
type SpaceMemberRow = PublicTables["space_members"]["Row"];
type MemoryRow = PublicTables["memories"]["Row"];
type PerspectiveRow = PublicTables["perspectives"]["Row"];
type MemoryPhotoRow = PublicTables["memory_photos"]["Row"];

export type SpaceMemberRecord = SpaceMemberRow & {
	profile?: ProfileRow | null;
	profiles?: ProfileRow | null;
};

export type SpaceRecord = SpaceRow & {
	space_members?: SpaceMemberRecord[] | null;
};

export type PerspectiveRecord = PerspectiveRow & {
	profile?: ProfileRow | null;
	profiles?: ProfileRow | null;
};

export type MemoryPhotoRecord = MemoryPhotoRow & {
	signed_url?: string | null;
	alt?: string | null;
};

export type MemoryRecord = MemoryRow & {
	memory_photos?: MemoryPhotoRecord[] | null;
	perspectives?: PerspectiveRecord[] | null;
};

function getJoinedProfile<
	T extends { profile?: ProfileRow | null; profiles?: ProfileRow | null },
>(record: T): ProfileRow | null {
	return record.profile ?? record.profiles ?? null;
}

export function mapProfile(row: ProfileRow): UserProfile {
	return {
		avatarUrl: row.avatar_url,
		createdAt: row.created_at,
		displayName: row.display_name,
		id: row.id,
		themeColor: row.theme_color,
		updatedAt: row.updated_at,
	};
}

export function mapSpaceMember(row: SpaceMemberRecord): SpaceMember {
	const profile = getJoinedProfile(row);

	return {
		joinedAt: row.joined_at,
		profile: profile ? mapProfile(profile) : null,
		spaceId: row.space_id,
		userId: row.user_id,
	};
}

export function mapSpace(row: SpaceRecord): Space {
	return {
		createdAt: row.created_at,
		createdBy: row.created_by,
		id: row.id,
		members: (row.space_members ?? []).map(mapSpaceMember),
		name: row.name,
		updatedAt: row.updated_at,
	};
}

export function mapPerspective(row: PerspectiveRecord): Perspective {
	const profile = getJoinedProfile(row);

	return {
		content: row.content,
		createdAt: row.created_at,
		id: row.id,
		memoryId: row.memory_id,
		mood: row.mood,
		profile: profile ? mapProfile(profile) : null,
		updatedAt: row.updated_at,
		userId: row.user_id,
	};
}

export function mapMemoryPhoto(row: MemoryPhotoRecord): MemoryPhoto {
	return {
		alt: row.alt ?? null,
		createdAt: row.created_at,
		height: row.height,
		id: row.id,
		memoryId: row.memory_id,
		signedUrl: row.signed_url ?? null,
		sortOrder: row.sort_order,
		storagePath: row.storage_path,
		uploadedBy: row.uploaded_by,
		width: row.width,
	};
}

export function mapMemory(row: MemoryRecord): Memory {
	const hasCoordinates =
		typeof row.latitude === "number" && typeof row.longitude === "number";
	const hasSong = Boolean(row.song_title);

	return {
		coordinates: hasCoordinates
			? {
					latitude: row.latitude as number,
					longitude: row.longitude as number,
				}
			: cityCoordinates(row.location),
		createdAt: row.created_at,
		createdBy: row.created_by,
		date: row.memory_date,
		id: row.id,
		location: row.location,
		note: row.note,
		perspectives: (row.perspectives ?? []).map(mapPerspective),
		photos: (row.memory_photos ?? []).map(mapMemoryPhoto),
		song: hasSong
			? {
					artist: row.song_artist,
					title: row.song_title as string,
				}
			: null,
		spaceId: row.space_id,
		temperature: row.temperature,
		title: row.title,
		updatedAt: row.updated_at,
		weather: row.weather,
	};
}
