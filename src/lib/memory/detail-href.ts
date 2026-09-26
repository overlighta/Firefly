export function getMemoryDetailHref(memoryId: string): string {
  return `/memory/${encodeURIComponent(memoryId)}/`;
}
