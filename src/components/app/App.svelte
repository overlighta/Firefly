<script lang="ts">
import { onMount } from "svelte";
import { authState, initAuth, refreshAuth, signOut } from "@/lib/auth/state";
import { buildLoginPath, getSafeRedirectPath } from "@/lib/auth/redirect";
import { appLocation, installNavigation, navigate, routeName } from "@/lib/navigation";
import { startSpaceRealtime, stopSpaceRealtime } from "@/lib/realtime/space-realtime";
import { notifySpaceChanged } from "@/lib/realtime/invalidation";
import { loadSpaceData } from "@/lib/memory/real-memory";
import { getSupabaseClient } from "@/lib/supabase/client";
import { navIndicator, revealSections } from "@/lib/motion";
import LoginForm from "@/components/auth/LoginForm.svelte";
import Home from "@/components/memory-home/RealMemoryHome.svelte";
import Timeline from "@/components/memory-home/RealTimeline.svelte";
import Memories from "@/components/memory-home/RealMemories.svelte";
import MapPage from "@/components/memory-home/RealMap.svelte";
import Space from "@/components/memory-home/RealSpaceOverview.svelte";
import Detail from "@/components/memory-home/RealMemoryDetail.svelte";
import TopNavMembers from "@/components/memory-home/TopNavMembers.svelte";
import Search from "./Search.svelte";
import Lightbox from "./Lightbox.svelte";
import Icon from "./Icon.svelte";

const links = [
  { key: "home", name: "今天", href: "/" },
  { key: "timeline", name: "时间轴", href: "/timeline/" },
  { key: "memories", name: "回忆", href: "/memories/" },
  { key: "map", name: "足迹", href: "/map/" },
  { key: "space", name: "我们", href: "/space/" },
];
const headings: Record<string, { eyebrow: string; title: string; description: string }> = {
  timeline: { eyebrow: "日子慢慢，记忆长长", title: "时间留下的痕迹", description: "平凡的一天，回头看时，也在发着光。" },
  memories: { eyebrow: "再翻一页", title: "原来，我们记得", description: "某一天的一句话，一张照片，还有当时的心情。" },
  map: { eyebrow: "一起走过的地方", title: "把日子留在地图上", description: "远方值得奔赴，家附近的那条路也值得记住。" },
  space: { eyebrow: "只有我们", title: "两个人，一本生活手记", description: "各自写下的心情，在这里慢慢相遇。" },
  search: { eyebrow: "寻找一段记忆", title: "那一天，藏在哪里", description: "用一句话、一个地点，或者一个日期，找回熟悉的片刻。" },
};
let mounted = false;
let offline = false;
let signingOut = false;
let accountKey = "";
let lastRefresh = 0;
let logoutError = "";
const runtimeId = Math.random().toString(36).slice(2, 10);
$: context = $authState;
$: route = routeName($appLocation);
$: heading = headings[route];
$: if (mounted) {
  document.documentElement.dataset.privateAuth = context.status;
  document.documentElement.dataset.authRuntimeInstance = runtimeId;
  document.title = `${heading?.title ?? (route === "login" ? "登录" : "我们")} · 私人生活手记`;
}
$: if (mounted && context.status === "unauthenticated" && route !== "login" && route !== "missing") {
  navigate(buildLoginPath($appLocation.pathname + $appLocation.search), true);
}
$: if (mounted && context.status === "authenticated" && route === "login") {
  const next = getSafeRedirectPath($appLocation.searchParams.get("next"));
  navigate(routeName(new URL(next, window.location.origin)) === "login" ? "/" : next, true);
}
$: if (mounted) {
  const nextKey = context.status === "authenticated" ? `${context.user?.id}:${context.space?.id}` : "";
  if (nextKey !== accountKey) {
    accountKey = nextKey;
    stopSpaceRealtime();
    if (context.status === "authenticated" && context.space) {
      startSpaceRealtime(context.space.id);
      lastRefresh = Date.now();
      void loadSpaceData(getSupabaseClient(), context.space.id, "timeline").catch(() => {});
    }
  }
}

