import { getErrorCode } from "@/lib/auth/debug";
import { loadMemoryQuery, currentCacheEpoch, getCachedSignedUrls, setCachedSignedUrls } from "@/lib/memory/cache";
import { mapMemory, type MemoryRecord } from "@/lib/memory/mapper";
import { notifySpaceChanged } from "@/lib/realtime/invalidation";
import type { BrowserSupabaseClient } from "@/lib/supabase/client";
import type { Memory } from "@/types/memory";

interface LoadSpaceMemoriesResult {
	memories: Memory[];
}

interface CreateMemoryInput {
	requestId?: string;
	spaceId: string;
	userId: string;
	text: string;
	location: string | null;
	date: string;
	title: string | null;
}

interface SavePerspectiveInput {
	memoryId: string;
	userId: string;
	content: string;
	mood: string | null;
	perspectiveId?: string | null;
	spaceId: string;
}

interface UploadMemoryPhotosInput {
	files: File[];
	memoryId: string;
	spaceId: string;
	userId: string;
}

interface DeleteMemoryPhotoInput {
	id: string;
	storagePath: string;
	userId: string;
}

type PhotoPipelineStage =
	| "PHOTO_COMPRESSION_FAILED"
	| "PHOTO_STORAGE_UPLOAD_FAILED"
	| "PHOTO_METADATA_INSERT_FAILED"
	| "PHOTO_STORAGE_DELETE_FAILED"
	| "PHOTO_RELOAD_FAILED"
	| "PHOTO_SIGNED_URL_FAILED";

type MemoryRow = {
	id: string;
	space_id: string;
	memory_date: string;
	title: string | null;
	location: string | null;
	latitude: number | null;
	longitude: number | null;
	weather: string | null;
	temperature: string | null;
	song_title: string | null;
	song_artist: string | null;
	note: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
};

type PerspectiveRow = {
	id: string;
	memory_id: string;
	user_id: string;
	content: string;
	mood: string | null;
	created_at: string;
	updated_at: string;
};

type MemoryPhotoRow = {
	id: string;
	memory_id: string;
	uploaded_by: string | null;
	storage_path: string;
	width: number | null;
	height: number | null;
	sort_order: number;
	created_at: string;
	alt?: string | null;
	signed_url?: string | null;
};

const MEMORY_IMAGES_BUCKET = "memory-images";
const SIGNED_URL_TTL_SECONDS = 60 * 30;
const STORAGE_REMOVE_BATCH_SIZE = 1000;
const MAX_IMAGE_EDGE = 1920;
const JPEG_QUALITY = 0.8;
const WEBP_QUALITY = 0.78;

export class PhotoPipelineError extends Error {
	readonly cause: unknown;
	readonly stage: PhotoPipelineStage;

	constructor(stage: PhotoPipelineStage, cause: unknown) {
		super(getSafeErrorMessage(cause) ?? stage);
		this.name = "PhotoPipelineError";
		this.cause = cause;
		this.stage = stage;
	}
}

export class MemoryMutationError extends Error {
	readonly code: "MEMORY_UPDATE_DENIED" | "MEMORY_DELETE_DENIED";

	constructor(
		code: "MEMORY_UPDATE_DENIED" | "MEMORY_DELETE_DENIED",
		message: string,
	) {
		super(message);
		this.name = "MemoryMutationError";
		this.code = code;
	}
}

class StorageCleanupError extends Error {
	readonly code = "STORAGE_CLEANUP_INCOMPLETE";
	readonly expectedCount: number;
	readonly removedCount: number;

	constructor(expectedCount: number, removedCount: number) {
		super("Storage cleanup did not remove every expected object.");
		this.name = "StorageCleanupError";
		this.expectedCount = expectedCount;
		this.removedCount = removedCount;
	}
}

