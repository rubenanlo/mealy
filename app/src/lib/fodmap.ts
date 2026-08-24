import { lineGrams } from '@/lib/aggregate';
import type { CanonicalIngredient, FodmapTier } from '@/lib/canonical';

/**
 * Per-recipe FODMAP flags (Phase 2 Task 5, spec §4). The deterministic
 * reference table assigns tier + thresholds; flags are dose-dependent
 * (portion = quantity ÷ servings); unknown defaults to 'check' — never 'low'.
 * The LLM plays no part here.
 */

export interface FodmapLine {
  raw: string;
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface FodmapFlag {
  /** Display name: canonical FR name, else the line's own name. */
  name: string;
  raw: string;
  tier: FodmapTier;
  groups: string[];
  /** Assumed per-serving grams that drove the flag; null when unknown. */
  portionG: number | null;
  /** Transparency line: which serving/threshold drove this (spec §4). */
  explanation: string;
  /** Low-FODMAP alternates (display names) for high/moderate flags. */
  swaps: string[];
}

export interface StackingWarning {
  group: string;
  /** Ingredient names whose low-tier servings stack in this group. */
  ingredients: string[];
}

export interface RecipeFodmap {
  flags: FodmapFlag[];
  stacking: StackingWarning[];
  /** True when at least one non-low flag or stacking warning exists. */
  hasWarnings: boolean;
}

export const FODMAP_DISCLAIMER = 'Best-effort guidance, not medical advice.';

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Tier for one ingredient at one per-serving portion. Threshold logic:
 * ≥ high_serving_g → high; ≤ low_serving_g → low; between both → moderate;
 * portion unknown → the table's tier as-is.
 */
export function flagIngredient(
  canonical: CanonicalIngredient | null,
  portionG: number | null
): { tier: FodmapTier; explanation: string } {
  if (!canonical) {
    return { tier: 'check', explanation: 'Not in the ingredient table yet — check manually.' };
  }
  if (canonical.fodmap_tier === 'check') {
    return { tier: 'check', explanation: 'No published FODMAP data for this ingredient — check manually.' };
  }
  const { low_serving_g: low, high_serving_g: high } = canonical;
  if (portionG !== null && (low !== null || high !== null)) {
    if (high !== null && portionG >= high) {
      return {
        tier: 'high',
        explanation: `≈${round(portionG)} g per serving — high at ≥ ${high} g.`,
      };
    }
    if (low !== null && portionG <= low) {
      return {
        tier: 'low',
        explanation: `≈${round(portionG)} g per serving — low up to ${low} g.`,
      };
    }
    if (low !== null && high !== null) {
      return {
        tier: 'moderate',
        explanation: `≈${round(portionG)} g per serving — moderate between ${low} g and ${high} g.`,
      };
    }
  }
  const suffix =
    portionG === null
      ? 'quantity unknown — using the published tier.'
      : `≈${round(portionG)} g per serving.`;
  return { tier: canonical.fodmap_tier, explanation: `${capitalize(canonical.fodmap_tier)} per published data; ${suffix}` };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Compute all flags for a recipe. `match` resolves a line to its canonical
 * row or null. Stacking heuristic (spec §4): the same FODMAP group appearing
 * in ≥2 distinct low-tier ingredients earns a 'check' warning — a defensible
 * heuristic, not a precise sum.
 */
export function computeRecipeFodmap(
  lines: FodmapLine[],
  servings: number | null,
  match: (line: FodmapLine) => CanonicalIngredient | null,
  resolveSlug?: (slug: string) => CanonicalIngredient | null
): RecipeFodmap {
  const flags: FodmapFlag[] = [];

  for (const line of lines) {
    const canonical = match(line);
    let portionG: number | null = null;
    if (canonical && line.quantity !== null && servings !== null && servings > 0) {
      const grams = lineGrams(line.quantity, line.unit, canonical);
      if (grams !== null) portionG = grams / servings;
    }
    const { tier, explanation } = flagIngredient(canonical, portionG);
    const swaps =
      (tier === 'high' || tier === 'moderate') && canonical && resolveSlug
        ? (canonical.fodmap_swaps ?? [])
            .map((slug) => resolveSlug(slug)?.name_fr)
            .filter((name): name is string => !!name)
        : [];
    flags.push({
      name: canonical?.name_fr ?? line.name,
      raw: line.raw,
      tier,
      groups: canonical?.fodmap_groups ?? [],
      portionG: portionG === null ? null : round(portionG),
      explanation,
      swaps,
    });
  }

  // Stacking: same group from ≥2 low-tier ingredients that carry that group.
  const byGroup = new Map<string, Set<string>>();
  for (const flag of flags) {
    if (flag.tier !== 'low') continue;
    for (const group of flag.groups) {
      const set = byGroup.get(group) ?? new Set<string>();
      set.add(flag.name);
      byGroup.set(group, set);
    }
  }
  const stacking: StackingWarning[] = [...byGroup.entries()]
    .filter(([, names]) => names.size >= 2)
    .map(([group, names]) => ({ group, ingredients: [...names] }));

  const hasWarnings = stacking.length > 0 || flags.some((f) => f.tier !== 'low');
  return { flags, stacking, hasWarnings };
}

/**
 * Recipe-level tier = the worst ingredient flag: any high → high, else any
 * moderate → moderate, else any unknown → check, else low. An empty recipe
 * (no ingredient lines) is unknowable → check.
 */
export function recipeFodmapTier(fodmap: RecipeFodmap): FodmapTier {
  if (fodmap.flags.length === 0) return 'check';
  if (fodmap.flags.some((f) => f.tier === 'high')) return 'high';
  if (fodmap.flags.some((f) => f.tier === 'moderate')) return 'moderate';
  if (fodmap.flags.some((f) => f.tier === 'check')) return 'check';
  return 'low';
}
