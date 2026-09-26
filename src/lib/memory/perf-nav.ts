export function perfNavMark(name: string, detail?: Record<string, unknown>): void {
  if (import.meta.env.DEV) console.info(`[PERF] ${name}`, detail ?? {});
}