function getRemovedStorageObjectNames(data: unknown): Set<string> {
	if (!Array.isArray(data)) return new Set();

	return new Set(
		data.flatMap((item) => {
			if (typeof item !== "object" || item === null || !("name" in item)) {
				return [];
			}

			return typeof item.name === "string" ? [item.name] : [];
		}),
	);
}

interface StorageRemovalResult {
	failedCount: number;
	firstError: unknown | null;
	removedCount: number;
}

async function removeStorageObjects(
	supabase: BrowserSupabaseClient,
	paths: string[],
): Promise<StorageRemovalResult> {
	let failedCount = 0;
	let firstError: unknown | null = null;
	let removedCount = 0;

	for (
		let offset = 0;
		offset < paths.length;
		offset += STORAGE_REMOVE_BATCH_SIZE
	) {
		const batch = paths.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE);
		const response = await supabase.storage
			.from(MEMORY_IMAGES_BUCKET)
			.remove(batch);

		if (response.error) {
			firstError ??= response.error;
			failedCount += batch.length;
			continue;
		}

		const removedNames = getRemovedStorageObjectNames(response.data);
		const batchRemovedCount = batch.filter((path) =>
			removedNames.has(path),
		).length;
		removedCount += batchRemovedCount;
		failedCount += batch.length - batchRemovedCount;
	}

	return { failedCount, firstError, removedCount };
}

const MEMORY_FIELDS = "id,space_id,memory_date,title,location,latitude,longitude,weather,temperature,song_title,song_artist,note,created_by,created_at,updated_at";
const PAGE_SIZE = 200;

