export const DEFAULT_PRIVATE_HOME_PATH = "/";
export const LOGIN_PATH = "/space/login/";

export function getSafeRedirectPath(
	value: string | null | undefined,
	fallback = DEFAULT_PRIVATE_HOME_PATH,
): string {
	if (!value) {
		return fallback;
	}

	if (value.startsWith("//")) {
		return fallback;
	}

	try {
		const parsed = new URL(value, window.location.origin);
		if (parsed.origin !== window.location.origin) {
			return fallback;
		}

		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return value.startsWith("/") ? value : fallback;
	}
}

export function buildLoginPath(nextPath: string): string {
	const safeNextPath = getSafeRedirectPath(nextPath);
	const params = new URLSearchParams({ next: safeNextPath });
	return `${LOGIN_PATH}?${params.toString()}`;
}
