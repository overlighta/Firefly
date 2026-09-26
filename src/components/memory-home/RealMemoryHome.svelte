<script lang="ts">
import LocationPicker from "./LocationPicker.svelte";
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
import { getMemoryDetailHref } from "@/lib/memory/detail-href";
import { perfNavMark } from "@/lib/memory/perf-nav";
import { revealPhotoFallback } from "@/lib/memory/photo-fallback";
import {
	createMemoryWithPerspective,
	deleteOwnMemoryPhoto,
	loadSpaceData,
	PhotoPipelineError,
	saveCurrentUserPerspective,
	uploadMemoryPhotos,
} from "@/lib/memory/real-memory";
import { spaceDataVersion } from "@/lib/realtime/invalidation";
import { getSupabaseClient } from "@/lib/supabase/client";
import type {
	Memory,
	MemoryPhoto,
	Perspective,
	UserProfile,
} from "@/types/memory";

interface PhotoPreview {
	id: string;
	name: string;
	size: number;
	url: string;
}

let memories: Memory[] = [];
let loading = true;
let saving = false;
let errorMessage = "";
let saveMessage = "";
let loadedSpaceId: string | null = null;
let refreshInFlight = false;
let refreshPending = false;
let destroyed = false;
let dialog: HTMLDialogElement | null = null;
let perspectiveDialog: HTMLDialogElement | null = null;
let text = "";
let location = "";
let date = getTodayDate();
let title = "";
let createRequestId = crypto.randomUUID();
let perspectiveMemory: Memory | null = null;
let perspectiveText = "";
let perspectiveMood = "";
let perspectiveSaving = false;
let perspectiveError = "";
let photoDialog: HTMLDialogElement | null = null;
let photoInput: HTMLInputElement | null = null;
let photoMemory: Memory | null = null;
let selectedPhotoFiles: File[] = [];
let photoPreviews: PhotoPreview[] = [];
let photoUploading = false;
let photoError = "";
let photoDeleteError = "";
let deletingPhotoId: string | null = null;

$: context = $authState;
$: heroMemory = memories[0] ?? null;
$: recentMemories = memories.slice(1, 5);
$: currentUserPerspective =
	heroMemory && context.user
		? getUserPerspective(heroMemory, context.user.id)
		: null;
$: if (
	context.status === "authenticated" &&
	context.space?.id !== loadedSpaceId
) {
	void reloadMemories();
}

onDestroy(() => { destroyed = true; });

onMount(() => {
	perfNavMark("island mount", { page: "home" });
	if (context.status === "authenticated" && !loadedSpaceId) {
		void reloadMemories();
	}
	return subscribeToSpaceChanges();
});

function subscribeToSpaceChanges() {
	const initialSignalVersion = get(spaceDataVersion).version;

	return spaceDataVersion.subscribe((signal) => {
		if (signal.version <= initialSignalVersion) return;
		if (signal.spaceId !== context.space?.id) return;
		void refreshMemoriesSilently();
	});
}

