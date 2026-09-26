import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "memory-images";
const AUDIT_TITLE = "Firefly storage recovery audit";
const PNG_BYTES = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.TEST_AUTH_EMAIL;
const password = process.env.TEST_AUTH_PASSWORD;

function report(label, value) {
	console.log(`[STORAGE-AUDIT] ${label}:`, value);
}

function safeErrorCode(error) {
	return error?.code ?? error?.statusCode ?? error?.status ?? "UNKNOWN";
}

function removedExpectedPath(data, expectedPath) {
	return (
		Array.isArray(data) &&
		data.some(
			(item) => item && typeof item === "object" && item.name === expectedPath,
		)
	);
}

if (!url || !key || !email || !password) {
	report("preflight", "missing local audit environment");
	process.exit(1);
}

const supabase = createClient(url, key, {
	auth: {
		autoRefreshToken: false,
		detectSessionInUrl: false,
		persistSession: false,
	},
});
const anonymous = createClient(url, key, {
	auth: {
		autoRefreshToken: false,
		detectSessionInUrl: false,
		persistSession: false,
	},
});

const memoryId = randomUUID();
const perspectiveId = randomUUID();
const photoId = randomUUID();
let userId = "";
let spaceId = "";
let storagePath = "";
let invalidMimePath = "";
let memoryExists = false;
let objectMayExist = false;
let invalidMimeObjectMayExist = false;
let overallPass = true;

async function createAuditMemory(title = AUDIT_TITLE) {
	const response = await supabase.from("memories").insert({
		created_by: userId,
		id: memoryId,
		memory_date: new Date().toISOString().slice(0, 10),
		space_id: spaceId,
		title,
	});

	if (response.error) throw response.error;
	memoryExists = true;
}

async function deleteAuditMemory() {
	if (!memoryExists) return;

	const response = await supabase.from("memories").delete().eq("id", memoryId);
	if (response.error) throw response.error;
	memoryExists = false;
}

async function removeObject(path) {
	const response = await supabase.storage.from(BUCKET).remove([path]);
	return {
		error: response.error,
		removed: !response.error && removedExpectedPath(response.data, path),
	};
}

async function recoverAuditArtifacts() {
	if ((!objectMayExist && !invalidMimeObjectMayExist) || !userId || !spaceId) {
		await deleteAuditMemory().catch(() => undefined);
		return;
	}

	if (!memoryExists) {
		await createAuditMemory(`${AUDIT_TITLE} cleanup`).catch(() => undefined);
	}

	if (memoryExists && objectMayExist) {
		const result = await removeObject(storagePath).catch(() => null);
		if (result?.removed) objectMayExist = false;
	}

	if (memoryExists && invalidMimeObjectMayExist) {
		const result = await removeObject(invalidMimePath).catch(() => null);
		if (result?.removed) invalidMimeObjectMayExist = false;
	}

	await deleteAuditMemory().catch(() => undefined);
}

