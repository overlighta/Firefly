import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { authDebug } from "@/lib/auth/debug";
import type { Database } from "@/types/database";

export type BrowserSupabaseClient = SupabaseClient<Database>;

let browserClient: BrowserSupabaseClient | null = null;

function readSupabaseConfig() {
	const rawSupabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
	const supabasePublishableKey = import.meta.env
		.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

	if (!rawSupabaseUrl || !supabasePublishableKey) {
		throw new Error(
			"Missing Supabase browser config. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
		);
	}

	if (supabasePublishableKey.startsWith("sb_secret_")) {
		throw new Error(
			"Invalid Supabase browser config. PUBLIC_SUPABASE_PUBLISHABLE_KEY must not be a secret key.",
		);
	}

	const supabaseUrl = normalizeSupabaseProjectUrl(rawSupabaseUrl);

	return { supabasePublishableKey, supabaseUrl };
}

function normalizeSupabaseProjectUrl(rawUrl: string): string {
	const url = new URL(rawUrl);

	if (url.pathname === "/rest/v1" || url.pathname === "/rest/v1/") {
		url.pathname = "/";
		url.search = "";
		url.hash = "";
	}

	if (import.meta.env.DEV) {
		authDebug(`Runtime Supabase base URL pathname: ${url.pathname}`);
		authDebug(
			`Runtime Supabase base URL contains /rest/v1: ${url.toString().includes("/rest/v1")}`,
		);
	}

	return url.toString();
}

function getAuthDebugFetch(): typeof fetch | undefined {
	if (!import.meta.env.DEV || typeof fetch === "undefined") {
		return undefined;
	}

	return async (input: RequestInfo | URL, init?: RequestInit) => {
		const response = await fetch(input, init);
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;

		if (
			url.includes("/auth/v1/token") ||
			url.includes("/rest/v1/auth/v1/token") ||
			url.includes("/rest/v1/profiles") ||
			url.includes("/rest/v1/space_members") ||
			url.includes("/rest/v1/spaces")
		) {
			const endpoint = url.includes("/rest/v1/auth/v1/token")
				? "invalid auth token"
				: url.includes("/auth/v1/token")
					? "auth token"
					: url.includes("/rest/v1/profiles")
						? "profiles"
						: url.includes("/rest/v1/space_members")
							? "space_members"
							: "spaces";

			authDebug(`${endpoint} HTTP status`, {
				status: response.status,
			});
		}

		return response;
	};
}

export function getSupabaseClient(): BrowserSupabaseClient {
	if (browserClient) {
		return browserClient;
	}

	const { supabasePublishableKey, supabaseUrl } = readSupabaseConfig();

	browserClient = createClient<Database>(supabaseUrl, supabasePublishableKey, {
		auth: {
			autoRefreshToken: true,
			detectSessionInUrl: true,
			persistSession: true,
		},
		global: {
			fetch: getAuthDebugFetch(),
		},
	});

	return browserClient;
}
