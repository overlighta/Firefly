import type { Session, User } from "@supabase/supabase-js";
import { writable } from "svelte/store";

import {
	type AuthDebugCode,
	authDebug,
	authDebugWarn,
	getErrorCode,
	getErrorMessage,
	getErrorStatus,
	getPerfDuration,
	getPerfTime,
	perfDebug,
} from "@/lib/auth/debug";
import {
	type AuthConfigurationCode,
	AuthConfigurationError,
	loadCurrentUserContext,
} from "@/lib/auth/queries";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Space, UserProfile } from "@/types/memory";

export type AuthStatus =
	| "loading"
	| "authenticated"
	| "unauthenticated"
	| "configuration-error"
	| "error";

export interface AuthContext {
	status: AuthStatus;
	session: Session | null;
	user: User | null;
	profile: UserProfile | null;
	space: Space | null;
	members: UserProfile[];
	errorCode: AuthConfigurationCode | "auth-unavailable" | null;
	debugCode: AuthDebugCode | null;
	errorMessage: string | null;
}

const initialAuthContext: AuthContext = {
	errorCode: null,
	debugCode: null,
	errorMessage: null,
	members: [],
	profile: null,
	session: null,
	space: null,
	status: "loading",
	user: null,
};

export const authState = writable<AuthContext>(initialAuthContext);

let initPromise: Promise<void> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;
let contextLoadVersion = 0;
let signInInProgress = false;
let authInitialized = false;
let currentAuthContext = initialAuthContext;

authState.subscribe((context) => {
	currentAuthContext = context;
});

function mapConfigurationDebugCode(code: AuthConfigurationCode): AuthDebugCode {
	switch (code) {
		case "missing-profile":
		case "profile-query-failed":
			return "PROFILE_MISSING";
		case "missing-membership":
		case "membership-query-failed":
			return "MEMBERSHIP_MISSING";
		case "missing-space":
		case "space-query-failed":
			return "SPACE_MISSING";
		case "members-query-failed":
			return "MEMBERS_LOAD_FAILED";
	}
}

function toUnauthenticatedContext(): AuthContext {
	return {
		...initialAuthContext,
		debugCode: "SESSION_MISSING",
		status: "unauthenticated",
	};
}

function toErrorContext(): AuthContext {
	return {
		...initialAuthContext,
		debugCode: "AUTH_UNAVAILABLE",
		errorCode: "auth-unavailable",
		errorMessage: "暂时无法打开私人空间。请稍后重试。",
		status: "error",
	};
}

async function applySession(
	session: Session | null,
	source = "unknown",
): Promise<void> {
	const totalStartedAt = getPerfTime();
	const loadVersion = ++contextLoadVersion;
	authDebug(`context load started: ${source}`);

	if (!session) {
		if (signInInProgress) {
			authDebug(`session: missing ignored during signIn (${source})`);
			return;
		}

		authDebug("session: missing");
		authDebug("final state: unauthenticated");
		authState.set(toUnauthenticatedContext());
		authInitialized = true;
		perfDebug("auth context total", { ms: getPerfDuration(totalStartedAt) });
		return;
	}

	authDebug("session: found");
	authDebug(`user id: ${session.user?.id ? "found" : "missing"}`);

	if (!session.user?.id) {
		authDebugWarn("final state: error", {
			code: "SESSION_USER_MISSING",
			message: "Session exists but user id is missing.",
		});
		authState.set(toErrorContext());
		authInitialized = true;
		perfDebug("auth context total", { ms: getPerfDuration(totalStartedAt) });
		return;
	}

	const supabase = getSupabaseClient();

	try {
		const context = await loadCurrentUserContext(supabase, session.user);
		if (loadVersion !== contextLoadVersion) {
			authDebug(`context load ignored: stale ${source}`);
			return;
		}

		authDebug("final state: authenticated");
		authState.set({
			debugCode: null,
			errorCode: null,
			errorMessage: null,
			members: context.members,
			profile: context.profile,
			session,
			space: context.space,
			status: "authenticated",
			user: session.user,
		});
		authInitialized = true;
		perfDebug("auth context total", { ms: getPerfDuration(totalStartedAt) });
	} catch (error) {
		if (loadVersion !== contextLoadVersion) {
			authDebug(`context error ignored: stale ${source}`);
			return;
		}

		if (error instanceof AuthConfigurationError) {
			const message =
				error.code === "missing-profile"
					? "这个账号还没有完成空间配置。"
					: error.code === "missing-membership"
						? "这个账号还没有加入私人空间。"
						: "私人空间配置暂时无法读取。";

			const debugCode = mapConfigurationDebugCode(error.code);
			authDebugWarn("final state: configuration-error", {
				code: debugCode,
				message: error.message,
			});

			authState.set({
				debugCode,
				errorCode: error.code,
				errorMessage: message,
				members: [],
				profile: null,
				session,
				space: null,
				status: "configuration-error",
				user: session.user,
			});
			authInitialized = true;
			perfDebug("auth context total", {
				ms: getPerfDuration(totalStartedAt),
			});
			return;
		}

		authDebugWarn("final state: error", {
			code: getErrorCode(error),
			message: getErrorMessage(error),
			status: getErrorStatus(error),
		});

		authState.set(toErrorContext());
		authInitialized = true;
		perfDebug("auth context total", { ms: getPerfDuration(totalStartedAt) });
	}
}

