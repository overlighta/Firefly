import { get } from "svelte/store";
import { authState } from "@/lib/auth/state";
import { spaceDataVersion } from "@/lib/realtime/invalidation";

const entries = new Map<string, { data: unknown; version: number; at: number }>();
const inFlight = new Map<string, Promise<unknown>>();
const signedUrls = new Map<string, { url: string; expiresAt: number }>();
let epoch = 0;
export const SPACE_DATA_TTL_MS = 60_000;
export const DETAIL_TTL_MS = 60_000;
export function currentDataVersion(): number { return get(spaceDataVersion).version; }
export function currentCacheEpoch(): number { return epoch; }

/** Every result is tied to the account and data version at query start. */
export function loadMemoryQuery<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const entry = entries.get(key);
  if (entry && entry.version === currentDataVersion() && Date.now() - entry.at < SPACE_DATA_TTL_MS) return Promise.resolve(entry.data as T);
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;
  const startedEpoch = epoch;
  const promise = (async () => {
    let result: T;
    let version: number;
    do {
      version = currentDataVersion();
      result = await loader();
      if (epoch !== startedEpoch) throw new DOMException("Account changed", "AbortError");
      // An event received while reading must cause another read, never bless an old snapshot.
    } while (version !== currentDataVersion());
    entries.set(key, { data: result, version, at: Date.now() });
    if (entries.size > 60) entries.delete(entries.keys().next().value!);
    return result;
  })();
  inFlight.set(key, promise);
  const cleanup = () => { if (inFlight.get(key) === promise) inFlight.delete(key); };
  // Use both handlers: an ignored finally() would create an unhandled rejection.
  void promise.then(cleanup, cleanup);
  return promise;
}

export function getCachedSignedUrls(paths: string[]): { urls: Map<string,string>; missing: string[] } {
  const urls = new Map<string,string>();
  const missing: string[] = [];
  for (const path of paths) {
    const item = signedUrls.get(path);
    if (item && item.expiresAt - Date.now() > 5 * 60_000) urls.set(path, item.url);
    else missing.push(path);
  }
  return { urls, missing };
}
export function setCachedSignedUrls(pairs: Iterable<[string,string]>, startedEpoch = epoch): void {
  if (startedEpoch !== epoch) return;
  for (const [path, url] of pairs) signedUrls.set(path, { url, expiresAt: Date.now() + 30 * 60_000 });
  for (const [path, value] of signedUrls) if (value.expiresAt <= Date.now()) signedUrls.delete(path);
  while (signedUrls.size > 300) signedUrls.delete(signedUrls.keys().next().value!);
}
export function clearAllMemoryCaches(): void {
  epoch++; entries.clear(); inFlight.clear(); signedUrls.clear();
}
let accountKey = "";
if (typeof window !== "undefined") authState.subscribe(context => {
  const next = context.status === "authenticated" ? `${context.user?.id}:${context.space?.id}` : "";
  if (next !== accountKey) { clearAllMemoryCaches(); accountKey = next; }
});
