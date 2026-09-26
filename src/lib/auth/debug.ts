export type AuthDebugCode =
	| "SIGN_IN_FAILED"
	| "SESSION_MISSING"
	| "PROFILE_MISSING"
	| "MEMBERSHIP_MISSING"
	| "SPACE_MISSING"
	| "MEMBERS_LOAD_FAILED"
	| "AUTH_GUARD_FAILED"
	| "REDIRECT_FAILED"
	| "AUTH_UNAVAILABLE";

interface AuthDebugDetails {
	code?: string | null;
	message?: string | null;
	status?: number | null;
}

type PerfDebugValue = string | number | boolean | null | undefined;

export type PerfDebugDetails = Record<string, PerfDebugValue>;

export function authDebug(message: string, details?: AuthDebugDetails): void {
	if (!import.meta.env.DEV) return;

	if (details) {
		console.info(`[AUTH] ${message}`, details);
		return;
	}

	console.info(`[AUTH] ${message}`);
}

export function authDebugWarn(
	message: string,
	details?: AuthDebugDetails,
): void {
	if (!import.meta.env.DEV) return;

	if (details) {
		console.warn(`[AUTH] ${message}`, details);
		return;
	}

	console.warn(`[AUTH] ${message}`);
}

export function perfDebug(message: string, details?: PerfDebugDetails): void {
	if (!import.meta.env.DEV) return;

	if (details) {
		console.info(`[PERF] ${message}`, details);
		return;
	}

	console.info(`[PERF] ${message}`);
}

export function getPerfTime(): number {
	if (typeof performance === "undefined") return Date.now();
	return performance.now();
}

export function getPerfDuration(startedAt: number): number {
	return Math.round((getPerfTime() - startedAt) * 10) / 10;
}

export function getErrorCode(error: unknown): string | null {
	if (typeof error !== "object" || error === null) return null;
	if (!("code" in error)) return null;
	const code = error.code;
	return typeof code === "string" ? code : null;
}

export function getErrorMessage(error: unknown): string | null {
	if (typeof error !== "object" || error === null) return null;
	if (!("message" in error)) return null;
	const message = error.message;
	return typeof message === "string" ? message : null;
}

export function getErrorStatus(error: unknown): number | null {
	if (typeof error !== "object" || error === null) return null;
	if (!("status" in error)) return null;
	const status = error.status;
	return typeof status === "number" ? status : null;
}