export function initAuth(): Promise<void> {
	if (authInitialized) {
		perfDebug("auth reused", { status: currentAuthContext.status });
		return Promise.resolve();
	}

	if (initPromise) {
		perfDebug("auth reused", { status: "initializing" });
		return initPromise;
	}

	initPromise = (async () => {
		if (currentAuthContext.status !== "authenticated") {
			authState.set(initialAuthContext);
		}

		try {
			const supabase = getSupabaseClient();
			const getSessionStartedAt = getPerfTime();
			const sessionResponse = await supabase.auth.getSession();
			perfDebug("getSession duration", {
				ms: getPerfDuration(getSessionStartedAt),
			});

			if (sessionResponse.error) {
				throw sessionResponse.error;
			}

			await applySession(sessionResponse.data.session, "initAuth.getSession");

			if (!authSubscription) {
				const subscriptionResponse = supabase.auth.onAuthStateChange(
					(event, session) => {
						authDebug(`onAuthStateChange: ${event}`);

						if (
							event === "INITIAL_SESSION" &&
							authInitialized &&
							currentAuthContext.user?.id === session?.user?.id
						) {
							perfDebug("auth reused", { source: "INITIAL_SESSION" });
							return;
						}

						if (event === "SIGNED_IN" && signInInProgress) {
							perfDebug("auth reused", { source: "SIGNED_IN_PENDING" });
							return;
						}

						if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && currentAuthContext.status === "authenticated" && currentAuthContext.user?.id === session?.user?.id) {
              authState.update(current => ({ ...current, session, user: session!.user }));
              return;
            }
            void applySession(session, `onAuthStateChange.${event}`);
					},
				);
				authSubscription = subscriptionResponse.data.subscription;
			}
		} catch (error) {
			authDebugWarn("final state: error", {
				code: getErrorCode(error),
				message: getErrorMessage(error),
				status: getErrorStatus(error),
			});
			authState.set(toErrorContext());
			authInitialized = true;
		}
	})();

	return initPromise;
}

export async function refreshAuth(): Promise<void> {
	initPromise = null;
	authInitialized = false;
	await initAuth();
}

export async function signInWithPassword(
	email: string,
	password: string,
): Promise<void> {
	const supabase = getSupabaseClient();
	authDebug("signIn started");
	signInInProgress = true;
	authState.update((current) => ({ ...current, status: "loading" }));

	const response = await supabase.auth.signInWithPassword({ email, password });

	if (response.error) {
		signInInProgress = false;
		authDebugWarn("signIn failed", {
			code: getErrorCode(response.error),
			message: getErrorMessage(response.error),
			status: getErrorStatus(response.error),
		});
		authState.set(toUnauthenticatedContext());
		throw response.error;
	}

	authDebug("signIn success");
	try {
		await applySession(response.data.session, "signInWithPassword");
	} finally {
		signInInProgress = false;
		authInitialized = true;
	}
}

export async function signOut(): Promise<void> {
	const supabase = getSupabaseClient();
	const result = await supabase.auth.signOut({ scope: "local" });
	if (result.error) throw result.error;
	contextLoadVersion++;
	authState.set(toUnauthenticatedContext());
	initPromise = null;
	authInitialized = true;
}
