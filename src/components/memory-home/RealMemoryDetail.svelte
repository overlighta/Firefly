<script lang="ts">
import LocationPicker from "./LocationPicker.svelte";
import { onDestroy, onMount } from "svelte";
import { navigate } from "@/lib/navigation";
import { get } from "svelte/store";

import {
	getErrorCode,
	getErrorMessage,
	getErrorStatus,
	getPerfDuration,
	getPerfTime,
	perfDebug,
} from "@/lib/auth/debug";
import { authState } from "@/lib/auth/state";
import { perfNavMark } from "@/lib/memory/perf-nav";
import { revealPhotoFallback } from "@/lib/memory/photo-fallback";
import {
	deleteMemory,
	deleteOwnMemoryPhoto,
	loadMemoryDetailCached,
	MemoryMutationError,
	PhotoPipelineError,
	saveCurrentUserPerspective,
	updateMemorySharedFields,
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

let memoryId: string | null = null;
let memory: Memory | null = null;
let loading = true;
let notFound = false;
let errorMessage = "";
let loadedSpaceId: string | null = null;
let refreshInFlight = false;
let refreshPending = false;
let destroyed = false;

let editDialog: HTMLDialogElement | null = null;
let editDate = "";
let editTitle = "";
let editLocation = "";
let editLatitude = "";
let editLongitude = "";
let editWeather = "";
let editTemperature = "";
let editSongTitle = "";
let editSongArtist = "";
let editNote = "";
let editSaving = false;
let editError = "";

let perspectiveDialog: HTMLDialogElement | null = null;
let perspectiveOwn = false;
let perspectiveText = "";
let perspectiveMood = "";
let perspectiveSaving = false;
let perspectiveError = "";

let photoDialog: HTMLDialogElement | null = null;
let photoInput: HTMLInputElement | null = null;
let selectedPhotoFiles: File[] = [];
let photoPreviews: PhotoPreview[] = [];
let photoUploading = false;
let photoError = "";
let photoDeleteError = "";
let deletingPhotoId: string | null = null;

let deleteDialog: HTMLDialogElement | null = null;
let deleteSaving = false;
let deleteError = "";
let deleteCompletedWithCleanupWarning = false;

$: context = $authState;
$: if (
	memoryId &&
	context.status === "authenticated" &&
	context.space?.id &&
	context.space.id !== loadedSpaceId
) {
	void reloadDetail();
}

onDestroy(() => { destroyed = true; });

onMount(() => {
	perfNavMark("island mount", { page: "memory-detail" });
	memoryId = readMemoryIdFromLocation();
	subscribeToSpaceChanges();
	document.addEventListener("astro:page-load", handlePageView);
	document.addEventListener("journal:navigate", handlePageView);

	return () => {
		unsubscribeSpaceChanges?.();
		document.removeEventListener("astro:page-load", handlePageView);
		document.removeEventListener("journal:navigate", handlePageView);
	};
});

let unsubscribeSpaceChanges: (() => void) | null = null;

function handlePageView() {
	const nextId = readMemoryIdFromLocation();
	if (nextId === memoryId) return;

	memoryId = nextId;
	memory = null;
	loading = true;
	notFound = false;
	errorMessage = "";
	loadedSpaceId = null;
	photoDeleteError = "";
}

function logCreatorGuard(target: Memory) {
	if (!import.meta.env.DEV) return;

	console.info("[MEMORY DETAIL] creator guard", {
		hasCreatedBy: Boolean(target.createdBy),
		isCreator: target.createdBy === context.user?.id,
	});
}

function readMemoryIdFromLocation(): string | null {
	const queryId = new URLSearchParams(window.location.search).get("id");
	if (queryId && isUuid(queryId)) return queryId;

	const pathname = window.location.pathname.replace(/\/+$/, "");
	if (!pathname.startsWith("/memory/")) return null;

	const rawId = pathname.slice("/memory/".length).split("/")[0];
	if (!rawId || !isUuid(rawId)) return null;

	return rawId;
}

function isUuid(value: string) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		value,
	);
}

