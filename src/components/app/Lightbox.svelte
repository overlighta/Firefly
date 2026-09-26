<script lang="ts">
import { onMount, tick } from "svelte";
let dialog: HTMLDialogElement;
let photos: { src: string; alt: string }[] = [];
let index = 0;
function step(offset: number) { index = (index + offset + photos.length) % photos.length; }
function keydown(event: KeyboardEvent) {
  if (!dialog?.open) return;
  if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
  if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
}
onMount(() => {
  async function open(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-fancybox]") : null;
    if (!anchor) return;
    event.preventDefault();
    const group = anchor.dataset.fancybox;
    const view = anchor.closest("[data-view]");
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-fancybox]")].filter(item => item.dataset.fancybox === group && item.closest("[data-view]") === view);
    photos = links.map(item => ({ src: item.href, alt: item.querySelector("img")?.alt || "记忆照片" }));
    index = Math.max(0, links.indexOf(anchor));
    await tick(); dialog.showModal();
  }
  document.addEventListener("click", open);
  return () => document.removeEventListener("click", open);
});
</script>
<svelte:window on:keydown={keydown} />
<dialog class="journal-lightbox" bind:this={dialog} aria-label="照片查看器">
  <header><span>{index + 1} / {photos.length}</span><button type="button" on:click={() => dialog.close()} aria-label="关闭照片">关闭 ×</button></header>
  {#if photos[index]}{#key photos[index].src}<img src={photos[index].src} alt={photos[index].alt} />{/key}{/if}
  {#if photos.length > 1}<div><button type="button" on:click={() => step(-1)} aria-label="上一张">←</button><button type="button" on:click={() => step(1)} aria-label="下一张">→</button></div>{/if}
</dialog>