export async function loadSpaceTimelineMemories(supabase: BrowserSupabaseClient, spaceId: string): Promise<LoadSpaceMemoriesResult> {
  const memories: Memory[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await supabase.from("memories")
      .select(MEMORY_FIELDS + ",perspectives(id,memory_id,user_id,content,mood,created_at,updated_at),memory_photos(id,memory_id,uploaded_by,storage_path,width,height,sort_order,created_at)")
      .eq("space_id", spaceId).order("memory_date", {ascending: false})
      .order("created_at", {ascending: false}).order("id", {ascending: false})
      .range(offset, offset + PAGE_SIZE - 1);
    if (response.error) throw response.error;
    const rows = (response.data ?? []) as unknown as MemoryRecord[];
    for (const row of rows) {
      row.memory_photos?.sort((a,b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
      row.perspectives?.sort((a,b) => a.created_at.localeCompare(b.created_at));
      memories.push(mapMemory(row));
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return { memories };
}

export async function loadSpaceMemories(supabase: BrowserSupabaseClient, spaceId: string): Promise<LoadSpaceMemoriesResult> {
  const data = await loadSpaceData(supabase, spaceId, "timeline");
  // The home page renders five memories; do not sign/download every photo in the archive.
  const visible = data.memories.slice(0, 5);
  const urls = await createMemoryPhotoSignedUrls(supabase, visible.flatMap(m => m.photos.map(p => p.storagePath)));
  return { memories: visible.map(m => ({ ...m, photos: m.photos.map(p => ({ ...p, signedUrl: urls.get(p.storagePath) ?? null })) })) };
}

export type SpaceDataKind = "home" | "timeline";
export function loadSpaceData(supabase: BrowserSupabaseClient, spaceId: string, kind: SpaceDataKind): Promise<LoadSpaceMemoriesResult> {
  return loadMemoryQuery(spaceId + ":" + kind, () => kind === "home" ? loadSpaceMemories(supabase, spaceId) : loadSpaceTimelineMemories(supabase, spaceId));
}

export async function createMemoryPhotoSignedUrls(
	supabase: BrowserSupabaseClient,
	storagePaths: string[],
): Promise<Map<string, string>> {
	const paths = [...new Set(storagePaths.filter(Boolean))];

	if (paths.length === 0) {
		return new Map();
	}

	const startedEpoch = currentCacheEpoch();
	const { urls, missing } = getCachedSignedUrls(paths);

	if (missing.length > 0) {
		photoDebug("visible signed urls request", {
			paths: paths.map(getStoragePathDebug),
			requestedCount: paths.length,
			cachedCount: urls.size,
			missingCount: missing.length,
		});

		const response = await supabase.storage
			.from(MEMORY_IMAGES_BUCKET)
			.createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);

		if (response.error) {
			photoDebugWarn(
				"visible signed urls failed",
				getSafeErrorDetails(response.error),
			);
			throw response.error;
		}

		const fresh = new Map<string, string>();

		for (const item of response.data ?? []) {
			if (item.path && item.signedUrl && !getSignedUrlItemError(item)) {
				fresh.set(item.path, item.signedUrl);
			}
		}

		setCachedSignedUrls(fresh, startedEpoch);

		for (const [path, signedUrl] of fresh) {
			urls.set(path, signedUrl);
		}

		photoDebug("visible signed urls response", {
			returnedCount: response.data?.length ?? 0,
			freshCount: fresh.size,
			totalCount: urls.size,
		});
	} else {
		photoDebug("visible signed urls cache hit", { cachedCount: urls.size });
	}

	return urls;
}

export async function createMemoryWithPerspective(supabase: BrowserSupabaseClient, input: CreateMemoryInput): Promise<Memory> {
  if (!input.text.trim()) throw new Error("请先写下一句记录。");
  const memoryId = input.requestId ?? crypto.randomUUID();
  const atomic = await supabase.rpc("create_memory_with_perspective", {
    p_id: memoryId, p_space_id: input.spaceId, p_date: input.date,
    p_title: input.title, p_location: input.location, p_content: input.text.trim(),
  });
  if (!atomic.error) {
    notifySpaceChanged(input.spaceId);
    return mapMemory(atomic.data as unknown as MemoryRecord);
  }
  // Existing deployments remain usable until the atomic RPC migration is applied.
  if (atomic.error.code !== "PGRST202") throw atomic.error;
  const existing = await supabase.from("memories").select(MEMORY_FIELDS).eq("id", memoryId).maybeSingle();
  if (existing.error) throw existing.error;
  let memory = existing.data as MemoryRow | null;
  if (memory && (memory.created_by !== input.userId || memory.space_id !== input.spaceId)) throw new Error("这条记录不属于当前账号。");
  if (!memory) {
    const created = await supabase.from("memories").insert({id: memoryId, created_by: input.userId, space_id: input.spaceId, memory_date: input.date, title: input.title, location: input.location}).select(MEMORY_FIELDS).single();
    if (created.error) throw created.error;
    memory = created.data as MemoryRow;
  }
  // The stable request ID recovers from a lost response without creating a second Memory.
  const perspective = await supabase.from("perspectives").upsert({memory_id: memoryId, user_id: input.userId, content: input.text.trim()}, {onConflict: "memory_id,user_id"}).select("id,memory_id,user_id,content,mood,created_at,updated_at").single();
  if (perspective.error) {
    // Only compensate when we can prove the write did not commit. Network uncertainty keeps
    // the stable ID so the same dialog can recover on retry without deleting saved content.
    const confirmed = await supabase.from("perspectives").select("id").eq("memory_id", memoryId).eq("user_id", input.userId).maybeSingle();
    if (!confirmed.error && !confirmed.data) await supabase.from("memories").delete().eq("id", memoryId).eq("created_by", input.userId);
    notifySpaceChanged(input.spaceId);
    throw perspective.error;
  }
  notifySpaceChanged(input.spaceId);
  return mapMemory({...memory, perspectives:[perspective.data], memory_photos:[]});
}

export async function saveCurrentUserPerspective(
	supabase: BrowserSupabaseClient,
	input: SavePerspectiveInput,
): Promise<void> {
	const normalizedContent = input.content.trim();
	const normalizedMood = input.mood?.trim() || null;

	if (!normalizedContent) {
		throw new Error("Perspective content is required.");
	}

	if (input.perspectiveId) {
		const response = await supabase
			.from("perspectives")
			.update({
				content: normalizedContent,
				mood: normalizedMood,
			})
			.eq("id", input.perspectiveId)
			.eq("memory_id", input.memoryId)
			.eq("user_id", input.userId)
			.select("id")
			.single();

		if (response.error) {
			throw response.error;
		}

		notifySpaceChanged(input.spaceId);
		return;
	}

	const response = await supabase
		.from("perspectives")
		.insert({
			content: normalizedContent,
			memory_id: input.memoryId,
			mood: normalizedMood,
			user_id: input.userId,
		})
		.select("id")
		.single();

	if (response.error) {
		throw response.error;
	}

	notifySpaceChanged(input.spaceId);
}

export async function uploadMemoryPhotos(
	supabase: BrowserSupabaseClient,
	input: UploadMemoryPhotosInput,
): Promise<void> {
	if (input.files.length === 0) return;

	for (const [index, file] of input.files.entries()) {
		photoDebug("compression start", {
			originalSize: file.size,
			originalType: file.type || null,
		});

		let compressed: Awaited<ReturnType<typeof compressImageForUpload>>;
		try {
			const startedAt = getPhotoTime();
			compressed = await compressImageForUpload(file);
			photoDebug("compression success", {
				compressedSize: compressed.file.size,
				compressedType: compressed.file.type || null,
				durationMs: getPhotoDuration(startedAt),
				height: compressed.height,
				width: compressed.width,
			});
		} catch (error) {
			photoDebugWarn("compression failed", getSafeErrorDetails(error));
			throw new PhotoPipelineError("PHOTO_COMPRESSION_FAILED", error);
		}

		const storagePath = buildStoragePath({
			file,
			index,
			memoryId: input.memoryId,
			spaceId: input.spaceId,
			userId: input.userId,
			uploadedFile: compressed.file,
		});

		photoDebug("storage upload start", {
			bucket: MEMORY_IMAGES_BUCKET,
			contentType: compressed.file.type || file.type || null,
			fileSize: compressed.file.size,
			storagePath: getStoragePathDebug(storagePath),
		});

		try {
			const startedAt = getPhotoTime();
			const uploadResponse = await supabase.storage
				.from(MEMORY_IMAGES_BUCKET)
				.upload(storagePath, compressed.file, {
					cacheControl: "3600",
					contentType: compressed.file.type || file.type,
					upsert: false,
				});

			if (uploadResponse.error) {
				photoDebugWarn(
					"storage upload failed",
					getSafeErrorDetails(uploadResponse.error, {
						storagePath: getStoragePathDebug(storagePath),
					}),
				);
				throw uploadResponse.error;
			}

			photoDebug("storage upload success", {
				durationMs: getPhotoDuration(startedAt),
				storagePath: getStoragePathDebug(storagePath),
			});
		} catch (error) {
			throw new PhotoPipelineError("PHOTO_STORAGE_UPLOAD_FAILED", error);
		}

		photoDebug("metadata insert start", {
			hasMemoryId: Boolean(input.memoryId),
			hasStoragePath: Boolean(storagePath),
			hasUploadedBy: Boolean(input.userId),
			sortOrder: index,
		});

		const insertResponse = await supabase
			.from("memory_photos")
			.insert({
				height: compressed.height,
				memory_id: input.memoryId,
				sort_order: index,
				storage_path: storagePath,
				uploaded_by: input.userId,
				width: compressed.width,
			})
			.select("id")
			.single();

		if (insertResponse.error) {
			photoDebugWarn(
				"metadata insert failed",
				getSafeErrorDetails(insertResponse.error),
			);
			photoDebug("cleanup orphan start", {
				storagePath: getStoragePathDebug(storagePath),
			});
			const cleanupResult = await removeStorageObjects(supabase, [storagePath]);

			if (cleanupResult.failedCount !== 0) {
				photoDebugWarn(
					"cleanup orphan failed",
					getSafeErrorDetails(
						cleanupResult.firstError ??
							new StorageCleanupError(1, cleanupResult.removedCount),
						{
							storagePath: getStoragePathDebug(storagePath),
						},
					),
				);
			} else {
				photoDebug("cleanup orphan success", {
					storagePath: getStoragePathDebug(storagePath),
				});
			}

			throw new PhotoPipelineError(
				"PHOTO_METADATA_INSERT_FAILED",
				insertResponse.error,
			);
		}

		photoDebug("metadata insert success", {
			hasPhotoId: Boolean(insertResponse.data.id),
		});
	}

	notifySpaceChanged(input.spaceId);
}

export async function deleteOwnMemoryPhoto(supabase: BrowserSupabaseClient, input: DeleteMemoryPhotoInput): Promise<void> {
  // Check ownership and the recorded path before touching Storage, also on retries.
  const photo = await supabase.from("memory_photos").select("id,storage_path,uploaded_by").eq("id", input.id).eq("uploaded_by", input.userId).maybeSingle();
  if (photo.error) throw photo.error;
  if (!photo.data) return;
  if (photo.data.storage_path !== input.storagePath || input.storagePath.split("/")[2] !== input.userId) throw new Error("照片归属与路径不一致。");
  const result = await removeStorageObjects(supabase, [input.storagePath]);
  if (result.firstError) throw result.firstError;
  if (result.failedCount) {
    const separator = input.storagePath.lastIndexOf("/");
    const directory = input.storagePath.slice(0, separator);
    const filename = input.storagePath.slice(separator + 1);
    const check = await supabase.storage.from(MEMORY_IMAGES_BUCKET).list(directory, {search: filename, limit: 100});
    if (check.error) throw check.error;
    // Empty remove is success only after confirming the object is already gone.
    if (check.data.some(item => item.name === filename)) throw new PhotoPipelineError("PHOTO_STORAGE_DELETE_FAILED", new StorageCleanupError(1,0));
  }
  const deleted = await supabase.from("memory_photos").delete().eq("id", input.id).eq("uploaded_by", input.userId);
  if (deleted.error) throw deleted.error;
  notifySpaceChanged(input.storagePath.split("/")[0] ?? "");
}

export interface LoadMemoryDetailResult {
	memory: Memory | null;
}

export async function loadMemoryDetail(
	supabase: BrowserSupabaseClient,
	memoryId: string,
): Promise<LoadMemoryDetailResult> {
	const memoriesResponse = await supabase
		.from("memories")
		.select(
			"id,space_id,memory_date,title,location,latitude,longitude,weather,temperature,song_title,song_artist,note,created_by,created_at,updated_at",
		)
		.eq("id", memoryId)
		.single();

	if (memoriesResponse.error) {
		if (getErrorCode(memoriesResponse.error) === "PGRST116") {
			return { memory: null };
		}

		throw memoriesResponse.error;
	}

	const memoryRow = memoriesResponse.data as MemoryRow;
	const [perspectivesResponse, photosResponse] = await Promise.all([
		supabase
			.from("perspectives")
			.select("id,memory_id,user_id,content,mood,created_at,updated_at")
			.eq("memory_id", memoryId)
			.order("created_at", { ascending: true }),
		supabase
			.from("memory_photos")
			.select(
				"id,memory_id,uploaded_by,storage_path,width,height,sort_order,created_at",
			)
			.eq("memory_id", memoryId)
			.order("sort_order", { ascending: true }),
	]);

	if (perspectivesResponse.error) {
		throw perspectivesResponse.error;
	}

	if (photosResponse.error) {
		throw photosResponse.error;
	}

	const photoRows = (photosResponse.data ?? []) as MemoryPhotoRow[];
	let signedUrlsByPath: Map<string, string>;
	try {
		const startedAt = getPhotoTime();
		signedUrlsByPath = await createSignedUrlsByPath(supabase, photoRows);
		photoDebug("detail signed urls success", {
			count: signedUrlsByPath.size,
			durationMs: getPhotoDuration(startedAt),
		});
	} catch (error) {
		photoDebugWarn("detail signed urls failed", getSafeErrorDetails(error));
		throw new PhotoPipelineError("PHOTO_SIGNED_URL_FAILED", error);
	}

	return {
		memory: mapMemory({
			...memoryRow,
			memory_photos: photoRows.map((photo) => ({
				...photo,
				alt: null,
				signed_url: signedUrlsByPath.get(photo.storage_path) ?? null,
			})),
			perspectives: (perspectivesResponse.data ?? []) as PerspectiveRow[],
		}),
	};
}

/**
 * Phase 8.5 — Memory 详情缓存加载器（内存缓存 + inFlight 去重 + SWR）。
 *
 * - 同一 memoryId 的并发调用共享一次请求。
 * - version 变化（含 Memory DELETE 触发的 realtime）→ 缓存旁路 → 重查，
 *   删除后的详情重新查询返回 PGRST116 → null → not-found（Section 22 语义保留）。
 */
export function loadMemoryDetailCached(supabase: BrowserSupabaseClient, memoryId: string, spaceId: string): Promise<LoadMemoryDetailResult> {
  return loadMemoryQuery(spaceId + ":detail:" + memoryId, () => loadMemoryDetail(supabase, memoryId));
}

export interface UpdateMemorySharedFieldsInput {
	date: string;
	latitude: number | null;
	location: string | null;
	longitude: number | null;
	memoryId: string;
	note: string | null;
	songArtist: string | null;
	songTitle: string | null;
	spaceId: string;
	temperature: string | null;
	title: string | null;
	weather: string | null;
}

export async function updateMemorySharedFields(
	supabase: BrowserSupabaseClient,
	input: UpdateMemorySharedFieldsInput,
): Promise<void> {
	const response = await supabase
		.from("memories")
		.update({
			latitude: input.latitude,
			location: input.location,
			longitude: input.longitude,
			memory_date: input.date,
			note: input.note,
			song_artist: input.songArtist,
			song_title: input.songTitle,
			temperature: input.temperature,
			title: input.title,
			weather: input.weather,
		})
		.eq("id", input.memoryId)
		.select("id");

	if (response.error) {
		throw response.error;
	}

	if ((response.data ?? []).length !== 1) {
		throw new MemoryMutationError(
			"MEMORY_UPDATE_DENIED",
			"这段记忆不存在，或你无权修改。",
		);
	}

	notifySpaceChanged(input.spaceId);
}

export interface DeleteMemoryInput {
	memoryId: string;
	photoPaths: string[];
	spaceId: string;
}

export interface DeleteMemoryResult {
	cleanupFailedPaths: number;
	deleted: boolean;
}

export async function deleteMemory(
	supabase: BrowserSupabaseClient,
	input: DeleteMemoryInput,
): Promise<DeleteMemoryResult> {
	// Include photos uploaded since the detail screen was opened.
	const latestPhotos = await supabase.from("memory_photos").select("storage_path").eq("memory_id", input.memoryId);
	if (latestPhotos.error) throw latestPhotos.error;
	const deleteResponse = await supabase
		.from("memories")
		.delete()
		.eq("id", input.memoryId)
		.select("id");

	if (deleteResponse.error) {
		throw deleteResponse.error;
	}

	if ((deleteResponse.data ?? []).length !== 1) {
		throw new MemoryMutationError(
			"MEMORY_DELETE_DENIED",
			"这条记忆不存在，或你只能删除自己创建的记录。",
		);
	}

	const uniquePaths = [...new Set([...input.photoPaths, ...(latestPhotos.data ?? []).map(photo => photo.storage_path)].filter(Boolean))];
	let cleanupFailedPaths = 0;

	if (uniquePaths.length > 0) {
		const storageResult = await removeStorageObjects(supabase, uniquePaths);

		if (storageResult.failedCount !== 0) {
			cleanupFailedPaths = storageResult.failedCount;
			if (import.meta.env.DEV) {
				// 不打印私有 URL，只记录数量与错误码
				console.warn("[MEMORY] storage cleanup failed", {
					errorCode: storageResult.firstError
						? getSafeErrorProperty(storageResult.firstError, "code")
						: "STORAGE_CLEANUP_INCOMPLETE",
					errorStatus: storageResult.firstError
						? getSafeErrorProperty(storageResult.firstError, "status")
						: null,
					orphanCount: cleanupFailedPaths,
				});
			}
		}
	}

	notifySpaceChanged(input.spaceId);

	return { cleanupFailedPaths, deleted: true };
}

async function createSignedUrlsByPath(
	supabase: BrowserSupabaseClient,
	photos: MemoryPhotoRow[],
): Promise<Map<string, string>> {
	const paths = photos.map((photo) => photo.storage_path);

	if (paths.length === 0) {
		return new Map();
	}

	const startedEpoch = currentCacheEpoch();
	const { urls, missing } = getCachedSignedUrls(paths);

	if (missing.length === 0) {
		photoDebug("signed urls cache hit", { cachedCount: urls.size });
		return urls;
	}

	photoDebug("signed urls request", {
		paths: paths.map(getStoragePathDebug),
		requestedCount: paths.length,
		cachedCount: urls.size,
		missingCount: missing.length,
	});

	const response = await supabase.storage
		.from(MEMORY_IMAGES_BUCKET)
		.createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);

	if (response.error) {
		photoDebugWarn("signed urls failed", getSafeErrorDetails(response.error));
		throw response.error;
	}

	const fresh = new Map<string, string>();
	const results: Record<string, unknown>[] = [];

	for (const item of response.data ?? []) {
		results.push({
			errorCode: getSignedUrlItemError(item)?.code ?? null,
			errorMessage: getSignedUrlItemError(item)?.message ?? null,
			hasError: Boolean(getSignedUrlItemError(item)),
			hasSignedUrl: Boolean(item.signedUrl),
			path: item.path ? getStoragePathDebug(item.path) : null,
			signedUrl: getSignedUrlDebug(item.signedUrl),
		});

		if (item.path && item.signedUrl && !getSignedUrlItemError(item)) {
			fresh.set(item.path, item.signedUrl);
		}
	}

	setCachedSignedUrls(fresh, startedEpoch);

	for (const [path, signedUrl] of fresh) {
		urls.set(path, signedUrl);
	}

	photoDebug("signed urls response", {
		results,
		returnedCount: response.data?.length ?? 0,
		freshCount: fresh.size,
	});

	return urls;
}

async function compressImageForUpload(file: File): Promise<{
	file: File;
	height: number | null;
	width: number | null;
}> {
	if (!file.type.startsWith("image/")) {
		throw new Error("Only image files can be uploaded.");
	}

	if (file.type === "image/heic" || file.type === "image/heif") {
		return { file, height: null, width: null };
	}

	const bitmap = await createImageBitmap(file).catch(() => null);

	if (!bitmap) {
		return { file, height: null, width: null };
	}

	const scale = Math.min(
		1,
		MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height),
	);
	const width = Math.round(bitmap.width * scale);
	const height = Math.round(bitmap.height * scale);

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	const type = file.type === "image/png" ? "image/png" : "image/webp";
	const quality = type === "image/webp" ? WEBP_QUALITY : JPEG_QUALITY;
	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob(resolve, type, quality);
	});

	if (!blob) {
		throw new Error("Canvas compression returned an empty blob.");
	}

	if (blob.size <= 0) {
		throw new Error("Compressed image blob is empty.");
	}

	const extension = type === "image/webp" ? "webp" : "png";
	const compressedFile = new File(
		[blob],
		replaceExtension(file.name, extension),
		{
			lastModified: Date.now(),
			type,
		},
	);

	return { file: compressedFile, height, width };
}

