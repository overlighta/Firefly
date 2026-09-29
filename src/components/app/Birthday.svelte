<script lang="ts">
import { onMount, tick } from "svelte";
import { authState } from "@/lib/auth/state";
import { navigate } from "@/lib/navigation";
import { birthdayLetter, readBirthday, saveBirthday, shouldOfferBirthday, birthdayTimeLabel, type BirthdayLetter } from "@/lib/birthday";
import { getSupabaseClient } from "@/lib/supabase/client";
import BirthdayExperience from "./BirthdayExperience.svelte";

export let active = false;
let letter: BirthdayLetter | null = null;
let loading = true;
let loadError = "";
let body = "";
let signature = "";
let saving = false;
let saveMessage = "";
let saveError = "";
let readingError = "";
let readingInFlight = false;
let dialog: HTMLDialogElement;
let showing = false;
let preview = false;
let offered = false;
let disposed = false;
let fetching = false;
let previewLetter: BirthdayLetter | null = null;
let previouslyActive = false;
$: context = $authState;
$: sender = Boolean(letter && letter.sender_id === context.user?.id);
$: dirty = sender && Boolean(letter && (body !== letter.body || signature !== letter.signature));
$: if (active && !previouslyActive) { previouslyActive = true; if (!loading) void enterPage(); }
$: if (!active) previouslyActive = false;

onMount(() => {
  birthdayLetter.set(null);
  void load();
  const resume = () => { if (!document.hidden && navigator.onLine) { if (!letter) void load(); else void offer(); } };
  // Keeps an already logged-in tab eligible when midnight or publication arrives.
  const timer = setInterval(resume, 60_000);
  const warnUnsaved = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  window.addEventListener("beforeunload", warnUnsaved);
  return () => { disposed = true; clearInterval(timer); birthdayLetter.set(null); dialog?.close(); document.removeEventListener("visibilitychange",resume); window.removeEventListener("online",resume); window.removeEventListener("beforeunload",warnUnsaved); };
});

async function load() {
  if (disposed || fetching || !context.space?.id) return;
  fetching = true;
  try {
    const result = await readBirthday(getSupabaseClient(), context.space.id);
    if (disposed) return;
    letter = result;
    birthdayLetter.set(result);
    if (result && result.sender_id === context.user?.id) { body = result.body; signature = result.signature; }
    loadError = "";
  } catch { if (!disposed) loadError = "生日信暂时无法连接。请检查网络，并确认生日信数据库已配置完成。"; }
  finally { fetching = false; if (!disposed) { loading = false; if (active) void enterPage(); else void offer(); } }
}
async function offer() {
  if (disposed || offered || showing || !shouldOfferBirthday(letter, context.user?.id ?? "") || document.querySelector("dialog[open]")) return;
  await open(false);
}
async function enterPage() {
  if (letter && letter.recipient_id === context.user?.id && !showing) await open(false);
}
async function open(isPreview: boolean) {
  if (!letter || disposed) return;
  preview = isPreview;
  previewLetter = isPreview ? {...letter, body, signature} : letter;
  readingError = "";
  showing = true;
  if (!isPreview) offered = true;
  await tick();
  if (disposed || !dialog) return;
  if (!dialog.open) dialog.showModal();
}
function closed() {
  if (disposed) return;
  showing = false;
  previewLetter = null;
  if (active && !sender) navigate("/space/",true);
}
async function save(ready: boolean) {
  if (!letter || !sender || saving) return;
  saving = true; saveMessage = ""; saveError = "";
  try {
    const saved = await saveBirthday(getSupabaseClient(),letter,body,signature,ready);
    if (disposed) return;
    letter = saved; body = saved.body; signature = saved.signature; birthdayLetter.set(saved);
    saveMessage = ready ? "已经准备好。到时间后，她登录就会收到这份心意。" : "已保存为私密草稿，尚未启用生日惊喜。";
  } catch(error) { if (!disposed) saveError = error instanceof Error ? error.message : "保存失败，请稍后重试。"; }
  finally { if (!disposed) saving = false; }
}
async function read() {
  if (!letter || preview || sender || letter.opened_at || readingInFlight) return;
  readingInFlight = true;
  try {
    const result = await getSupabaseClient().rpc("open_birthday_letter",{letter_id:letter.id});
    if (result.error) throw result.error;
    if (!disposed && letter) { letter = {...letter,opened_at:result.data}; birthdayLetter.set(letter); readingError = ""; }
  } catch { if (!disposed) readingError = "信可以继续读，阅读状态暂未同步。下次登录可能会再次收到提醒。"; }
  finally { readingInFlight = false; }
}
</script>

