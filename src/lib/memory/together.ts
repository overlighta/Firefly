import type { Memory } from "@/types/memory";

export function writtenBy(memory: Memory, userId: string) {
  return memory.perspectives.some(item => item.userId === userId && item.content.trim().length > 0);
}

export function togetherSummary(items: Memory[], memberIds: string[], currentUserId: string) {
  const memories = [...items].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const ids = [...new Set(memberIds)];
  const days = [...new Set(memories.map(item => item.date))];
  return {
    memories,
    days,
    months: [...new Set(days.map(date => date.slice(0, 7)))],
    first: memories.at(-1) ?? null,
    shared: ids.length >= 2 ? memories.filter(item => ids.every(id => writtenBy(item, id))) : [],
    waiting: ids.includes(currentUserId) ? memories.filter(item => !writtenBy(item, currentUserId) && ids.some(id => id !== currentUserId && writtenBy(item, id))) : [],
  };
}

export function monthDays(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, index] = month.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(year, index - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
}
