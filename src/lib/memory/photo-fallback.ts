export function revealPhotoFallback(element: Element): void {
  if (!(element instanceof HTMLImageElement)) return;
  element.hidden = true;
  const fallback = element.nextElementSibling;
  if (fallback instanceof HTMLElement) fallback.hidden = false;
}
