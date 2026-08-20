import type { QuotaTarget } from '@/lib/quotas';

/** Typed view over persons.diet_profile (spec §2 DietProfile). */
export type FodmapMode = 'off' | 'elimination' | 'reintroduction' | 'personalized';

export interface DietProfile {
  fodmap: {
    mode: FodmapMode;
    strictness: 'strict' | 'relaxed';
    avoidGroups: string[];
    tolerances: Record<string, unknown>;
    checkStacking: boolean;
  };
  proteinQuotas: {
    period: 'week';
    targets: QuotaTarget[];
  };
  allergens: string[];
  dislikes: string[];
  cuisines: { preferred: string[] };
  dietLayers: string[];
  maxCookMinutesWeeknight: number | null;
  language: string;
  spanishVariant: string | null;
}

export const QUOTA_CATEGORIES: { category: string; label: string }[] = [
  { category: 'fish', label: 'Fish' },
  { category: 'meat', label: 'Meat' },
  { category: 'vegetarian', label: 'Vegetarian' },
];

export const FODMAP_MODES: { mode: FodmapMode; label: string }[] = [
  { mode: 'off', label: 'Off' },
  { mode: 'elimination', label: 'Elimination' },
  { mode: 'reintroduction', label: 'Reintroduction' },
  { mode: 'personalized', label: 'Personalized' },
];

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Fill a possibly-partial diet_profile jsonb with spec defaults. */
export function normalizeDietProfile(raw: unknown): DietProfile {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const fodmap = (obj.fodmap ?? {}) as Record<string, any>;
  const quotas = (obj.proteinQuotas ?? {}) as Record<string, any>;
  const rawTargets = Array.isArray(quotas.targets) ? quotas.targets : [];

  const targets: QuotaTarget[] = QUOTA_CATEGORIES.map(({ category }) => {
    const found = rawTargets.find((t: any) => t?.category === category);
    return {
      category,
      min: typeof found?.min === 'number' ? found.min : 0,
      max: typeof found?.max === 'number' ? found.max : null,
    };
  });
  // Preserve any extra categories the profile already has (e.g. legume).
  for (const t of rawTargets) {
    if (t?.category && !targets.some((x) => x.category === t.category)) {
      targets.push({
        category: t.category,
        min: typeof t.min === 'number' ? t.min : 0,
        max: typeof t.max === 'number' ? t.max : null,
      });
    }
  }

  return {
    fodmap: {
      mode: ['off', 'elimination', 'reintroduction', 'personalized'].includes(fodmap.mode)
        ? fodmap.mode
        : 'off',
      strictness: fodmap.strictness === 'relaxed' ? 'relaxed' : 'strict',
      avoidGroups: stringArray(fodmap.avoidGroups),
      tolerances: fodmap.tolerances && typeof fodmap.tolerances === 'object' ? fodmap.tolerances : {},
      checkStacking: fodmap.checkStacking !== false,
    },
    proteinQuotas: { period: 'week', targets },
    allergens: stringArray(obj.allergens),
    dislikes: stringArray(obj.dislikes),
    cuisines: { preferred: stringArray(obj.cuisines?.preferred) },
    dietLayers: stringArray(obj.dietLayers),
    maxCookMinutesWeeknight:
      typeof obj.maxCookMinutesWeeknight === 'number' ? obj.maxCookMinutesWeeknight : null,
    language: typeof obj.language === 'string' ? obj.language : 'fr',
    spanishVariant: typeof obj.spanishVariant === 'string' ? obj.spanishVariant : null,
  };
}