function buildStoragePath(input: {
	file: File;
	index: number;
	memoryId: string;
	spaceId: string;
	uploadedFile: File;
	userId: string;
}) {
	const extension = getFileExtension(input.uploadedFile);
	const filename = `${Date.now()}-${input.index}-${crypto.randomUUID()}.${extension}`;
	const storagePath = `${input.spaceId}/${input.memoryId}/${input.userId}/${filename}`;

	photoDebug("storage path", getStoragePathDebug(storagePath));

	return storagePath;
}

function replaceExtension(filename: string, extension: string) {
	return `${filename.replace(/\.[^.]*$/, "")}.${extension}`;
}

function getFileExtension(file: File) {
	if (file.type === "image/webp") return "webp";
	if (file.type === "image/jpeg") return "jpg";
	if (file.type === "image/png") return "png";
	if (file.type === "image/heic") return "heic";
	if (file.type === "image/heif") return "heif";

	return "bin";
}

function getStoragePathDebug(storagePath: string) {
	const segments = storagePath.split("/");

	return {
		memoryIdPresent: Boolean(segments[1]),
		segments: segments.length,
		spaceIdPresent: Boolean(segments[0]),
		userIdPresent: Boolean(segments[2]),
	};
}

function getSignedUrlDebug(signedUrl: string | null | undefined) {
	if (!signedUrl) {
		return {
			hasQuery: false,
			hasSignedUrl: false,
			pathname: null,
		};
	}

	try {
		const url = new URL(signedUrl);

		return {
			hasQuery: Boolean(url.search),
			hasSignedUrl: true,
			pathname: url.pathname,
		};
	} catch {
		return {
			hasQuery: false,
			hasSignedUrl: true,
			pathname: "invalid-url",
		};
	}
}

