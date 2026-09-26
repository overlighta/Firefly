import { writable } from "svelte/store";

function currentUrl(): URL {
  return new URL(typeof window === "undefined" ? "https://local.invalid/" : window.location.href);
}
export const appLocation = writable(currentUrl());
const scrollPositions = new Map<string, number>();
export function routeName(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "home";
  if (path === "/space/login") return "login";
  if (/^\/memory(?:\/[0-9a-f-]{36})?$/i.test(path)) return "detail";
  return ({ "/timeline": "timeline", "/memories": "memories", "/map": "map", "/space": "space", "/search": "search" } as Record<string,string>)[path] ?? "missing";
}

function closeDialogs(): void {
  document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach(dialog => dialog.close());
}
export function navigate(href: string, replace = false): void {
  const next = new URL(href, window.location.origin);
  if (next.origin !== window.location.origin) return;
  const previous = window.location.pathname + window.location.search;
  scrollPositions.set(previous, window.scrollY);
  closeDialogs();
  history[replace ? "replaceState" : "pushState"]({}, "", next);
  appLocation.set(next);
  window.scrollTo({ top: 0, behavior: "instant" });
  document.dispatchEvent(new CustomEvent("journal:navigate"));
  requestAnimationFrame(() => document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true }));
}

export function installNavigation(): () => void {
  history.scrollRestoration = "manual";
  function handleClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor || anchor.target || anchor.hasAttribute("download") || anchor.hasAttribute("data-fancybox")) return;
    const next = new URL(anchor.href, window.location.href);
    if (next.origin !== window.location.origin || routeName(next) === "missing") return;
    if (next.hash && next.pathname === window.location.pathname && next.search === window.location.search) return;
    event.preventDefault();
    if (next.href !== window.location.href) navigate(next.href);
  }
  function handlePopState() {
    closeDialogs();
    const next = currentUrl();
    appLocation.set(next);
    document.dispatchEvent(new CustomEvent("journal:navigate"));
    requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.get(next.pathname + next.search) ?? 0, behavior: "instant" }));
  }
  document.addEventListener("click", handleClick);
  window.addEventListener("popstate", handlePopState);
  return () => {
    document.removeEventListener("click", handleClick);
    window.removeEventListener("popstate", handlePopState);
  };
}
