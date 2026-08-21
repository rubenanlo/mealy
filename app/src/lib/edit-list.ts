/** Non-mutating list edit helpers for the inline editors (spec Part 5). */

export function updateItem<T>(list: readonly T[], index: number, value: T): T[] {
  const next = [...list];
  next[index] = value;
  return next;
}

export function removeItem<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
