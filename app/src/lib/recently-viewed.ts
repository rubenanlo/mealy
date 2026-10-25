import AsyncStorage from '@react-native-async-storage/async-storage';

/** How many opened recipes we remember per user (Home shows the first 10). */
export const RECENTLY_VIEWED_MAX = 30;

const keyFor = (userId: string) => `mealy.recently-viewed.${userId}`;

/** Pure rule: move `id` to the front, drop duplicates, cap the list. */
export function pushRecentlyViewed(
  ids: string[],
  id: string,
  max = RECENTLY_VIEWED_MAX,
): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, max);
}

/** Viewed recipes in view order, skipping ids that no longer exist. */
export function resolveRecentlyViewed<T extends { id: string }>(
  ids: string[],
  recipes: T[],
): T[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is T => r !== undefined);
}

/** Per-user, per-device history (NYT "Recently viewed" is also local). */
export async function loadRecentlyViewed(userId: string): Promise<string[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

export async function recordRecentlyViewed(userId: string, id: string): Promise<void> {
  if (!userId || !id) return;
  const next = pushRecentlyViewed(await loadRecentlyViewed(userId), id);
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next)).catch(() => {});
}