function getSignedUrlItemError(item: { error?: unknown }) {
	if (!item.error) return null;

	if (typeof item.error === "string") {
		return {
			code: null,
			message: item.error,
		};
	}

	if (typeof item.error !== "object") return null;

	return {
		code: getSafeErrorProperty(item.error, "code"),
		message: getSafeErrorMessage(item.error),
	};
}

function photoDebug(message: string, details?: Record<string, unknown>): void {
	if (!import.meta.env.DEV) return;

	if (details) {
		console.info(`[PHOTO] ${message}`, details);
		return;
	}

	console.info(`[PHOTO] ${message}`);
}

function photoDebugWarn(
	message: string,
	details?: Record<string, unknown>,
): void {
	if (!import.meta.env.DEV) return;

	if (details) {
		console.warn(`[PHOTO] ${message}`, details);
		return;
	}

	console.warn(`[PHOTO] ${message}`);
}

function getSafeErrorDetails(
	error: unknown,
	extra?: Record<string, unknown>,
): Record<string, unknown> {
	const details: Record<string, unknown> = {
		code: getSafeErrorProperty(error, "code"),
		message: getSafeErrorMessage(error),
		status: getSafeErrorProperty(error, "status"),
	};

	return { ...details, ...extra };
}

function getSafeErrorMessage(error: unknown) {
	if (error instanceof Error) return error.message;
	if (typeof error !== "object" || error === null) return null;
	if (!("message" in error)) return null;

	const message = error.message;
	return typeof message === "string" ? message : null;
}

function getSafeErrorProperty(error: unknown, property: "code" | "status") {
	if (typeof error !== "object" || error === null) return null;
	if (!(property in error)) return null;

	const value = error[property];
	return typeof value === "string" || typeof value === "number" ? value : null;
}

function getPhotoTime(): number {
	if (typeof performance === "undefined") return Date.now();
	return performance.now();
}

function getPhotoDuration(startedAt: number): number {
	return Math.round((getPhotoTime() - startedAt) * 10) / 10;
}
