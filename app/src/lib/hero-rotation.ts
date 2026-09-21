const WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic hero pick: steps through the suggestion pool once every
 * 3 days (UTC), so the highlighted recipe rotates without any scheduler.
 */
export function pickHeroIndex(poolSize: number, now = Date.now()): number {
  if (poolSize <= 1) return 0;
  const window = Math.floor(now / DAY_MS / WINDOW_DAYS);
  return window % poolSize;
}