onMount(() => {
  mounted = true;
  offline = !navigator.onLine;
  const cleanup = installNavigation();
  void initAuth();
  function resume() {
    offline = !navigator.onLine;
    if (!offline && !document.hidden && context.space && Date.now() - lastRefresh > 60_000) {
      lastRefresh = Date.now();
      notifySpaceChanged(context.space.id);
    }
  }
  const updateOffline = () => { offline = true; };
  window.addEventListener("online", resume);
  document.addEventListener("journal:navigate", resume);
  window.addEventListener("offline", updateOffline);
  document.addEventListener("visibilitychange", resume);
  return () => { cleanup(); stopSpaceRealtime(); window.removeEventListener("online", resume); document.removeEventListener("journal:navigate", resume); window.removeEventListener("offline", updateOffline); document.removeEventListener("visibilitychange", resume); };
});
async function logout() {
  signingOut = true; logoutError = "";
  try { await signOut(); navigate("/space/login/", true); }
  catch { logoutError = "暂时无法退出，请再试一次。"; }
  finally { signingOut = false; }
}
</script>

{#if route === "missing"}
  <div class="app-boot"><span class="app-monogram">我们<i></i></span><h1>这一页不在手记里</h1><p>旧博客已下线。新的故事，都从这里开始。</p><a class="app-primary" href="/">回到首页</a></div>
{:else if route === "login" && context.status !== "authenticated"}
  <LoginForm />
{:else if context.status === "authenticated"}
  {#key context.user?.id}
    <div class:memory-app--home={route === "home"} class="memory-app journal-app" data-private-app>
      <a class="skip-link" href="#journal-main">跳到内容</a>
      <div class="journal-masthead"><span>把寻常的日子，写成我们的故事。</span><span><Icon name="lock" /> 私人手记</span></div>
      <div class="memory-app__paper">
        <header class="memory-topnav" data-memory-topnav>
          <a class="memory-brand" href="/" aria-label="我们 · 首页"><strong>我们</strong><i></i><span>生活手记</span></a>
          <nav aria-label="主要导航" use:navIndicator={route}>
            <span class="journal-nav-indicator" aria-hidden="true"></span>
            {#each links as link}
              <a href={link.href} class:is-active={route === link.key || (link.key === "memories" && route === "detail")} aria-current={route === link.key ? "page" : undefined} data-memory-nav-link><Icon name={link.key} /><span>{link.name}</span></a>
            {/each}
          </nav>
          <div class="memory-topnav__actions"><a class="memory-icon-button" href="/search/" aria-label="搜索记忆"><Icon name="search" /></a><TopNavMembers /><button class="journal-signout" on:click={logout} disabled={signingOut}>{signingOut ? "退出中…" : "退出"}</button></div>
        </header>
        {#if offline}<p class="connection-notice" role="status">当前离线。已打开的记录仍可翻阅，恢复连接后会自动同步。</p>{/if}
        {#if logoutError}<p class="connection-notice" role="alert">{logoutError}</p>{/if}
        <main id="journal-main" class="memory-app__content" tabindex="-1" data-memory-page-content use:revealSections={route}>
          {#if heading}{#key route}<header class="memory-page-header"><div><p>{heading.eyebrow}</p><h1>{heading.title}</h1><span>{heading.description}</span></div><small>我们的生活，持续更新中</small></header>{/key}{/if}
          <div hidden={route !== "home"} class="journal-view" data-view="home"><Home /></div>
          <div hidden={route !== "timeline"} class="journal-view" data-view="timeline"><Timeline /></div>
          <div hidden={route !== "memories"} class="journal-view" data-view="memories"><Memories /></div>
          <div hidden={route !== "map"} class="journal-view" data-view="map"><MapPage /></div>
          <div hidden={route !== "space"} class="journal-view" data-view="space"><Space /></div>
          {#if route === "search"}<Search />{/if}
          {#if route === "detail"}{#key $appLocation.pathname + $appLocation.search}<div class="journal-view" data-view="detail"><Detail /></div>{/key}{/if}
        </main>
        <footer class="journal-footer"><span>我们</span><p>慢慢写，慢慢记。<br />让每一个普通的日子，都有迹可循。</p><small>只属于两个人的生活手记</small></footer>
      </div>
    </div>
    <Lightbox />
  {/key}
{:else if context.status === "error" || context.status === "configuration-error"}
  <div class="app-boot" role="alert"><span class="app-monogram">我们<i></i></span><h1>{context.errorMessage ?? "暂时无法打开手记"}</h1><p>请检查网络后重试，或退出并重新登录。</p><div><button class="app-primary" on:click={() => refreshAuth()}>重新连接</button><button class="app-secondary" on:click={logout}>退出登录</button></div></div>
{:else}
  <div class="app-boot" role="status"><span class="app-monogram">我们<i></i></span><div class="boot-line"></div><p>正在翻开这本手记…</p></div>
{/if}