{#if active}
  {#if loading}<section class="memory-real-state"><h1>正在打开这一页…</h1></section>
  {:else if loadError}<section class="memory-real-state"><h1>暂时还没能打开。</h1><p>{loadError}</p><button type="button" on:click={load}>重新连接</button><a href="/space/">回到我们</a></section>
  {:else if sender && letter}
    <section class="birthday-editor">
      <header><p class="birthday-eyebrow">只给你看的准备页</p><h1>把想对{letter.recipient_name}说的话，<br />亲手写在这里。</h1><p>解锁时间：{birthdayTimeLabel(letter.opens_at)}（北京时间）</p></header>
      <div class="birthday-editor__status" class:is-ready={letter.is_ready}><strong>{letter.is_ready ? "已准备好送出" : "私密草稿 · 尚未送出"}</strong><span>{letter.opened_at ? "她已经打开过这封信，之后仍可重读。" : letter.is_ready ? "到时间后，她首次登录或回到已登录的网页时，会收到惊喜。" : "先保存你的信，再点击「准备好了」。未启用时，她不会看到这封信。"}</span></div>
      <label for="birthday-body">写给她的生日信 <small>{body.length.toLocaleString()} / 20,000</small></label>
      <p class="birthday-editor__salutation">亲爱的小刘老师：</p>
      <textarea id="birthday-body" bind:value={body} maxlength="20000" rows="14" disabled={saving} placeholder={"从这里写正文，称呼和末尾日期会自动排好。\n写下你的话就好，不需要任何格式。"}></textarea>
      <label for="birthday-signature">你的署名</label><input id="birthday-signature" bind:value={signature} maxlength="80" disabled={saving} autocomplete="off" />
      <p class="birthday-editor__hint">{dirty ? "有修改还未保存。" : "预览可以反复看，不会标记她已读，也不会用掉正式的惊喜。"}</p>
      {#if saveMessage}<p class="birthday-editor__notice" role="status">{saveMessage}</p>{/if}
      {#if saveError}<p class="birthday-editor__error" role="alert">{saveError}</p>{/if}
      <div class="birthday-editor__actions"><button type="button" class="birthday-secondary" disabled={saving} on:click={() => save(letter?.is_ready ?? false)}>{saving ? "正在保存…" : letter.is_ready ? "保存修改" : "保存草稿"}</button><button type="button" class="birthday-secondary" disabled={saving} on:click={() => open(true)}>预览惊喜</button>{#if !letter.is_ready}<button type="button" class="birthday-primary" disabled={saving || !body.trim()} on:click={() => save(true)}>准备好了，生日送给她</button>{:else}<button type="button" class="birthday-pause" disabled={saving} on:click={() => save(false)}>暂停送出，改为草稿</button>{/if}</div>
      <a class="birthday-editor__back" href="/space/">← 回到我们</a>
    </section>
  {:else if !letter}<section class="memory-real-empty"><h1>这一页，暂时还没有内容。</h1><a href="/space/">回到我们</a></section>{/if}
{/if}

<dialog class="birthday-dialog" bind:this={dialog} aria-label={preview ? "生日惊喜预览" : "给小刘老师的生日心意"} on:close={closed}>
  {#if showing && previewLetter}<BirthdayExperience letter={previewLetter} {preview} onRead={read} onClose={() => dialog.close()} />{/if}
  {#if readingError}<p class="birthday-reading-error" role="status">{readingError}<button type="button" on:click={read} disabled={readingInFlight}>重试同步</button></p>{/if}
</dialog>
