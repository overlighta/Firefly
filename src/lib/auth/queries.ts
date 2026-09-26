import type { User } from "@supabase/supabase-js";

import {
	authDebug,
	getErrorCode,
	getErrorMessage,
	getPerfDuration,
	getPerfTime,
	perfDebug,
} from "@/lib/auth/debug";
import { mapProfile } from "@/lib/memory/mapper";
import type { BrowserSupabaseClient } from "@/lib/supabase/client";
import type { Space, SpaceMember, UserProfile } from "@/types/memory";

export type AuthConfigurationCode =
	| "missing-profile"
	| "missing-membership"
	| "missing-space"
	| "profile-query-failed"
	| "membership-query-failed"
	| "space-query-failed"
	| "members-query-failed";

export class AuthConfigurationError extends Error {
	readonly code: AuthConfigurationCode;

	constructor(code: AuthConfigurationCode, message: string) {
		super(message);
		this.name = "AuthConfigurationError";
		this.code = code;
	}
}

export interface CurrentUserContext {
	profile: UserProfile;
	space: Space;
	members: UserProfile[];
}

export async function loadCurrentUserContext(
	supabase: BrowserSupabaseClient,
	user: User,
): Promise<CurrentUserContext> {
	const totalStartedAt = getPerfTime();
	const profileStartedAt = getPerfTime();
	const [profileResponse, membershipResponse] = await Promise.all([supabase
		.from("profiles")
		.select("*")
		.eq("id", user.id)
		.maybeSingle(), supabase
		.from("space_members")
		.select("space_id,user_id,joined_at")
		.eq("user_id", user.id)
		.limit(1)
		.maybeSingle()]);
	perfDebug("profile duration", {
		ms: getPerfDuration(profileStartedAt),
		status: profileResponse.status,
	});

	if (profileResponse.error) {
		authDebug("profile: failed", {
			code: getErrorCode(profileResponse.error),
			message: getErrorMessage(profileResponse.error),
			status: profileResponse.status,
		});
		throw new AuthConfigurationError(
			"profile-query-failed",
			"Unable to load profile for current user.",
		);
	}

	if (!profileResponse.data) {
		authDebug("profile: missing", { status: profileResponse.status });
		throw new AuthConfigurationError(
			"missing-profile",
			"Missing profile for current auth user.",
		);
	}

	authDebug("profile: found", { status: profileResponse.status });
	const profile = mapProfile(profileResponse.data);

	const membershipStartedAt = getPerfTime();
	perfDebug("membership duration", {
		ms: getPerfDuration(membershipStartedAt),
		status: membershipResponse.status,
	});

	if (membershipResponse.error) {
		authDebug("membership: failed", {
			code: getErrorCode(membershipResponse.error),
			message: getErrorMessage(membershipResponse.error),
			status: membershipResponse.status,
		});
		throw new AuthConfigurationError(
			"membership-query-failed",
			"Unable to load space membership for current user.",
		);
	}

	if (!membershipResponse.data) {
		authDebug("membership: missing", { status: membershipResponse.status });
		throw new AuthConfigurationError(
			"missing-membership",
			"Current user is not a member of a private space.",
		);
	}

	authDebug("membership: found", { status: membershipResponse.status });
	const spaceStartedAt = getPerfTime();
	const [spaceResponse, membershipsResponse] = await Promise.all([supabase
		.from("spaces")
		.select("*")
		.eq("id", membershipResponse.data.space_id)
		.maybeSingle(), supabase
		.from("space_members")
		.select("space_id,user_id,joined_at")
		.eq("space_id", membershipResponse.data.space_id)]);
	perfDebug("space duration", {
		ms: getPerfDuration(spaceStartedAt),
		status: spaceResponse.status,
	});

	if (spaceResponse.error) {
		authDebug("space: failed", {
			code: getErrorCode(spaceResponse.error),
			message: getErrorMessage(spaceResponse.error),
			status: spaceResponse.status,
		});
		throw new AuthConfigurationError(
			"space-query-failed",
			"Unable to load private space.",
		);
	}

	if (!spaceResponse.data) {
		authDebug("space: missing", { status: spaceResponse.status });
		throw new AuthConfigurationError(
			"missing-space",
			"Private space membership points to a missing space.",
		);
	}

	authDebug("space: found", { status: spaceResponse.status });
	const membersStartedAt = getPerfTime();

	if (membershipsResponse.error) {
		authDebug("memberships: failed", {
			code: getErrorCode(membershipsResponse.error),
			message: getErrorMessage(membershipsResponse.error),
			status: membershipsResponse.status,
		});
		throw new AuthConfigurationError(
			"members-query-failed",
			"Unable to load private space members.",
		);
	}

	const memberships = membershipsResponse.data ?? [];
	const memberIds = memberships.map((membership) => membership.user_id);
	const profilesResponse =
		memberIds.length > 0
			? await supabase.from("profiles").select("*").in("id", memberIds)
			: { data: [], error: null, status: 200 };
	perfDebug("members duration", {
		ms: getPerfDuration(membersStartedAt),
		status: profilesResponse.status,
	});

	if (profilesResponse.error) {
		authDebug("member profiles: failed", {
			code: getErrorCode(profilesResponse.error),
			message: getErrorMessage(profilesResponse.error),
			status: profilesResponse.status,
		});
		throw new AuthConfigurationError(
			"members-query-failed",
			"Unable to load private space member profiles.",
		);
	}

	const profiles = (profilesResponse.data ?? []).map(mapProfile);
	authDebug("members count", { status: profilesResponse.status });
	authDebug(`members count: ${profiles.length}`);
	perfDebug("auth data queries total", { ms: getPerfDuration(totalStartedAt) });
	const profilesById = new Map(profiles.map((item) => [item.id, item]));
	const spaceMembers: SpaceMember[] = memberships.map((membership) => ({
		joinedAt: membership.joined_at,
		profile: profilesById.get(membership.user_id) ?? null,
		spaceId: membership.space_id,
		userId: membership.user_id,
	}));

	return {
		members: profiles,
		profile,
		space: {
			createdAt: spaceResponse.data.created_at,
			createdBy: spaceResponse.data.created_by,
			id: spaceResponse.data.id,
			members: spaceMembers,
			name: spaceResponse.data.name,
			updatedAt: spaceResponse.data.updated_at,
		},
	};
}
