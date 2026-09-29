<script lang="ts">
import { birthdayLetter } from "@/lib/birthday";
import { authState } from "@/lib/auth/state";
$: letter = $birthdayLetter;
</script>
{#if letter}
  <a class="birthday-entry" href="/birthday/"><span aria-hidden="true">✳</span><div><strong>{letter.sender_id === $authState.user?.id ? "给小刘老师的生日准备" : "9 月 30 日 · 留给你的生日信"}</strong><small>{letter.sender_id === $authState.user?.id ? "写信、保存，或者亲自预览一次惊喜" : "这份心意，随时可以再打开"}</small></div><span>{letter.sender_id === $authState.user?.id ? "去准备" : "重读这封信"} ↗</span></a>
{/if}
