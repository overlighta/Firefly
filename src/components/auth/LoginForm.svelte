<script lang="ts">
import { authState, signInWithPassword, signOut } from "@/lib/auth/state";
import { loginErrorMessage } from "@/lib/auth/login-error";
let email = "";
let password = "";
let showPassword = false;
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
<div class="journal-login journal-login--scrapbook">
  <section class="login-story" aria-label="我们的生活手记">
    <a class="app-monogram" href="/">我们<i></i></a><span class="login-mobile-tagline">两个人的生活手记</span>
    <div class="login-story__title"><p>THE LITTLE THINGS, TOGETHER.</p><h1>日子很小，<br />值得我们<span>好好收藏。</span></h1><span>把照片、碎碎念和没说完的话，<br />夹进只属于两个人的手帐。</span></div>
    <div class="scrapbook-collage" aria-hidden="true">
      <div class="collage-grid-paper"></div>
      <figure class="collage-postcard"><i class="collage-tape"></i><div class="collage-landscape"><svg viewBox="0 0 320 210" fill="none"><rect width="320" height="210" fill="#e1e5d8"/><circle cx="236" cy="65" r="32" fill="#d9a077"/><path d="M0 126C60 84 97 114 137 125C198 143 230 95 320 110V210H0Z" fill="#a5b198"/><path d="M0 159C91 116 143 171 201 151C254 132 293 154 320 152V210H0Z" fill="#6e846a"/><path d="M102 210C124 166 185 182 198 152" stroke="#e8dfc5" stroke-width="19"/><path d="M34 42H91M34 50H69" stroke="#75806c" stroke-width="1"/></svg></div><figcaption>和你，慢慢走。<small>A LITTLE MOMENT / OURS</small></figcaption></figure>
      <div class="collage-memo"><span>留一页给今天</span><p>平常的一天，<br />也有值得记住的事。</p><i>for you & me</i></div>
      <div class="collage-seal">两人份的<br />小日子<span>PRIVATE COLLECTION</span></div>
      <svg class="collage-sprig" viewBox="0 0 70 140"><path d="M33 134Q35 75 52 8M39 105Q-4 93 14 68Q43 78 39 105M43 79Q74 70 66 46Q39 58 43 79M47 54Q11 43 28 22Q51 32 47 54" fill="#758665" fill-opacity=".65" stroke="#52674d" stroke-width="1.5"/></svg>
    </div>
    <footer><span>文字 · 照片 · 两个视角</span><span>我们的私人收藏册 ↗</span></footer>
  </section>
  <section class="login-form-panel"><div class="login-paper"><div class="login-paper-top"><p class="login-eyebrow">写给我们 / ONLY US</p><span class="login-entry-stamp" aria-hidden="true">私藏</span></div><h2>翻开我们的手帐<span>这一页，等你很久了。</span></h2><p class="login-intro">欢迎回来，继续收藏平常的小日子。</p>
    <form class="login-form" on:submit|preventDefault={submit}>
      <label for="login-email">邮箱<input id="login-email" type="email" inputmode="email" autocapitalize="none" spellcheck={false} autocomplete="username" bind:value={email} required placeholder="你的邮箱" /></label>
      <div class="login-password-field"><label for="login-password">密码</label><div class="login-password-input"><input id="login-password" type={showPassword ? "text" : "password"} autocomplete="current-password" bind:value={password} required placeholder="输入密码" /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} on:click={() => showPassword = !showPassword}>{showPassword ? "隐藏" : "显示"}</button></div></div>
      {#if errorMessage}<p class="login-error" role="alert">{errorMessage}</p>{/if}
      {#if $authState.status === "configuration-error"}<p class="login-error" role="alert">{$authState.errorMessage}<button type="button" on:click={() => signOut()}>退出当前账号</button></p>{/if}
      <button class="app-primary" type="submit" disabled={loading || !email.trim() || !password}>{loading ? "正在打开手记…" : "进入我们的空间"}<span aria-hidden="true">→</span></button>
    </form><p class="login-private-note">只对我们开放 · 每一页都妥善收藏</p>
  </div><small>一点一滴，都是我们。<span aria-hidden="true">✳</span></small></section>
</div>