async function refreshMemoriesSilently() {
	if (destroyed) return;
	if (refreshInFlight || loading) { refreshPending = true; return; }
	refreshPending = false;
	if (context.status !== "authenticated" || !context.space?.id) return;

	refreshInFlight = true;
	try {
		const result = await loadSpaceData(
			getSupabaseClient(),
			context.space.id,
			"home",
		);
		memories = result.memories;
		errorMessage = "";
	} catch (error) {
		if (import.meta.env.DEV) {
			console.warn("[MEMORY] silent refresh failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		refreshInFlight = false;
		if (refreshPending && !destroyed) void refreshMemoriesSilently();
	}
}

async function reloadMemories() {
	if (context.status !== "authenticated" || !context.space) return;

	const spaceId = context.space.id;
	loadedSpaceId = spaceId;
	loading = true;
	errorMessage = "";
	const queryStart = getPerfTime();
	perfNavMark("page query start", { page: "home" });

	try {
		const result = await loadSpaceData(getSupabaseClient(), spaceId, "home");
		memories = result.memories;
		perfNavMark("page query end", {
			page: "home",
			count: memories.length,
			ms: getPerfDuration(queryStart),
		});
	} catch (error) {
		errorMessage =
			error instanceof Error ? error.message : "真实记录暂时无法读取。";
	} finally {
		loading = false;
		if (refreshPending && !destroyed) void refreshMemoriesSilently();
	}
}

function openDialog() {
	createRequestId = crypto.randomUUID();
	text = "";
	location = heroMemory?.location ?? "";
	date = getTodayDate();
	title = "";
	saveMessage = "";
	errorMessage = "";
	dialog?.showModal();
}

function closeDialog() {
	dialog?.close();
}

async function handleCreate() {
	if (context.status !== "authenticated" || !context.space || !context.user) {
		errorMessage = "当前登录状态不可用，请刷新后重试。";
		return;
	}

	const normalizedText = text.trim();
	if (!normalizedText) {
		errorMessage = "请先写下一句记录。";
		return;
	}

	saving = true;
	errorMessage = "";
	saveMessage = "";

	try {
		await createMemoryWithPerspective(getSupabaseClient(), {
			requestId: createRequestId,
			date,
			location: location.trim() || null,
			spaceId: context.space.id,
			text: normalizedText,
			title: title.trim() || null,
			userId: context.user.id,
		});
		saveMessage = "已保存。";
		dialog?.close();
		await reloadMemories();
	} catch (error) {
		errorMessage = error instanceof Error ? error.message : "保存失败。";
	} finally {
		saving = false;
	}
}

function openPerspectiveEditor(
	memory: Memory,
	perspective?: Perspective | null,
) {
	perspectiveMemory = memory;
	perspectiveText = perspective?.content ?? "";
	perspectiveMood = perspective?.mood ?? "";
	perspectiveError = "";
	perspectiveDialog?.showModal();
}

function closePerspectiveEditor() {
	perspectiveDialog?.close();
}

async function handleSavePerspective() {
	if (context.status !== "authenticated" || !context.user) {
		perspectiveError = "当前登录状态不可用，请刷新后重试。";
		return;
	}

	if (!perspectiveMemory) {
		perspectiveError = "当前记录不可用，请刷新后重试。";
		return;
	}

	const normalizedText = perspectiveText.trim();
	if (!normalizedText) {
		perspectiveError = "请先写下你的视角。";
		return;
	}

	const ownPerspective = getUserPerspective(perspectiveMemory, context.user.id);
	perspectiveSaving = true;
	perspectiveError = "";

	try {
		await saveCurrentUserPerspective(getSupabaseClient(), {
			content: normalizedText,
			memoryId: perspectiveMemory.id,
			mood: perspectiveMood,
			perspectiveId: ownPerspective?.id ?? null,
			spaceId: context.space?.id ?? "",
			userId: context.user.id,
		});
		perspectiveDialog?.close();
		await reloadMemories();
	} catch (error) {
		perspectiveError = getPerspectiveSaveMessage(error);
		if (import.meta.env.DEV) {
			console.warn("[PERSPECTIVE] save failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		perspectiveSaving = false;
	}
}

function openPhotoUploader(memory: Memory) {
	photoMemory = memory;
	photoError = "";
	clearSelectedPhotos();
	photoDialog?.showModal();
}

function closePhotoUploader() {
	if (photoUploading) return;

	photoDialog?.close();
	clearSelectedPhotos();
}

function handlePhotoSelection(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const files = Array.from(input.files ?? []).filter((file) =>
		file.type.startsWith("image/"),
	);

	clearSelectedPhotos();
	selectedPhotoFiles = files;
	photoPreviews = files.map((file) => ({
		id: crypto.randomUUID(),
		name: file.name,
		size: file.size,
		url: URL.createObjectURL(file),
	}));
	photoError = files.length > 0 ? "" : "请选择图片文件。";
}

async function handleUploadPhotos() {
	if (context.status !== "authenticated" || !context.space || !context.user) {
		photoError = "当前登录状态不可用，请刷新后重试。";
		return;
	}

	if (!photoMemory) {
		photoError = "当前记录不可用，请刷新后重试。";
		return;
	}

	if (selectedPhotoFiles.length === 0) {
		photoError = "请先选择照片。";
		return;
	}

	photoUploading = true;
	photoError = "";

	try {
		await uploadMemoryPhotos(getSupabaseClient(), {
			files: selectedPhotoFiles,
			memoryId: photoMemory.id,
			spaceId: context.space.id,
			userId: context.user.id,
		});
		photoDialog?.close();
		clearSelectedPhotos();
		await reloadMemoriesAfterPhotoUpload();
	} catch (error) {
		photoError = getPhotoSaveMessage(error);
		if (import.meta.env.DEV) {
			console.warn("[PHOTOS] upload failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				stage: getPhotoPipelineStage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		photoUploading = false;
		if (refreshPending && !destroyed) void refreshMemoriesSilently();
	}
}

async function reloadMemoriesAfterPhotoUpload() {
	if (import.meta.env.DEV) {
		console.info("[PHOTO] memory reload start");
	}

	try {
		await reloadMemories();
		if (import.meta.env.DEV) {
			console.info("[PHOTO] memory reload success");
		}
	} catch (error) {
		if (import.meta.env.DEV) {
			console.warn("[PHOTO] memory reload failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				stage: getPhotoPipelineStage(error),
				status: getErrorStatus(error),
			});
		}
		throw new PhotoPipelineError("PHOTO_RELOAD_FAILED", error);
	}
}

async function handleDeletePhoto(photo: MemoryPhoto) {
	if (context.status !== "authenticated" || !context.user) {
		photoDeleteError = "当前登录状态不可用，请刷新后重试。";
		return;
	}

	if (photo.uploadedBy !== context.user.id) {
		photoDeleteError = "你只能删除自己上传的照片。";
		return;
	}

	deletingPhotoId = photo.id;
	photoDeleteError = "";

	try {
		await deleteOwnMemoryPhoto(getSupabaseClient(), {
			id: photo.id,
			storagePath: photo.storagePath,
			userId: context.user.id,
		});
		await reloadMemories();
	} catch (error) {
		photoDeleteError = getPhotoDeleteMessage(error);
		if (import.meta.env.DEV) {
			console.warn("[PHOTOS] delete failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				stage: getPhotoPipelineStage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		deletingPhotoId = null;
	}
}

function clearSelectedPhotos() {
	for (const preview of photoPreviews) {
		URL.revokeObjectURL(preview.url);
	}

	selectedPhotoFiles = [];
	photoPreviews = [];

	if (photoInput) {
		photoInput.value = "";
	}
}

function getTodayDate() {
	const today = new Date();
	return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function parseMemoryDate(value: string) {
	return new Date(`${value}T00:00:00`);
}

function getDay(value: string) {
	return String(parseMemoryDate(value).getDate()).padStart(2, "0");
}

function getMonth(value: string) {
	return new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(
		parseMemoryDate(value),
	);
}

function getYear(value: string) {
	return parseMemoryDate(value).getFullYear();
}

function getWeekday(value: string) {
	return new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(
		parseMemoryDate(value),
	);
}

function getTime(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function getMemorySummary(memory: Memory) {
	return (
		memory.title ??
		memory.perspectives[0]?.content ??
		memory.note ??
		memory.location ??
		"一段新的共同记忆。"
	);
}

function getWeather(memory: Memory) {
	return (
		[memory.temperature, memory.weather].filter(Boolean).join(" · ") ||
		"天气未记录"
	);
}

function getUserInitial(profile: UserProfile | null, fallbackUserId: string) {
	const name = profile?.displayName ?? fallbackUserId;
	return name.trim().slice(0, 1).toUpperCase();
}

function getUserName(perspective: Perspective) {
	return getPerspectiveProfile(perspective)?.displayName ?? "成员";
}

function getPerspectiveProfile(perspective: Perspective) {
	return (
		context.space?.members.find(
			(member) => member.userId === perspective.userId,
		)?.profile ??
		perspective.profile ??
		null
	);
}

function getUserPerspective(memory: Memory, userId: string) {
	return (
		memory.perspectives.find((perspective) => perspective.userId === userId) ??
		null
	);
}

function getMemberProfileByUserId(userId: string) {
	return (
		context.space?.members.find((member) => member.userId === userId)
			?.profile ?? null
	);
}

function getSortedSpaceMembers() {
	const members = context.space?.members ?? [];
	return [...members].sort((left, right) =>
		(left.profile?.displayName ?? left.userId).localeCompare(
			right.profile?.displayName ?? right.userId,
			"zh-CN",
		),
	);
}

function getPerspectiveSaveMessage(error: unknown) {
	const code = getErrorCode(error);
	const status = getErrorStatus(error);
	const message = getErrorMessage(error)?.toLowerCase() ?? "";

	if (code === "23505" || message.includes("duplicate")) {
		return "你已经写过这一天的视角，请刷新后再编辑。";
	}

	if (
		status === 401 ||
		status === 403 ||
		message.includes("row-level security")
	) {
		return "你只能修改自己的视角。";
	}

	if (!navigator.onLine) {
		return "网络已断开，请恢复连接后重试。";
	}

	return "视角保存失败，请稍后重试。";
}

function getAvatarColor(index: number) {
	return index % 2 === 0 ? "sage" : "blue";
}

function getPerspectiveMemberDots(memory: Memory) {
	return getSortedSpaceMembers().map((member) => ({
		hasPerspective: Boolean(getUserPerspective(memory, member.userId)),
		label: member.profile?.displayName ?? "成员",
		userId: member.userId,
	}));
}

function getGalleryPhotos(memory: Memory) {
	return memory.photos.filter((photo) => photo.signedUrl).slice(0, 3);
}

function getHiddenLightboxPhotos(memory: Memory) {
	return memory.photos.slice(3).filter((photo) => photo.signedUrl);
}

function getGalleryClass(memory: Memory) {
	const count = getGalleryPhotos(memory).length;

	if (count === 0) return "memory-gallery--empty";
	if (count === 1) return "memory-gallery--single";
	if (count === 2) return "memory-gallery--double";
	return "memory-gallery--collage";
}

function getPhotoUploaderName(photo: MemoryPhoto) {
	return (
		context.space?.members.find((member) => member.userId === photo.uploadedBy)
			?.profile?.displayName ?? "成员"
	);
}

function logPhotoImageRender(photo: MemoryPhoto) {
	if (!import.meta.env.DEV) return "";

	console.info("[PHOTO] image render", {
		hasSrc: Boolean(photo.signedUrl),
		photoId: photo.id,
		pathPresent: Boolean(photo.storagePath),
		src: getSignedUrlDebug(photo.signedUrl),
	});

	return "";
}

function handlePhotoImageLoad(photo: MemoryPhoto) {
	if (!import.meta.env.DEV) return;

	console.info("[PHOTO] image loaded", {
		photoId: photo.id,
	});
}

function handlePhotoImageError(
	event: Event & { currentTarget: Element },
	photo: MemoryPhoto,
) {
	revealPhotoFallback(event.currentTarget);

	if (!import.meta.env.DEV) return;

	console.warn("[PHOTO] image failed", {
		hasSrc: Boolean(photo.signedUrl),
		photoId: photo.id,
		pathPresent: Boolean(photo.storagePath),
		src: getSignedUrlDebug(photo.signedUrl),
	});
}

function getSignedUrlDebug(signedUrl: string | null) {
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

function formatFileSize(bytes: number) {
	if (bytes < 1024 * 1024) {
		return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}

	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getPhotoSaveMessage(error: unknown) {
	const stage = getPhotoPipelineStage(error);
	const status = getErrorStatus(error);
	const message = getErrorMessage(error)?.toLowerCase() ?? "";

	if (stage === "PHOTO_RELOAD_FAILED" || stage === "PHOTO_SIGNED_URL_FAILED") {
		return "照片已经保存，暂时无法加载预览。刷新页面后可再次查看。";
	}

	if (stage === "PHOTO_COMPRESSION_FAILED") {
		return "照片压缩失败，请换一张图片或稍后重试。";
	}

	if (
		status === 401 ||
		status === 403 ||
		message.includes("row-level security")
	) {
		return "你没有权限向这条记忆上传照片。";
	}

	if (message.includes("mime") || message.includes("file size")) {
		return "照片格式或大小不符合当前 Storage 限制。";
	}

	if (!navigator.onLine) {
		return "网络已断开，请恢复连接后重试。";
	}

	return "照片没有保存成功，请再试一次。";
}

function getPhotoDeleteMessage(error: unknown) {
	const stage = getPhotoPipelineStage(error);
	const status = getErrorStatus(error);
	const message = getErrorMessage(error)?.toLowerCase() ?? "";

	if (stage === "PHOTO_STORAGE_DELETE_FAILED") {
		return "照片未能从私人存储中删除，请稍后重试。";
	}

	if (
		status === 401 ||
		status === 403 ||
		message.includes("row-level security")
	) {
		return "你只能删除自己上传的照片。";
	}

	if (!navigator.onLine) {
		return "网络已断开，请恢复连接后重试。";
	}

	return "照片删除失败，请稍后重试。";
}

function getPhotoPipelineStage(error: unknown) {
	if (error instanceof PhotoPipelineError) return error.stage;

	if (typeof error !== "object" || error === null || !("stage" in error)) {
		return null;
	}

	const stage = error.stage;
	return typeof stage === "string" ? stage : null;
}
</script>

{#if loading}
	<section class="memory-real-state">
		<h1>正在翻开今天的这一页…</h1>
	</section>
{:else if errorMessage && memories.length === 0}
	<section class="memory-real-state">
		<h1>今天这一页暂时打不开。</h1>
		<span>{errorMessage}</span>
		<button type="button" on:click={reloadMemories}>再试一次</button>
	</section>
{:else if !heroMemory}
	<section class="memory-real-empty">
		<h1>这里还是空白的第一页。</h1>
		<span>写下第一条记忆后，它就会安静地留在这个只属于我们的空间里。</span>
		<button type="button" on:click={openDialog}>记录今天</button>
	</section>
{:else}
	<header class="journal-collection">
		<div><p>OUR EVERYDAY COLLECTION <span>· 生活收藏册</span></p><h1 id="today-title">把平常的日子，<br />收藏成<span>我们。</span></h1><span class="journal-collection__note">照片贴好，心情写下。今天也值得留一页。</span></div>
		<a class="journal-collection__stamp" href="/space/" aria-label="查看我们的收藏"><span>两人共同收藏</span><strong>{memories.length.toString().padStart(2, "0")}</strong><span>页生活 · 持续装订中</span></a>
	</header>
	<div class="journal-chapter"><span>01 / 最新一页</span><span>{heroMemory.title || "留住这一刻"}</span></div>
	<section class="memory-today" aria-labelledby="today-title">
		<div class="memory-today__main">
			<div class="memory-day">
				<div class="memory-day__date">
					<strong>{getDay(heroMemory.date)}</strong>
					<p>{getMonth(heroMemory.date)} · {getYear(heroMemory.date)}</p>
					<span>{getWeekday(heroMemory.date)}</span>
				</div>
				<div class="memory-day__rule"></div>
				<div class="memory-day__notes">
					<p><span>📍</span><span>{heroMemory.location ?? "地点未记录"}</span></p>
					<p><span>☁️</span><span>{getWeather(heroMemory)}</span></p>
				</div>
				<em>Every day,<br />I love us a little more.</em>
			</div>

			<div class={`memory-gallery ${getGalleryClass(heroMemory)}`} aria-label="共同记录的照片">
				{#if getGalleryPhotos(heroMemory).length === 0}
					<figure class="memory-gallery__item-1 memory-gallery__placeholder">
						<span>还没有照片</span>
						<button type="button" on:click={() => openPhotoUploader(heroMemory)}>
							上传生活照片
						</button>
					</figure>
				{:else}
					{#each getGalleryPhotos(heroMemory) as photo, index}
						{@const imageRenderDebug = logPhotoImageRender(photo)}
						<figure class={`memory-gallery__item-${index + 1}`}>
							<a
								data-caption={`${getPhotoUploaderName(photo)} · ${getTime(photo.createdAt)}`}
								data-fancybox={`memory-${heroMemory.id}`}
								href={photo.signedUrl}
							>
								{imageRenderDebug}
								<img
									alt={photo.alt ?? heroMemory.title ?? heroMemory.location ?? "生活照片"}
									decoding={index === 0 ? "sync" : "async"}
									fetchpriority={index === 0 ? "high" : "auto"}
									height={photo.height ?? undefined}
									loading={index === 0 ? "eager" : "lazy"}
									on:error={(event) => handlePhotoImageError(event, photo)}
									on:load={() => handlePhotoImageLoad(photo)}
									src={photo.signedUrl}
									width={photo.width ?? undefined}
								/>
								<span class="memory-photo-fallback" hidden
									>照片暂时无法加载</span
								>
							</a>
							<figcaption>
								<span>{getPhotoUploaderName(photo)}</span>
								{#if photo.uploadedBy === context.user?.id}
									<button
										type="button"
										disabled={deletingPhotoId === photo.id}
										on:click={() => handleDeletePhoto(photo)}
									>
										{deletingPhotoId === photo.id ? "删除中" : "删除"}
									</button>
								{/if}
							</figcaption>
						</figure>
					{/each}
					<div class="memory-gallery__lightbox-rest" aria-hidden="true">
						{#each getHiddenLightboxPhotos(heroMemory) as photo}
							<a
								data-caption={`${getPhotoUploaderName(photo)} · ${getTime(photo.createdAt)}`}
								data-fancybox={`memory-${heroMemory.id}`}
								href={photo.signedUrl}
							>
								{photo.alt ?? "生活照片"}
							</a>
						{/each}
					</div>
				{/if}
			</div>

			<div class="memory-perspectives">
				{#each getSortedSpaceMembers() as member, index}
					{@const perspective = getUserPerspective(heroMemory, member.userId)}
					{@const profile = member.profile ?? getMemberProfileByUserId(member.userId)}
					{@const isCurrentUser = context.user?.id === member.userId}
					<article
						class:memory-perspective--missing={!perspective}
						class={`memory-perspective memory-perspective--${isCurrentUser ? "sage" : "blue"}`}
					>
						<header>
							<span
								class={`memory-avatar memory-avatar--${getAvatarColor(index)} memory-avatar--small`}
								title={profile?.displayName ?? "成员"}
							>
								<span aria-hidden="true"
									>{getUserInitial(profile, member.userId)}</span
								>
							</span>
							<strong>{profile?.displayName ?? "成员"} 的视角</strong>
							{#if perspective}
								<time>{getTime(perspective.updatedAt)}</time>
							{/if}
						</header>
						{#if perspective}
							<p>{perspective.content}</p>
							<footer class="memory-perspective__actions">
								{#if perspective.mood}
									<span class="memory-perspective__mood">{perspective.mood}</span>
								{/if}
								{#if isCurrentUser}
									<button
										type="button"
										on:click={() => openPerspectiveEditor(heroMemory, perspective)}
									>
										编辑我的视角
									</button>
								{/if}
							</footer>
						{:else if isCurrentUser}
							<p class="memory-perspective__empty">还没有留下你的视角。</p>
							<button
								class="memory-perspective__write"
								type="button"
								on:click={() => openPerspectiveEditor(heroMemory)}
							>
								写下我的视角
							</button>
						{:else}
							<p class="memory-perspective__empty">
								{profile?.displayName ?? "对方"}还没有留下这一天的视角。
							</p>
						{/if}
					</article>
				{/each}
			</div>
		</div>
		{#if photoDeleteError}
			<p class="memory-home-photo-error" aria-live="polite">{photoDeleteError}</p>
		{/if}
		<footer class="memory-today__footer">
			<div>
				<span>📷 {heroMemory.photos.length} 张照片</span>
				{#if heroMemory.song}
					<span>🎵 {heroMemory.song.title}{heroMemory.song.artist ? ` · ${heroMemory.song.artist}` : ""}</span>
				{/if}
				<a class="memory-view-detail" href={getMemoryDetailHref(heroMemory.id)}>查看详情 →</a>
			</div>
			<button type="button" on:click={() => openPhotoUploader(heroMemory)}>上传照片</button>
		</footer>
	</section>

	<section class="memory-recent" aria-labelledby="recent-title">
		<header class="memory-section-header">
			<div><p>02 / 散落的好时光</p><h2>最近记录</h2></div><a class="journal-text-link" href="/timeline/">翻阅整本手记 ↗</a>
		</header>
		{#if recentMemories.length === 0}
			<p class="memory-real-inline-empty">目前只有这一条记录。继续写，最近记录会慢慢长出来。</p>
		{:else}
			<div class="memory-recent__grid">
				{#each recentMemories as memory}
					{@const recentPhoto = memory.photos[0] ?? null}
					<article class="memory-card">
						<header>
							<strong>{getDay(memory.date)}</strong>
							<p>{getMonth(memory.date)} · {getYear(memory.date)}</p>
						</header>
						{#if recentPhoto?.signedUrl}
							{@const imageRenderDebug = logPhotoImageRender(recentPhoto)}
							<a
								class="memory-card__photo"
								data-fancybox={`memory-${memory.id}`}
								href={recentPhoto.signedUrl}
							>
								{imageRenderDebug}
								<img
									alt={recentPhoto.alt ?? memory.title ?? memory.location ?? "生活照片"}
									decoding="async"
									height={recentPhoto.height ?? undefined}
									loading="lazy"
									on:error={(event) => handlePhotoImageError(event, recentPhoto)}
									on:load={() => handlePhotoImageLoad(recentPhoto)}
									src={recentPhoto.signedUrl}
									width={recentPhoto.width ?? undefined}
								/>
								<span class="memory-photo-fallback" hidden
									>照片暂时无法加载</span
								>
							</a>
						{:else}
							<div class="memory-card__photo memory-card__photo--empty">
								<span>还没有照片</span>
							</div>
						{/if}
						<p class="memory-card__summary">“{getMemorySummary(memory)}”</p>
						<footer>
							<div class="memory-card__perspective-dots">
								{#each getPerspectiveMemberDots(memory) as item}
									<span
										class:is-complete={item.hasPerspective}
										title={`${item.hasPerspective ? "已记录" : "未记录"} · ${item.label}`}
									>
										<span aria-hidden="true">{item.hasPerspective ? "●" : "○"}</span
										><span class="memory-sr-only">{item.hasPerspective ? "已记录" : "未记录"}</span
										>{item.label}
									</span>
								{/each}
							</div>
							<span class="memory-card__meta">
								<span>📷 {memory.photos.length}</span>
								<a class="memory-view-detail" href={getMemoryDetailHref(memory.id)}>查看详情 →</a>
							</span>
						</footer>
					</article>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<div class="memory-create-host">
	<button class="memory-create-button" type="button" aria-label="记录今天" on:click={openDialog}>
		<span aria-hidden="true">＋</span>
		<span>记录今天</span>
	</button>
</div>

<dialog bind:this={dialog} class="memory-dialog">
	<form class="memory-dialog__panel" on:submit|preventDefault={handleCreate}>
		<header>
			<div><h2>记录今天</h2></div>
			<button type="button" aria-label="关闭" on:click={closeDialog}>×</button>
		</header>
		<label>
			<span>今天发生了什么？</span>
			<textarea
				bind:value={text}
				rows="4"
				placeholder="写下一句此刻不想忘记的话…"
				required
			></textarea>
		</label>
		<label>
			<span>标题，可选</span>
			<input bind:value={title} placeholder="例如：晚饭后的散步" />
		</label>
		<label><span>日期</span><input bind:value={date} type="date" required /></label>
		<LocationPicker bind:value={location} recent={memories.map(item => item.location ?? "")} />
		<p class="memory-dialog__hint">
			这一页会以你的视角记录，对方也有属于自己的视角。
		</p>
		{#if errorMessage}
			<p class="memory-dialog__error" aria-live="polite">{errorMessage}</p>
		{/if}
		{#if saveMessage}
			<p class="memory-dialog__success" aria-live="polite">{saveMessage}</p>
		{/if}
		<footer>
			<button type="button" class="memory-dialog__cancel" on:click={closeDialog}>取消</button>
			<button type="submit" class="memory-dialog__save" disabled={saving}>
				{saving ? "保存中…" : "保存这段记忆"}
			</button>
		</footer>
	</form>
</dialog>

<dialog bind:this={perspectiveDialog} class="memory-dialog memory-perspective-dialog">
	<form class="memory-dialog__panel" on:submit|preventDefault={handleSavePerspective}>
		<header>
			<div>
				<h2>{currentUserPerspective ? "编辑我的视角" : "写下我的视角"}</h2>
			</div>
			<button type="button" aria-label="关闭" on:click={closePerspectiveEditor}>×</button>
		</header>
		<label>
			<span>你的视角</span>
			<textarea
				bind:value={perspectiveText}
				rows="6"
				placeholder="写下只有你记得的细节、感受或一句话…"
				required
			></textarea>
		</label>
		<label>
			<span>心情，可选</span>
			<input bind:value={perspectiveMood} placeholder="例如：真实、治愈、好笑" />
		</label>
		<p class="memory-dialog__hint">
			记录者：{context.profile?.displayName ?? "当前账号"}。你只能创建或编辑自己的视角。
		</p>
		{#if perspectiveError}
			<p class="memory-dialog__error" aria-live="polite">{perspectiveError}</p>
		{/if}
		<footer>
			<button type="button" class="memory-dialog__cancel" on:click={closePerspectiveEditor}>
				取消
			</button>
			<button type="submit" class="memory-dialog__save" disabled={perspectiveSaving}>
				{perspectiveSaving ? "保存中…" : "保存我的视角"}
			</button>
		</footer>
	</form>
</dialog>

<dialog bind:this={photoDialog} class="memory-dialog memory-photo-dialog">
	<form class="memory-dialog__panel" on:submit|preventDefault={handleUploadPhotos}>
		<header>
			<div>
				<h2>上传生活照片</h2>
			</div>
			<button type="button" aria-label="关闭" on:click={closePhotoUploader}>×</button>
		</header>
		<label class="memory-photo-upload">
			<span>选择照片</span>
			<strong>可以一次选择多张，上传前会在浏览器中压缩。</strong>
			<input
				accept="image/*"
				bind:this={photoInput}
				multiple
				on:change={handlePhotoSelection}
				type="file"
			/>
		</label>
		{#if photoPreviews.length > 0}
			<div class="memory-photo-preview-grid">
				{#each photoPreviews as preview}
					<figure>
						<img alt={preview.name} src={preview.url} />
						<figcaption>
							<span>{preview.name}</span>
							<small>{formatFileSize(preview.size)}</small>
						</figcaption>
					</figure>
				{/each}
			</div>
		{/if}
		<p class="memory-dialog__hint">
			这些照片只会留在我们的空间里，只有我们两个人能看到。
		</p>
		{#if photoError}
			<p class="memory-dialog__error" aria-live="polite">{photoError}</p>
		{/if}
		<footer>
			<button type="button" class="memory-dialog__cancel" on:click={closePhotoUploader}>
				取消
			</button>
			<button
				type="submit"
				class="memory-dialog__save"
				disabled={photoUploading || selectedPhotoFiles.length === 0}
			>
				{photoUploading ? "上传中…" : "上传照片"}
			</button>
		</footer>
	</form>
</dialog>

<style>
	.memory-gallery figure {
		position: relative;
	}

	.memory-gallery figcaption {
		position: absolute;
		right: 0.55rem;
		bottom: 0.55rem;
		left: 0.55rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		color: rgba(249, 247, 242, 0.92);
		font-size: 0.58rem;
		letter-spacing: 0.04em;
		text-shadow: 0 1px 8px rgba(0, 0, 0, 0.32);
	}

	.memory-gallery figcaption button {
		border: 1px solid rgba(249, 247, 242, 0.68);
		border-radius: 999px;
		padding: 0.22rem 0.5rem;
		background: rgba(34, 32, 29, 0.34);
		color: #fff;
		font: 500 0.56rem var(--memory-sans);
		cursor: pointer;
		backdrop-filter: blur(6px);
	}

	.memory-gallery figcaption button:disabled {
		cursor: not-allowed;
		opacity: 0.72;
	}

	.memory-gallery__lightbox-rest {
		display: none;
	}

	.memory-home-photo-error {
		margin: 0.8rem 0 0 calc(130px + clamp(1.5rem, 3vw, 3.75rem));
		color: #8d3326;
		font-size: 0.75rem;
	}

	.memory-gallery--empty button,
	.memory-today__footer button {
		border: 1px solid color-mix(in srgb, var(--memory-text) 16%, transparent);
		border-radius: 999px;
		padding: 0.46rem 0.78rem;
		background: rgba(249, 247, 242, 0.72);
		color: var(--memory-text);
		font: 500 0.66rem var(--memory-sans);
		cursor: pointer;
	}

	.memory-real-state span,
	.memory-real-empty span,
	.memory-real-inline-empty {
		max-width: 34rem;
		color: var(--memory-muted);
		line-height: 1.8;
	}
	.memory-today__footer .memory-view-detail,
	.memory-card__meta .memory-view-detail {
		color: var(--memory-terracotta);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}

	.memory-today__footer .memory-view-detail:hover,
	.memory-card__meta .memory-view-detail:hover {
		text-decoration: underline;
	}

	@media (max-width: 1059px) {
		.memory-home-photo-error {
			margin-left: 0;
		}
	}

</style>
