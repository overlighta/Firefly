<script lang="ts">
import { authState, signInWithPassword, signOut } from "@/lib/auth/state";
import { loginErrorMessage } from "@/lib/auth/login-error";
let email = "";
let password = "";
let loading = false;
let errorMessage = "";
async function submit() {
  if (loading) return;
  loading = true; errorMessage = "";
  try { await signInWithPassword(email.trim(), password); }
  catch (error) { errorMessage = loginErrorMessage(error, navigator.onLine); }
  finally { loading = false; }
}
</script>
<div class="journal-login">
  <section class="login-story" aria-label="我们的生活手记">
    <a class="app-monogram" href="/">我们<i></i></a>
    <div class="login-story__title"><p>两个人的生活手记</p><h1>把日子写下来，<br />让记忆慢一点。</h1><span>一段文字，一张照片。<br />还有那些，只有我们才懂的小事。</span></div>
    <div class="login-illustration" aria-hidden="true"><div class="paper-note"><span>今日，宜记录。</span><i></i><i></i><i></i><small>平凡也值得珍藏。</small></div><div class="paper-stamp">我们<br /><small>生活手记</small></div><div class="paper-leaf"></div></div>
    <footer>只属于我们的故事，不必向世界公开。</footer>
  </section>
  <section class="login-form-panel"><div><p class="login-eyebrow">欢迎回来</p><h2>翻开我们的这一页</h2><p class="login-intro">登录后，继续写下属于两个人的生活。</p>
    <form class="login-form" on:submit|preventDefault={submit}>
      <label for="login-email">邮箱<input id="login-email" type="email" autocomplete="username" bind:value={email} required placeholder="你的邮箱" /></label>
      <label for="login-password">密码<input id="login-password" type="password" autocomplete="current-password" bind:value={password} required placeholder="输入密码" /></label>
      {#if errorMessage}<p class="login-error" role="alert">{errorMessage}</p>{/if}
      {#if $authState.status === "configuration-error"}<p class="login-error" role="alert">{$authState.errorMessage}<button type="button" on:click={() => signOut()}>退出当前账号</button></p>{/if}
      <button class="app-primary" type="submit" disabled={loading || !email.trim() || !password}>{loading ? "正在打开手记…" : "进入我们的空间"}<span aria-hidden="true">→</span></button>
    </form><p class="login-private-note">私密的空间，熟悉的两个人。</p>
  </div><small>慢慢生活，认真记录。</small></section>
</div>
