export interface UserProfile {
	id: string;
	displayName: string;
	avatarUrl: string | null;
	themeColor: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface SpaceMember {
	spaceId: string;
	userId: string;
	joinedAt: string;
	profile: UserProfile | null;
}

export interface Space {
	id: string;
	name: string;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
	members: SpaceMember[];
}

export interface MemoryCoordinates {
	latitude: number;
	longitude: number;
}

export interface MemorySong {
	title: string;
	artist: string | null;
}

export interface MemoryPhoto {
	id: string;
	memoryId: string;
	uploadedBy: string | null;
	storagePath: string;
	width: number | null;
	height: number | null;
	sortOrder: number;
	createdAt: string;
	signedUrl: string | null;
	alt: string | null;
}

export interface Perspective {
	id: string;
	memoryId: string;
	userId: string;
	content: string;
	mood: string | null;
	createdAt: string;
	updatedAt: string;
	profile: UserProfile | null;
}

export interface Memory {
	id: string;
	spaceId: string;
	date: string;
	title: string | null;
	location: string | null;
	coordinates: MemoryCoordinates | null;
	weather: string | null;
	temperature: string | null;
	song: MemorySong | null;
	note: string | null;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
	perspectives: Perspective[];
	photos: MemoryPhoto[];
}
