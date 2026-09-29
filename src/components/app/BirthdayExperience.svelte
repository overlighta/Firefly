<script lang="ts">
import { tick, onMount, onDestroy } from "svelte";
import type { BirthdayLetter } from "@/lib/birthday";
import { createBirthdayMusic, type BirthdayMusicState } from "@/lib/birthday-music";
export let letter: BirthdayLetter;
export let preview = false;
export let onRead: () => void = () => {};
export let onClose: () => void = () => {};
let stage: "envelope" | "wish" | "letter" = "envelope";
let heading: HTMLHeadingElement;
let opening = false;
let extinguishing = false;
let disposed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let music: ReturnType<typeof createBirthdayMusic> | undefined;
let musicState: BirthdayMusicState = "idle";
$: musicLabel = musicState === "playing" ? "暂停音乐" : musicState === "loading" ? "取消音乐加载" : musicState === "error" ? "重试音乐" : "播放音乐";
onMount(() => {
  music = createBirthdayMusic(value => { musicState = value; });
  return () => music?.dispose();
});
onDestroy(() => { disposed = true; clearTimeout(timer); });
function advance(value: typeof stage) {
  if (opening || extinguishing || disposed) return;
  if (value === "wish") { opening = true; music?.start(); }
  else extinguishing = true;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) void next(value);
  else timer = setTimeout(() => { if (!disposed) void next(value); }, value === "wish" ? 480 : 650);
}
async function next(value: typeof stage) {
  if (disposed) return;
  stage = value;
  if (value !== "envelope") music?.setScene(value);
  opening = false;
  extinguishing = false;
  await tick();
  if (disposed) return;
  heading?.focus({preventScroll:true});
  heading?.closest("dialog")?.scrollTo({top:0,behavior:"instant"});
  if (value === "letter" && !preview) onRead();
}
</script>

