<script lang="ts">
import { tick, onDestroy } from "svelte";
import type { BirthdayLetter } from "@/lib/birthday";
export let letter: BirthdayLetter;
export let preview = false;
export let onRead: () => void = () => {};
export let onClose: () => void = () => {};
let stage: "envelope" | "wish" | "letter" = "envelope";
let heading: HTMLHeadingElement;
let opening = false;
let disposed = false;
onDestroy(() => { disposed = true; });
async function unseal() {
  if (opening) return;
  opening = true;
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) await new Promise(resolve => setTimeout(resolve,420));
  if (!disposed) await next("wish");
}
async function next(value: typeof stage) {
  stage = value;
  await tick();
  heading?.focus({preventScroll:true});
  heading?.scrollIntoView({block:"nearest",behavior:"instant"});
  if (value === "letter" && !preview) onRead();
}
</script>

<div class="birthday-experience" class:is-reading={stage === "letter"} data-stage={stage}>
  <header class="birthday-experience__top"><span>{preview ? "仅你可见 · 惊喜预览" : "09.30 · 专门留给你的一页"}</span><button type="button" on:click={onClose}>{preview ? "退出预览" : "先回手记"} <span aria-hidden="true">×</span></button></header>
  {#if stage === "envelope"}
    <section class="birthday-sealed">
      <p class="birthday-eyebrow">FOR YOU, WITH LOVE</p>
      <h1 tabindex="-1" bind:this={heading}>{letter.recipient_name}，<br />今天，想把这一页交给你。</h1>
      <p>先把忙碌放一放。<br />有一些话，想在今天慢慢说给你听。</p>
      <button class="birthday-envelope" class:is-opening={opening} type="button" aria-label="拆开这份生日心意" on:click={unseal}><span class="birthday-envelope__flap" aria-hidden="true"></span><span class="birthday-envelope__address">致 {letter.recipient_name}</span><span class="birthday-envelope__seal" aria-hidden="true">刘</span><span class="birthday-envelope__hint">亲启 <span aria-hidden="true">↗</span></span></button>
      <span class="birthday-sealed__note">这一次，主角只有你。</span>
    </section>
  {:else if stage === "wish"}
    <section class="birthday-wish">
      <p class="birthday-eyebrow">MAKE A LITTLE WISH</p>
      <h1 tabindex="-1" bind:this={heading}>生日快乐，<br /><span class="birthday-recipient">{letter.recipient_name}。</span></h1>
      <p>在打开信之前，先给自己许一个愿望。<br />不用说出来，留在心里就好。</p>
      <button class="birthday-candle" type="button" aria-label="许好愿了，点灭蜡烛" on:click={() => next("letter")}><span class="birthday-candle__glow" aria-hidden="true"></span><span class="birthday-candle__flame" aria-hidden="true"></span><span class="birthday-candle__wick" aria-hidden="true"></span><span class="birthday-candle__wax" aria-hidden="true"></span><span class="birthday-candle__plate" aria-hidden="true"></span></button>
      <button class="birthday-primary" type="button" on:click={() => next("letter")}>愿望藏好了，打开信 →</button>
      <span class="birthday-sealed__note">愿你新的一岁，多一些开心，也多一些被偏爱。</span>
    </section>
  {:else}
    <section class="birthday-reading">
      <div class="birthday-reading__intro"><span class="birthday-eyebrow">A LETTER, JUST FOR YOU</span><h1 tabindex="-1" bind:this={heading}>有些话，想认真写给你。</h1><p>09 / 30 <span aria-hidden="true">✳</span> 生日快乐</p></div>
      <article class="birthday-letter"><p class="birthday-letter__salutation">亲爱的{letter.recipient_name}：</p><div class="birthday-letter__body">{letter.body.trim() || (preview ? "这里会展示你亲手写下的生日信。\n\n回到准备页面，把想说的话写进去，再预览，就能看到完整效果。" : "")}</div><footer><span>{letter.signature || "写信给你的人"}</span><time datetime="2026-09-30">2026 年 9 月 30 日</time></footer></article>
      <div class="birthday-reading__end"><p>今天的这一页，永远为你留着。</p><span>{preview ? "这只是预览，不会标记她已读，也不会影响正式惊喜。" : "以后想再读，就到「我们」里，重新打开这封信。"}</span><button type="button" class="birthday-primary" on:click={onClose}>{preview ? "回去继续准备" : "把今天也写进手记"} →</button></div>
    </section>
  {/if}
</div>