function subscribeToSpaceChanges() {
	const initialSignalVersion = get(spaceDataVersion).version;

	unsubscribeSpaceChanges = spaceDataVersion.subscribe((signal) => {
		if (signal.version <= initialSignalVersion) return;
		if (signal.spaceId !== context.space?.id) return;
		if (!memoryId) return;
		void refreshDetailSilently();
	});

	return unsubscribeSpaceChanges;
}

async function reloadDetail() {
	if (!memoryId) return;

	const startedAt = getPerfTime();
	loading = true;
	errorMessage = "";
	notFound = false;
	photoDeleteError = "";
	perfNavMark("page query start", { page: "memory-detail" });

	try {
		const result = await loadMemoryDetailCached(
			getSupabaseClient(),
			memoryId,
			context.space?.id ?? "",
		);
		memory = result.memory;

		if (result.memory) {
			loadedSpaceId = result.memory.spaceId;
			logCreatorGuard(result.memory);
		} else {
			notFound = true;
		}

		perfNavMark("page query end", {
			page: "memory-detail",
			found: Boolean(result.memory),
			ms: getPerfDuration(startedAt),
		});
	} catch (error) {
		errorMessage = "这段记忆暂时无法读取。请稍后重试。";
		if (import.meta.env.DEV) {
			console.warn("[MEMORY DETAIL] query failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		loading = false;
		if (refreshPending && !destroyed) void refreshDetailSilently();
	}
}

async function refreshDetailSilently() {
	if (destroyed) return;
	if (refreshInFlight || loading) { refreshPending = true; return; }
	refreshPending = false;
	if (!memoryId) return;

	refreshInFlight = true;
	try {
		const result = await loadMemoryDetailCached(
			getSupabaseClient(),
			memoryId,
			context.space?.id ?? "",
		);

		if (result.memory === null) {
			memory = null;
			notFound = true;
			return;
		}

		memory = result.memory;
		errorMessage = "";
		logCreatorGuard(result.memory);
	} catch (error) {
		if (import.meta.env.DEV) {
			console.warn("[MEMORY DETAIL] silent refresh failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		refreshInFlight = false;
		if (refreshPending && !destroyed) void refreshDetailSilently();
	}
}

function openEditDialog() {
	if (!memory) return;

	editDate = memory.date;
	editTitle = memory.title ?? "";
	editLocation = memory.location ?? "";
	editLatitude = memory.coordinates ? String(memory.coordinates.latitude) : "";
	editLongitude = memory.coordinates
		? String(memory.coordinates.longitude)
		: "";
	editWeather = memory.weather ?? "";
	editTemperature = memory.temperature ?? "";
	editSongTitle = memory.song?.title ?? "";
	editSongArtist = memory.song?.artist ?? "";
	editNote = memory.note ?? "";
	editError = "";
	editDialog?.showModal();
}

function closeEditDialog() {
	editDialog?.close();
}

async function handleSaveSharedFields() {
	if (!memory || !memoryId) return;

	const latitude = parseOptionalCoordinate(editLatitude, "纬度");
	if (typeof latitude === "string") {
		editError = latitude;
		return;
	}

	const longitude = parseOptionalCoordinate(editLongitude, "经度");
	if (typeof longitude === "string") {
		editError = longitude;
		return;
	}

	if (!editDate) {
		editError = "请选择日期。";
		return;
	}

	editSaving = true;
	editError = "";

	try {
		await updateMemorySharedFields(getSupabaseClient(), {
			date: editDate,
			latitude,
			location: editLocation.trim() || null,
			longitude,
			memoryId,
			note: editNote.trim() || null,
			songArtist: editSongArtist.trim() || null,
			songTitle: editSongTitle.trim() || null,
			spaceId: context.space?.id ?? "",
			temperature: editTemperature.trim() || null,
			title: editTitle.trim() || null,
			weather: editWeather.trim() || null,
		});
		editDialog?.close();
		await refreshDetailSilently();
	} catch (error) {
		editError = getEditError(error);
		if (import.meta.env.DEV) {
			console.warn("[MEMORY DETAIL] shared fields save failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		editSaving = false;
	}
}

function parseOptionalCoordinate(
	raw: string,
	label: string,
): number | string | null {
	const value = raw.trim();
	if (!value) return null;

	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return `${label}需要是数字。`;
	if (label === "纬度" && (parsed < -90 || parsed > 90)) {
		return "纬度需要在 -90 到 90 之间。";
	}
	if (label === "经度" && (parsed < -180 || parsed > 180)) {
		return "经度需要在 -180 到 180 之间。";
	}

	return parsed;
}

function getEditError(error: unknown) {
	if (error instanceof MemoryMutationError) return error.message;

	const status = getErrorStatus(error);
	const message = getErrorMessage(error)?.toLowerCase() ?? "";

	if (
		status === 401 ||
		status === 403 ||
		message.includes("row-level security")
	) {
		return "你只能修改两个人共同的记录。";
	}

	if (!navigator.onLine) {
		return "网络已断开，请恢复连接后重试。";
	}

	return "记录保存失败，请稍后重试。";
}

function openPerspectiveEditor(perspective?: Perspective | null) {
	perspectiveOwn = Boolean(perspective);
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

	if (!memory || !memoryId) {
		perspectiveError = "当前记录不可用，请刷新后重试。";
		return;
	}

	const normalizedText = perspectiveText.trim();
	if (!normalizedText) {
		perspectiveError = "请先写下你的视角。";
		return;
	}

	const ownPerspective = getUserPerspective(memory, context.user.id);
	perspectiveSaving = true;
	perspectiveError = "";

	try {
		await saveCurrentUserPerspective(getSupabaseClient(), {
			content: normalizedText,
			memoryId,
			mood: perspectiveMood.trim() || null,
			perspectiveId: ownPerspective?.id ?? null,
			spaceId: context.space?.id ?? "",
			userId: context.user.id,
		});
		perspectiveDialog?.close();
		await refreshDetailSilently();
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

function openPhotoUploader() {
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

	if (!memory) {
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
			memoryId: memory.id,
			spaceId: context.space.id,
			userId: context.user.id,
		});
		photoDialog?.close();
		clearSelectedPhotos();
		await refreshDetailSilently();
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
		if (refreshPending && !destroyed) void refreshDetailSilently();
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
		await refreshDetailSilently();
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

function openDeleteDialog() {
	deleteError = "";
	deleteCompletedWithCleanupWarning = false;
	deleteDialog?.showModal();
}

function closeDeleteDialog() {
	if (deleteSaving) return;

	deleteDialog?.close();
	if (deleteCompletedWithCleanupWarning) {
		navigateBackToMemories();
	}
}

async function handleDeleteMemory() {
	if (!memory || !memoryId) return;

	if (context.user && memory.createdBy !== context.user.id) {
		deleteError = "你只能删除自己创建的记录。";
		return;
	}

	deleteSaving = true;
	deleteError = "";
	deleteCompletedWithCleanupWarning = false;

	try {
		const photoPaths = memory.photos.map((photo) => photo.storagePath);
		const result = await deleteMemory(getSupabaseClient(), {
			memoryId,
			photoPaths,
			spaceId: context.space?.id ?? "",
		});

		if (result.cleanupFailedPaths > 0) {
			deleteCompletedWithCleanupWarning = true;
			deleteError = `记录已经删除，但仍有 ${result.cleanupFailedPaths} 张照片未能完成云端清理。请返回回忆页，并联系维护者处理。`;
			if (import.meta.env.DEV) {
				console.warn("[MEMORY DETAIL] orphan cleanup incomplete", {
					orphanCount: result.cleanupFailedPaths,
				});
			}
			return;
		}

		deleteDialog?.close();
		navigateBackToMemories();
	} catch (error) {
		deleteError = getDeleteError(error);
		if (import.meta.env.DEV) {
			console.warn("[MEMORY DETAIL] delete failed", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
		}
	} finally {
		deleteSaving = false;
	}
}

function getDeleteError(error: unknown) {
	if (error instanceof MemoryMutationError) return error.message;

	const status = getErrorStatus(error);
	const message = getErrorMessage(error)?.toLowerCase() ?? "";

	if (
		status === 401 ||
		status === 403 ||
		message.includes("row-level security")
	) {
		return "你只能删除自己创建的记录。";
	}

	if (!navigator.onLine) {
		return "网络已断开，请恢复连接后重试。";
	}

	return "记录删除失败，请稍后重试。";
}

function navigateBackToMemories() {
	navigate("/memories/");
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

function getMemorySummary(target: Memory | null) {
	if (!target) return "这段记录";

	return (
		target.title ??
		target.perspectives[0]?.content ??
		target.note ??
		target.location ??
		"一段新的共同记忆。"
	);
}

function getWeatherText(target: Memory) {
	return (
		[target.temperature, target.weather].filter(Boolean).join(" · ") ||
		"天气未记录"
	);
}

function getSongText(target: Memory) {
	if (!target.song) return "没有留下歌曲";
	return target.song.artist
		? `${target.song.title} · ${target.song.artist}`
		: target.song.title;
}

function getUserPerspective(target: Memory, userId: string) {
	return (
		target.perspectives.find((perspective) => perspective.userId === userId) ??
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

function getInitial(profile: UserProfile | null, fallbackUserId: string) {
	const name = profile?.displayName ?? fallbackUserId;
	return name.trim().slice(0, 1).toUpperCase();
}

function getAvatarColor(index: number) {
	return index % 2 === 0 ? "sage" : "blue";
}

function getPhotoUploaderName(photo: MemoryPhoto) {
	return (
		context.space?.members.find((member) => member.userId === photo.uploadedBy)
			?.profile?.displayName ?? "成员"
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
	<section class="memory-detail-state">
		<h1>正在翻开这条记录…</h1>
	</section>
{:else if notFound}
	<section class="memory-detail-state">
		<h1>这段记忆不存在。</h1>
		<span>它可能已经被删除，或者它还不属于我们的空间。</span>
		<a href="/memories/">返回回忆</a>
	</section>
{:else if errorMessage}
	<section class="memory-detail-state">
		<h1>这段记录暂时无法打开。</h1>
		<span>{errorMessage}</span>
		<button type="button" on:click={reloadDetail}>再试一次</button>
	</section>
{:else if !memory}
	<section class="memory-detail-state">
		<h1>请选择一条记忆。</h1>
		<span>从回忆或时间轴里打开一条记录，就能在这里看到它的完整内容。</span>
		<a href="/memories/">打开回忆</a>
	</section>
{:else}
	<section class="memory-detail">
		<a class="memory-detail__back" href="/memories/">← 返回回忆</a>

		<header class="memory-detail__hero">
			<div class="memory-detail__date">
				<strong>{getDay(memory.date)}</strong>
				<p>{getMonth(memory.date)} · {getYear(memory.date)}</p>
				<span>{getWeekday(memory.date)}</span>
			</div>
			<div class="memory-detail__headline">
				<p>共同记录</p>
				<h1>{getMemorySummary(memory)}</h1>
				{#if memory.note}
					<p class="memory-detail__note">{memory.note}</p>
				{/if}
			</div>
		</header>

		<ul class="memory-detail__meta">
			<li><span>📍</span>{memory.location ?? "地点未记录"}</li>
			<li><span>☁️</span>{getWeatherText(memory)}</li>
			<li><span>🎵</span>{getSongText(memory)}</li>
			{#if memory.coordinates}
				<li>
					<span>🗺️</span><a href="/map/">已收进我们的足迹 ↗</a>
				</li>
			{/if}
			<li><span>📷</span>{memory.photos.length} 张照片</li>
		</ul>

		<div class="memory-detail__actions">
			<button type="button" on:click={openEditDialog}>编辑记录</button>
			<button type="button" on:click={openPhotoUploader}>上传照片</button>
			{#if memory.createdBy === context.user?.id}
				<button type="button" class="is-danger" on:click={openDeleteDialog}>
					删除这条记录
				</button>
			{/if}
		</div>

		<section class="memory-detail__section" aria-labelledby="detail-perspectives-title">
			<header class="memory-section-header">
				<div><h2 id="detail-perspectives-title">两个人的视角</h2></div>
			</header>
			<div class="memory-perspectives">
				{#each getSortedSpaceMembers() as member, index}
					{@const perspective = getUserPerspective(memory, member.userId)}
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
								<span aria-hidden="true">{getInitial(profile, member.userId)}</span>
							</span>
							<strong>{profile?.displayName ?? "成员"} 的视角</strong>
							{#if perspective}
								<time>{getTime(perspective.updatedAt)}</time>
							{/if}
						</header>
						{#if perspective}
							<p>{perspective.content}</p>
							<footer class="memory-perspective__actions">
								<span class="memory-perspective__mood">{perspective.mood ?? "真实"}</span>
								{#if isCurrentUser}
									<button type="button" on:click={() => openPerspectiveEditor(perspective)}>
										编辑我的视角
									</button>
								{/if}
							</footer>
						{:else if isCurrentUser}
							<p class="memory-perspective__empty">还没有留下你的视角。</p>
							<button
								class="memory-perspective__write"
								type="button"
								on:click={() => openPerspectiveEditor()}
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
		</section>

		<section class="memory-detail__section" aria-labelledby="detail-gallery-title">
			<header class="memory-section-header">
				<div><h2 id="detail-gallery-title">这一天的照片</h2></div>
				<button type="button" on:click={openPhotoUploader}>上传照片</button>
			</header>
			{#if memory.photos.length === 0}
				<p class="memory-detail__empty">这一天还没有留下照片。</p>
			{:else}
				<div class="memory-detail__gallery">
					{#each memory.photos as photo}
						<figure>
							{#if photo.signedUrl}
								<a
									data-caption={`${getPhotoUploaderName(photo)} · ${getTime(photo.createdAt)}`}
									data-fancybox={`memory-detail-${memory.id}`}
									href={photo.signedUrl}
								>
									<img
										alt={photo.alt ?? memory.title ?? memory.location ?? "生活照片"}
										decoding="async"
										height={photo.height ?? undefined}
										loading="lazy"
										on:error={(event) => revealPhotoFallback(event.currentTarget)}
										src={photo.signedUrl}
										width={photo.width ?? undefined}
									/>
									<span class="memory-photo-fallback" hidden
										>照片暂时无法加载</span
									>
								</a>
							{:else}
								<span class="memory-detail__photo-missing">照片暂时无法加载</span>
							{/if}
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
				</div>
				{#if photoDeleteError}
					<p class="memory-detail__notice" aria-live="polite">{photoDeleteError}</p>
				{/if}
			{/if}
		</section>
	</section>
{/if}

<dialog bind:this={editDialog} class="memory-dialog">
	<form class="memory-dialog__panel" on:submit|preventDefault={handleSaveSharedFields}>
		<header>
			<div><h2>编辑记录</h2></div>
			<button type="button" aria-label="关闭" on:click={closeEditDialog}>×</button>
		</header>
		<label><span>日期</span><input bind:value={editDate} type="date" required /></label>
		<label><span>标题，可选</span><input bind:value={editTitle} placeholder="例如：晚饭后的散步" /></label>
		<LocationPicker bind:value={editLocation} bind:latitude={editLatitude} bind:longitude={editLongitude} />
		<details class="journal-optional"><summary>再添一点细节 · 天气、音乐与备注</summary>
		<div class="memory-dialog__grid">
			<label><span>天气，可选</span><input bind:value={editWeather} placeholder="例如：多云" /></label>
			<label><span>气温，可选</span><input bind:value={editTemperature} placeholder="例如：26°C" /></label>
		</div>
		<div class="memory-dialog__grid">
			<label><span>歌曲，可选</span><input bind:value={editSongTitle} placeholder="歌名" /></label>
			<label><span>歌手，可选</span><input bind:value={editSongArtist} placeholder="歌手" /></label>
		</div>
		<label><span>备注，可选</span><textarea bind:value={editNote} rows="3" placeholder="补充一句…"></textarea></label>
		</details>
		<p class="memory-dialog__hint">
			共享字段由两个人共同维护。你们的视角始终只能各自编辑。
		</p>
		{#if editError}
			<p class="memory-dialog__error" aria-live="polite">{editError}</p>
		{/if}
		<footer>
			<button type="button" class="memory-dialog__cancel" on:click={closeEditDialog}>取消</button>
			<button type="submit" class="memory-dialog__save" disabled={editSaving}>
				{editSaving ? "保存中…" : "保存修改"}
			</button>
		</footer>
	</form>
</dialog>

<dialog bind:this={perspectiveDialog} class="memory-dialog memory-perspective-dialog">
	<form class="memory-dialog__panel" on:submit|preventDefault={handleSavePerspective}>
		<header>
			<div>
				<h2>{perspectiveOwn ? "编辑我的视角" : "写下我的视角"}</h2>
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
		<p class="memory-dialog__hint">你只能创建或编辑自己的视角。</p>
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

<dialog bind:this={deleteDialog} class="memory-dialog">
	<div class="memory-dialog__panel">
		<header>
			<div>
				<h2>{deleteCompletedWithCleanupWarning ? "记录已删除" : "删除这条记录？"}</h2>
			</div>
			<button type="button" aria-label="关闭" on:click={closeDeleteDialog}>×</button>
		</header>
		{#if !deleteCompletedWithCleanupWarning}
			<p class="memory-dialog__confirm">
				这会把「{getMemorySummary(memory)}」的双方视角和全部 {memory?.photos.length ?? 0} 张照片一起删除，且不可撤销。只有创建这条记录的人可以删除。
			</p>
		{/if}
		{#if deleteError}
			<p class="memory-dialog__error" aria-live="polite">{deleteError}</p>
		{/if}
		<footer>
			{#if deleteCompletedWithCleanupWarning}
				<button type="button" class="memory-dialog__save" on:click={closeDeleteDialog}>
					返回回忆
				</button>
			{:else}
				<button type="button" class="memory-dialog__cancel" on:click={closeDeleteDialog}>
					取消
				</button>
				<button
					type="button"
					class="memory-dialog__save is-danger"
					disabled={deleteSaving}
					on:click={handleDeleteMemory}
				>
					{deleteSaving ? "删除中…" : "确认删除"}
				</button>
			{/if}
		</footer>
	</div>
</dialog>

<style>
	.memory-detail__back:hover {
		color: var(--memory-terracotta);
	}

	.memory-detail__date span {
		color: var(--memory-muted);
		font-weight: 600;
	}

	.memory-detail__headline > p:first-child {
		margin: 0 0 0.5rem;
		color: var(--memory-terracotta);
		font-size: 0.56rem;
		font-weight: 600;
		letter-spacing: 0.17em;
	}

	.memory-detail__note {
		margin: 1rem 0 0;
		color: var(--memory-muted);
		font-size: 0.82rem;
		line-height: 1.8;
		white-space: pre-line;
	}

	.memory-detail__meta li span {
		color: var(--memory-text);
	}

	.memory-detail__actions button {
		border: 1px solid color-mix(in srgb, var(--memory-text) 18%, transparent);
		border-radius: 999px;
		padding: 0.6rem 1.05rem;
		background: rgba(249, 247, 242, 0.72);
		color: var(--memory-text);
		font: 500 0.72rem var(--memory-sans);
		cursor: pointer;
	}

	.memory-detail__actions button.is-danger {
		border-color: #8d3326;
		background: #8d3326;
		color: var(--memory-surface);
	}

	.memory-detail__actions button.is-danger:hover {
		background: #a3402f;
	}

	.memory-detail__gallery figure:hover img {
		transform: scale(1.025);
	}

	.memory-detail__gallery figcaption {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		left: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		color: rgba(249, 247, 242, 0.92);
		font-size: 0.58rem;
		letter-spacing: 0.04em;
		text-shadow: 0 1px 8px rgba(0, 0, 0, 0.32);
	}

	.memory-detail__gallery figcaption button {
		border: 1px solid rgba(249, 247, 242, 0.68);
		border-radius: 999px;
		padding: 0.22rem 0.5rem;
		background: rgba(34, 32, 29, 0.34);
		color: #fff;
		font: 500 0.56rem var(--memory-sans);
		cursor: pointer;
		backdrop-filter: blur(6px);
	}

	.memory-detail__gallery figcaption button:disabled {
		cursor: not-allowed;
		opacity: 0.72;
	}

	.memory-detail__notice {
		margin: 1rem 0 0;
		color: #8d3326;
		font-size: 0.75rem;
	}

	.memory-dialog__save.is-danger {
		border-color: #8d3326;
		background: #8d3326;
	}
</style>
