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

// --- step-text conversion (quantities + oven temperatures in prose) ---------

const FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};
const FRACTION_CHARS = Object.keys(FRACTIONS).join('');

// "1 1/2", "1½", "2/3", "⅔", "1.5", "1,5", "400"
const NUM = String.raw`(?:\d+\s+\d+\s*/\s*\d+|\d+\s*[${FRACTION_CHARS}]|\d+\s*/\s*\d+|[${FRACTION_CHARS}]|\d+(?:[.,]\d+)?)`;

const US_TEXT_RE = new RegExp(
  String.raw`(${NUM})[  ]*(cups?|fl\.?\s?oz|ounces?|oz|pounds?|lbs?|quarts?)\b`,
  'gi'
);
const METRIC_TEXT_RE = new RegExp(
  String.raw`(${NUM})[  ]*(ml|cl|dl|litres?|liters?|l|grams?|grammes?|gr|g|kilos?|kg)\b`,
  'gi'
);
// "400 degrees", "400 degrees F", "180°C", "350°" — scale defaults by range.
const TEMP_RE = new RegExp(
  String.raw`(\d{2,3})\s*(?:°|degrees?\b)\s*(F\b|Fahrenheit\b|C\b|Celsius\b)?`,
  'g'
);

function parseTextNumber(token: string): number | null {
  const t = token.trim();
  const mixedUnicode = t.match(new RegExp(String.raw`^(\d+)\s*([${FRACTION_CHARS}])$`));
  if (mixedUnicode) return parseInt(mixedUnicode[1], 10) + FRACTIONS[mixedUnicode[2]];
  if (t in FRACTIONS) return FRACTIONS[t];
  const frac = t.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
  if (frac) return parseInt(frac[1] ?? '0', 10) + parseInt(frac[2], 10) / parseInt(frac[3], 10);
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Display-only conversion of measurements inside step prose ("½ cup water",
 * "8 ounces feta", "heat the oven to 400 degrees"). Spoons stay untouched
 * like in the ingredient list; unrecognized text passes through unchanged.
 * Bare "degrees" without a scale is read as Fahrenheit at oven ranges
 * (≥ 250) and Celsius below.
 */
export function convertStepText(text: string, system: UnitSystem): string {
  if (system === 'original') return text;
  let out = text.replace(TEMP_RE, (match, num: string, scale: string | undefined) => {
    const v = parseInt(num, 10);
    const isF = scale ? scale[0].toUpperCase() === 'F' : v >= 250;
    if (system === 'metric') {
      if (!isF) return match;
      return `${Math.round((v - 32) * (5 / 9) / 5) * 5}°C`;
    }
    if (isF) return match;
    return `${Math.round((v * (9 / 5) + 32) / 5) * 5}°F`;
  });
  const unitRe = system === 'metric' ? US_TEXT_RE : METRIC_TEXT_RE;
  out = out.replace(unitRe, (match, num: string, unitToken: string) => {
    const qty = parseTextNumber(num);
    if (qty === null) return match;
    let u = unitToken.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    if (u === 'floz') u = 'fl oz';
    const conv =
      system === 'metric'
        ? u in US_MASS
          ? metricMass(qty * US_MASS[u])
          : u in US_VOLUME
            ? metricVolume(qty * US_VOLUME[u])
            : null
        : u in METRIC_MASS
          ? usMass(qty * METRIC_MASS[u])
          : u in METRIC_VOLUME
            ? usVolume(qty * METRIC_VOLUME[u])
            : null;
    if (!conv) return match;
    const unitLabel = conv.unit === 'cup' && conv.quantity !== 1 ? 'cups' : conv.unit;
    return `${conv.quantity} ${unitLabel}`;
  });
  return out;
}
