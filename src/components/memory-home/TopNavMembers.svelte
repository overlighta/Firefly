<script lang="ts">
import { authState } from "@/lib/auth/state";

$: members =
	$authState.status === "authenticated"
		? ($authState.space?.members ?? [])
		: [];

function getInitial(name: string | null | undefined) {
	return name?.trim().slice(0, 1).toUpperCase() || "·";
}

function getColor(index: number) {
	return index % 2 === 0 ? "sage" : "blue";
}
</script>

{#if members.length > 0}
	<div class="memory-topnav__users" aria-label="记录者">
		{#each members as member, index (member.userId)}
			<span
				class={`memory-avatar memory-avatar--${getColor(index)} memory-avatar--small`}
				title={member.profile?.displayName ?? "成员"}
			>
				<span aria-hidden="true">{getInitial(member.profile?.displayName)}</span>
			</span>
		{/each}
	</div>
{/if}
