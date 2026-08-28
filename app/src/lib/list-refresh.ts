/**
 * Cross-screen staleness signal. A mutation that changes another screen's
 * list (deleting a recipe, adding/removing a meal) marks that list dirty;
 * the list screen consumes the flag on its next focus load and shows a
 * spinner instead of flashing the stale rows. Plain focus refetches (no
 * flag) keep the current content visible while revalidating.
 */

export type ListKey = 'library' | 'plan' | 'groceries';

const dirty = new Set<ListKey>();

export function invalidateLists(...keys: ListKey[]): void {
  for (const key of keys) dirty.add(key);
}

/** True once per invalidation: the caller should reset to its loading state. */
export function consumeInvalidation(key: ListKey): boolean {
  return dirty.delete(key);
}