try {
	report("sign in", "started");
	const auth = await supabase.auth.signInWithPassword({ email, password });
	if (auth.error || !auth.data.session || !auth.data.user?.id) {
		report("sign in", "failed");
		report("sign in error code", safeErrorCode(auth.error));
		throw new Error("AUTH_FAILED");
	}
	userId = auth.data.user.id;
	report("sign in", "success");

	const membership = await supabase
		.from("space_members")
		.select("space_id")
		.eq("user_id", userId)
		.limit(1)
		.maybeSingle();
	if (membership.error || !membership.data?.space_id) {
		report("membership", "failed or missing");
		report("membership error code", safeErrorCode(membership.error));
		throw new Error("MEMBERSHIP_FAILED");
	}
	spaceId = membership.data.space_id;
	storagePath = `${spaceId}/${memoryId}/${userId}/storage-recovery-audit.png`;
	invalidMimePath = `${spaceId}/${memoryId}/${userId}/storage-recovery-audit.pdf`;
	report("membership", "found");

	await createAuditMemory();
	report("temporary Memory", "created");

	const perspective = await supabase.from("perspectives").insert({
		content: "Temporary recovery audit perspective",
		id: perspectiveId,
		memory_id: memoryId,
		user_id: userId,
	});
	if (perspective.error) throw perspective.error;
	report("temporary Perspective", "created");

	const upload = await supabase.storage
		.from(BUCKET)
		.upload(storagePath, PNG_BYTES, {
			contentType: "image/png",
			upsert: false,
		});
	if (upload.error) throw upload.error;
	objectMayExist = true;
	report("allowed image upload", "success");

	const photo = await supabase.from("memory_photos").insert({
		height: 1,
		id: photoId,
		memory_id: memoryId,
		sort_order: 0,
		storage_path: storagePath,
		uploaded_by: userId,
		width: 1,
	});
	if (photo.error) throw photo.error;
	report("photo metadata", "created");

	const signed = await supabase.storage
		.from(BUCKET)
		.createSignedUrl(storagePath, 60);
	const signedResponse = signed.data?.signedUrl
		? await fetch(signed.data.signedUrl, {
				cache: "no-store",
				redirect: "manual",
			})
		: null;
	const memberReadPass = !signed.error && signedResponse?.status === 200;
	report("member private read", memberReadPass ? "pass" : "fail");
	overallPass &&= memberReadPass;

	const anonymousDownload = await anonymous.storage
		.from(BUCKET)
		.download(storagePath);
	const anonymousBlocked = Boolean(
		anonymousDownload.error && !anonymousDownload.data,
	);
	report("anonymous private read blocked", anonymousBlocked);
	overallPass &&= anonymousBlocked;

	const invalidMime = await supabase.storage
		.from(BUCKET)
		.upload(invalidMimePath, Buffer.from("not a PDF"), {
			contentType: "application/pdf",
			upsert: false,
		});
	invalidMimeObjectMayExist = !invalidMime.error;
	const mimePass = Boolean(invalidMime.error);
	report("disallowed MIME rejected", mimePass);
	if (invalidMime.error) {
		report("disallowed MIME error code", safeErrorCode(invalidMime.error));
	}
	overallPass &&= mimePass;

	await deleteAuditMemory();
	report("Memory delete", "success");

	const orphanDownload = await supabase.storage
		.from(BUCKET)
		.download(storagePath);
	const orphanReadBlocked = Boolean(
		orphanDownload.error && !orphanDownload.data,
	);
	report("ordinary orphan read blocked", orphanReadBlocked);
	overallPass &&= orphanReadBlocked;

	const orphanRemove = await removeObject(storagePath);
	const orphanCleanupPass = !orphanRemove.error && orphanRemove.removed;
	report("orphan Storage cleanup", orphanCleanupPass ? "pass" : "fail");
	if (orphanRemove.error) {
		report("orphan cleanup error code", safeErrorCode(orphanRemove.error));
	}
	if (orphanCleanupPass) objectMayExist = false;
	overallPass &&= orphanCleanupPass;

	await createAuditMemory(`${AUDIT_TITLE} verification`);
	const [perspectiveAfterCascade, photoAfterCascade] = await Promise.all([
		supabase
			.from("perspectives")
			.select("id", { count: "exact", head: true })
			.eq("id", perspectiveId),
		supabase
			.from("memory_photos")
			.select("id", { count: "exact", head: true })
			.eq("id", photoId),
	]);
	const cascadePass =
		!perspectiveAfterCascade.error &&
		!photoAfterCascade.error &&
		perspectiveAfterCascade.count === 0 &&
		photoAfterCascade.count === 0;
	report("relational cascade", cascadePass ? "pass" : "fail");
	overallPass &&= cascadePass;

	const samePathUpload = await supabase.storage
		.from(BUCKET)
		.upload(storagePath, PNG_BYTES, {
			contentType: "image/png",
			upsert: false,
		});
	const physicalDeletePass = !samePathUpload.error;
	report("physical object deletion", physicalDeletePass ? "pass" : "fail");
	if (samePathUpload.error) {
		report("same-path upload error code", safeErrorCode(samePathUpload.error));
	}
	objectMayExist = true;
	overallPass &&= physicalDeletePass;

	const ownerCleanup = await removeObject(storagePath);
	const ownerCleanupPass = !ownerCleanup.error && ownerCleanup.removed;
	report("verification object cleanup", ownerCleanupPass ? "pass" : "fail");
	if (ownerCleanupPass) objectMayExist = false;
	overallPass &&= ownerCleanupPass;

	const downloadAfterCleanup = await supabase.storage
		.from(BUCKET)
		.download(storagePath);
	const objectUnavailable = Boolean(
		downloadAfterCleanup.error && !downloadAfterCleanup.data,
	);
	report("object unavailable after cleanup", objectUnavailable);
	overallPass &&= objectUnavailable;

	await deleteAuditMemory();

	const markerCheck = await supabase
		.from("memories")
		.select("id", { count: "exact", head: true })
		.eq("id", memoryId);
	const noTemporaryRows = !markerCheck.error && markerCheck.count === 0;
	report("temporary rows cleaned", noTemporaryRows);
	overallPass &&= noTemporaryRows;
} catch (error) {
	overallPass = false;
	report("unexpected failure class", error?.message ?? "UNKNOWN");
} finally {
	await recoverAuditArtifacts();
	await supabase.auth.signOut({ scope: "local" });
	report(
		"final cleanup",
		!memoryExists && !objectMayExist && !invalidMimeObjectMayExist,
	);
	report("overall", overallPass ? "pass" : "fail");
	if (
		!overallPass ||
		memoryExists ||
		objectMayExist ||
		invalidMimeObjectMayExist
	) {
		process.exitCode = 1;
	}
}
