import { writable } from "svelte/store";
import type { Database } from "@/types/database";
import type { BrowserSupabaseClient } from "@/lib/supabase/client";

export type BirthdayLetter = Database["public"]["Tables"]["birthday_letters"]["Row"];
export const birthdayLetter = writable<BirthdayLetter | null>(null);
export const BIRTHDAY_OCCASION = "birthday-2026-09-30";

// Availability is enforced by Postgres RLS and its clock, never the browser date.
export async function readBirthday(client: BrowserSupabaseClient, spaceId: string) {
  const result = await client.from("birthday_letters").select("*").eq("space_id", spaceId).eq("occasion_key", BIRTHDAY_OCCASION).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}
export async function saveBirthday(client: BrowserSupabaseClient, letter: BirthdayLetter, body: string, signature: string, ready: boolean) {
  if (ready && !body.trim()) throw new Error("先写下你的生日信，再准备送出。");
  if (body.length > 20000 || signature.length > 80) throw new Error("信件或署名超过了长度限制。");
  // Reading/opening state and recipient configuration cannot be changed by the editor.
  const result = await client.from("birthday_letters").update({body, signature: signature.trim(), is_ready: ready}).eq("id", letter.id).eq("updated_at", letter.updated_at).select("*").maybeSingle();
  if (result.error) throw new Error("暂时没能保存，请检查网络后再试。你的文字仍留在输入框里。");
  if (!result.data) throw new Error("这封信已在其他页面更新。请先复制当前文字，再刷新页面核对，避免覆盖修改。");
  return result.data;
}
export function shouldOfferBirthday(letter: BirthdayLetter | null, userId: string) {
  return Boolean(letter && letter.recipient_id === userId && letter.is_ready && !letter.opened_at);
}
export function birthdayTimeLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai",year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
}
