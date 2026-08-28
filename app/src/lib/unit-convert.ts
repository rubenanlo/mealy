import type { IngredientRow } from '@/lib/worker';

/**
 * NYT-style unit conversion for the recipe page (display only — stored
 * quantities are never rewritten). Spoons (tsp/tbsp and their translations)
 * are universal and stay untouched in every system; only mass and volume
 * units cross over. Unknown units pass through unchanged.
 */

export type UnitSystem = 'original' | 'metric' | 'us';

const US_MASS: Record<string, number> = {
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  lbs: 453.6,
  pound: 453.6,
  pounds: 453.6,
};
const US_VOLUME: Record<string, number> = {
  cup: 240,
  cups: 240,
  'fl oz': 29.6,
  quart: 946,
  quarts: 946,
};
const METRIC_MASS: Record<string, number> = {
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  gramme: 1,
  grammes: 1,
  gramo: 1,
  gramos: 1,
  grammo: 1,
  grammi: 1,
  kg: 1000,
  kilo: 1000,
  kilos: 1000,
};
const METRIC_VOLUME: Record<string, number> = {
  ml: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  litre: 1000,
  litres: 1000,
  liter: 1000,
  liters: 1000,
  litro: 1000,
  litros: 1000,
  litri: 1000,
};

const trim = (n: number, dp: number) => parseFloat(n.toFixed(dp));

function metricMass(grams: number): { quantity: number; unit: string } {
  if (grams >= 1000) return { quantity: trim(grams / 1000, 2), unit: 'kg' };
  return { quantity: grams >= 10 ? Math.round(grams) : trim(grams, 1), unit: 'g' };
}

function metricVolume(ml: number): { quantity: number; unit: string } {
  if (ml >= 1000) return { quantity: trim(ml / 1000, 2), unit: 'l' };
  return { quantity: ml >= 10 ? Math.round(ml) : trim(ml, 1), unit: 'ml' };
}

function usMass(grams: number): { quantity: number; unit: string } {
  const oz = grams / 28.35;
  if (oz >= 16) return { quantity: trim(oz / 16, 1), unit: 'lb' };
  return { quantity: trim(oz, 1), unit: 'oz' };
}

function usVolume(ml: number): { quantity: number; unit: string } {
  if (ml >= 60) return { quantity: trim(ml / 240, 2), unit: 'cup' };
  return { quantity: trim(ml / 29.6, 1), unit: 'fl oz' };
}

export function convertIngredient(ing: IngredientRow, system: UnitSystem): IngredientRow {
  if (system === 'original' || ing.quantity === null || !ing.unit) return ing;
  const u = ing.unit.trim().toLowerCase();
  if (system === 'metric') {
    if (u in US_MASS) return { ...ing, ...metricMass(ing.quantity * US_MASS[u]) };
    if (u in US_VOLUME) return { ...ing, ...metricVolume(ing.quantity * US_VOLUME[u]) };
  } else {
    if (u in METRIC_MASS) return { ...ing, ...usMass(ing.quantity * METRIC_MASS[u]) };
    if (u in METRIC_VOLUME) return { ...ing, ...usVolume(ing.quantity * METRIC_VOLUME[u]) };
  }
  return ing;
}

export function convertIngredients(list: IngredientRow[], system: UnitSystem): IngredientRow[] {
  if (system === 'original') return list;
  return list.map((ing) => convertIngredient(ing, system));
}