<div class="birthday-experience" class:is-reading={stage === "letter"} data-stage={stage}>
  <header class="birthday-experience__top">
    <span>{preview ? "仅你可见 · 惊喜预览" : "09.30 · 专门留给你的一页"}</span>
    <div class="birthday-chapters" aria-label="生日心意进度"><span class:is-current={stage === "envelope"} aria-current={stage === "envelope" ? "step" : undefined}>相见</span><i aria-hidden="true"></i><span class:is-current={stage === "wish"} aria-current={stage === "wish" ? "step" : undefined}>许愿</span><i aria-hidden="true"></i><span class:is-current={stage === "letter"} aria-current={stage === "letter" ? "step" : undefined}>读信</span></div>
    <div class="birthday-experience__actions">
      {#if stage !== "envelope"}<button class="birthday-music" class:is-playing={musicState === "playing"} type="button" aria-label={musicLabel} on:click={() => music?.toggle()}><span class="birthday-music__bars" aria-hidden="true"><i></i><i></i><i></i></span><span>{musicState === "playing" ? "音乐轻放" : musicState === "loading" ? "加载中" : musicState === "error" ? "重试音乐" : musicState === "blocked" ? "轻点播放" : "播放音乐"}</span></button>{/if}
      <button type="button" on:click={onClose}>{preview ? "退出预览" : "先回手记"} <span aria-hidden="true">×</span></button>
    </div>
  </header>
  {#if stage === "envelope"}
    <section class="birthday-sealed">
      <div class="birthday-welcome-copy">
        <div class="birthday-dateline"><span class="birthday-date-stamp"><b>09.30</b><small>属于你的日子</small></span><span class="birthday-eyebrow">FOR YOU,<br />WITH LOVE</span></div>
        <h1 tabindex="-1" bind:this={heading}><span class="birthday-greeting">{letter.recipient_name}，</span>今天的偏爱，<br />都留给你。</h1>
        <p>先把忙碌放一放。<br />你熟悉的小伙伴，和我想说的话，<br class="birthday-desktop-break" />都在这里等你。</p>
      </div>
      <figure class="birthday-friends">
        <span class="birthday-friends__spark birthday-friends__spark--one" aria-hidden="true">✳</span><span class="birthday-friends__spark birthday-friends__spark--two" aria-hidden="true">✧</span>
        <img src="/images/birthday-companions-v1.webp" width="1200" height="800" alt="围着蓝格围巾的小猫、戴小熊帽的女孩和紫发猫耳玩偶，依偎着坐在一起" decoding="async" fetchpriority="high" />
        <figcaption><span aria-hidden="true">♡</span> 今天，我们都来陪你过生日。</figcaption>
      </figure>
      <div class="birthday-delivery">
        <button class="birthday-envelope" class:is-opening={opening} type="button" aria-label="拆开这份生日心意" aria-disabled={opening} on:click={() => advance("wish")}>
          <span class="birthday-envelope__flap" aria-hidden="true"></span>
          <span class="birthday-envelope__address"><small>有些话，只想说给你听</small>致 {letter.recipient_name}</span>
          <span class="birthday-envelope__seal" aria-hidden="true">♡</span>
          <span class="birthday-envelope__hint">轻轻拆开 <span aria-hidden="true">↗</span></span>
        </button>
        <span class="birthday-sealed__note">一封信，一点偏心，还有好多喜欢。</span>
      </div>
    </section>
  {:else if stage === "wish"}
    <section class="birthday-wish" class:is-extinguishing={extinguishing}>
      <span class="birthday-wish__orbit" aria-hidden="true"></span>
      <p class="birthday-eyebrow">A LITTLE WISH, A NEW CHAPTER</p>
      <h1 tabindex="-1" bind:this={heading}>生日快乐，<br /><span class="birthday-recipient">{letter.recipient_name}。</span></h1>
      <p>闭上眼睛，把愿望悄悄藏好。<br />这一小束光，正在认真听。</p>
      <div class="birthday-wish__scene">
        <span class="birthday-wish__aside" aria-hidden="true">愿你被爱包围</span>
        <button class="birthday-candle" type="button" aria-label="许好愿了，点灭蜡烛" aria-disabled={extinguishing} on:click={() => advance("letter")}><span class="birthday-candle__glow" aria-hidden="true"></span><span class="birthday-candle__flame" aria-hidden="true"></span><span class="birthday-candle__smoke" aria-hidden="true"></span><span class="birthday-candle__wick" aria-hidden="true"></span><span class="birthday-candle__wax" aria-hidden="true"></span><span class="birthday-candle__plate" aria-hidden="true"></span></button>
        <span class="birthday-wish__aside" aria-hidden="true">也自由地发光</span>
      </div>
      <button class="birthday-primary" type="button" aria-disabled={extinguishing} on:click={() => advance("letter")}>愿望藏好了，打开信 →</button>
      <span class="birthday-sealed__note">也可以轻点烛光，让愿望出发。</span>
      <p class="birthday-wish__closing">新的一岁，<br />愿你继续做自在又明亮的自己。</p>
    </section>
  {:else}
    <section class="birthday-reading">
      <div class="birthday-reading__intro"><span class="birthday-eyebrow">A LETTER, JUST FOR YOU</span><h1 tabindex="-1" bind:this={heading}>把心里话，<br class="birthday-mobile-break" />慢慢说给你听。</h1><p>09 / 30 <span aria-hidden="true">✳</span> 生日快乐</p></div>
      <div class="birthday-letter-wrap"><span class="birthday-letter__tape" aria-hidden="true"></span><article class="birthday-letter"><p class="birthday-letter__salutation">亲爱的{letter.recipient_name}：</p><div class="birthday-letter__body">{letter.body.trim() || (preview ? "这里会展示你亲手写下的生日信。\n\n回到准备页面，把想说的话写进去，再预览，就能看到完整效果。" : "")}</div><footer><span>{letter.signature || "写信给你的人"}</span><time datetime="2026-09-30">2026 年 9 月 30 日</time></footer><span class="birthday-letter__heart" aria-hidden="true">♡</span></article></div>
      <div class="birthday-reading__end"><span class="birthday-end-flower" aria-hidden="true">✳</span><p>今天的这一页，永远为你留着。</p><span>{preview ? "这只是预览，不会标记她已读，也不会影响正式惊喜。" : "以后想再读，就到「我们」里，重新打开这封信。"}</span><button type="button" class="birthday-primary" on:click={onClose}>{preview ? "回去继续准备" : "把今天也写进手记"} →</button></div>
    </section>
  {/if}
  {#if stage !== "envelope"}<p class="birthday-music-credit"><a href="https://www.scottbuckley.com.au/library/growing-up/" target="_blank" rel="noreferrer" title="网页版本已压缩，并加入首尾淡入淡出；完整来源见音乐说明">Growing Up · Scott Buckley</a><span aria-hidden="true"> · </span><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a><span aria-hidden="true"> · </span><a href="/audio/credits.txt" target="_blank" rel="noreferrer">音乐说明</a></p>{/if}
</div>
