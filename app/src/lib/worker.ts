import { supabase } from '@/lib/supabase';
import { queueRecipeTranslation } from '@/lib/translations';
import { workerUrl } from '@/lib/worker-url';

// ---------------------------------------------------------------------------
// Types mirrored from the worker's IngestResult (worker Task 3 models).
// ---------------------------------------------------------------------------

export type SourceKind = 'url' | 'reel' | 'photo' | 'pdf' | 'paste';

export interface IngredientRow {
  raw: string;
  quantity: number | null;
  unit: string | null;
  name: string;
  group: string | null;
  fodmap: string | null;
}

export interface CanonicalRecipe {
  title: string;
  language: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  dish_type: string | null;
  tags: string[];
  ingredients: IngredientRow[];
  steps: string[];
  nutrition: Record<string, unknown> | null;
  confidence: number;
}

export interface Verbatim {
  kind: SourceKind;
  url: string | null;
  json_ld: Record<string, unknown> | null;
  page_text: string | null;
  caption: string | null;
  transcript: string | null;
  overlay_text: string | null;
  ocr_text: string | null;
  pasted: string | null;
}

export interface IngestResult {
  verbatim: Verbatim;
  canonical: CanonicalRecipe | null;
  needs_review: boolean;
  image_urls: string[];
}

export interface MediaAsset {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ---------------------------------------------------------------------------

export type CaptureKind = 'url' | 'social' | 'text';

const SOCIAL_HOSTS = ['instagram.com', 'tiktok.com'];

/** Auto-detect what a pasted string is: a social URL, a plain URL, or recipe text. */
/**
 * Pull a single URL out of pasted input, tolerating share-sheet cruft
 * ("Check this out! https://… 🍲") as long as the non-URL remainder is
 * short. Real recipe text stays text: it is far longer than the allowance.
 */
export function extractCaptureUrl(input: string): string | null {
  const match = input.match(/https?:\/\/\S+/i);
  if (!match) return null;
  const remainder = input.replace(match[0], '').trim();
  if (remainder.length > 24) return null;
  return match[0];
}

export function detectCaptureKind(input: string): CaptureKind {
  const url = extractCaptureUrl(input);
  if (!url) return 'text';
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'social';
  } catch {
    return 'text';
  }
  return 'url';
}

export interface RecipeRowsContext {
  householdId: string;
  userId: string;
}

export interface RecipeRows {
  recipe: {
    household_id: string;
    title: string;
    language: string;
    servings: number | null;
    prep_minutes: number | null;
    cook_minutes: number | null;
    dish_type: string | null;
    tags: string[];
    ingredients: IngredientRow[];
    steps: string[];
    nutrition: Record<string, unknown> | null;
    cover_image_path: string | null;
    needs_review: boolean;
    created_by: string;
  };
  /** recipe_id is filled in after the recipe insert. */
  source: {
    kind: SourceKind;
    url: string | null;
    verbatim: Verbatim;
    media_paths: string[];
  };
}

/**
 * Build the `recipes` + `recipe_sources` insert payloads from an IngestResult.
 * The verbatim layer passes through BYTE-IDENTICAL (spec §3.1): the exact
 * object received from the worker is used, never copied field-by-field or
 * re-serialised.
 */
export function buildRecipeRows(result: IngestResult, ctx: RecipeRowsContext): RecipeRows {
  const canonical = result.canonical;
  if (!canonical) {
    throw new Error('buildRecipeRows requires a canonical recipe (needs_review flow handles null)');
  }
  const remoteCover = result.image_urls.find((u) => u.startsWith('https://')) ?? null;
  return {
    recipe: {
      household_id: ctx.householdId,
      title: canonical.title,
      language: canonical.language,
      servings: canonical.servings,
      prep_minutes: canonical.prep_minutes,
      cook_minutes: canonical.cook_minutes,
      dish_type: canonical.dish_type,
      tags: canonical.tags,
      ingredients: canonical.ingredients,
      steps: canonical.steps,
      nutrition: canonical.nutrition,
      cover_image_path: remoteCover,
      needs_review: result.needs_review,
      created_by: ctx.userId,
    },
    source: {
      kind: result.verbatim.kind,
      url: result.verbatim.url,
      verbatim: result.verbatim,
      media_paths: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Worker HTTP client.
// ---------------------------------------------------------------------------

// Resolved once per session: bundler host in Expo Go (survives DHCP changes),
// EXPO_PUBLIC_WORKER_URL otherwise. See lib/worker-url.ts.
const WORKER_URL = workerUrl();

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Session expired — sign in again.');
  return token;
}

async function postWorker(path: string, body: FormData | Record<string, unknown>): Promise<IngestResult> {
  if (!WORKER_URL) throw new Error('EXPO_PUBLIC_WORKER_URL is missing — check app/.env');
  const token = await accessToken();
  const isForm = body instanceof FormData;
  const response = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    },
    body: isForm ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`The import service answered ${response.status}.`);
  }
  return (await response.json()) as IngestResult;
}

function assetFormPart(asset: MediaAsset, index: number): { uri: string; name: string; type: string } {
  return {
    uri: asset.uri,
    name: asset.fileName ?? `media-${index}`,
    type: asset.mimeType ?? 'application/octet-stream',
  };
}

export async function ingestUrl(url: string): Promise<IngestResult> {
  return postWorker('/ingest/url', { url });
}

export async function ingestSocial(url: string): Promise<IngestResult> {
  return postWorker('/ingest/social', { url });
}

export async function ingestText(text: string): Promise<IngestResult> {
  return postWorker('/ingest/text', { text });
}

export async function ingestImages(assets: MediaAsset[]): Promise<IngestResult> {
  const form = new FormData();
  assets.forEach((asset, i) => {
    form.append('files', assetFormPart(asset, i) as unknown as Blob);
  });
  return postWorker('/ingest/images', form);
}

export async function ingestPdf(asset: MediaAsset): Promise<IngestResult> {
  const form = new FormData();
  form.append('file', assetFormPart(asset, 0) as unknown as Blob);
  return postWorker('/ingest/pdf', form);
}

// ---------------------------------------------------------------------------
// Ingredient → canonical LLM fallback matcher (Phase 2 Task 4 endpoint).
// ---------------------------------------------------------------------------

export interface IngredientMatch {
  line: string;
  /** A candidate slug or null — the worker may only answer from candidates. */
  slug: string | null;
}

/**
 * Ask the worker to map unmatched raw lines to candidate slugs. Returns null
 * when the worker is unreachable/out of credits/answers garbage — callers
 * degrade gracefully (lines stay unmatched, nothing is cached).
 */
export async function matchIngredients(
  lines: string[],
  candidates: string[]
): Promise<IngredientMatch[] | null> {
  if (lines.length === 0) return [];
  if (!WORKER_URL) return null;
  try {
    const token = await accessToken();
    const response = await fetch(`${WORKER_URL}/match/ingredients`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lines, candidates }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { matches?: unknown };
    if (!Array.isArray(payload.matches)) return null;
    const candidateSet = new Set(candidates);
    return payload.matches
      .filter(
        (m): m is { line: string; slug: string | null } =>
          !!m &&
          typeof (m as { line?: unknown }).line === 'string' &&
          ((m as { slug?: unknown }).slug === null ||
            typeof (m as { slug?: unknown }).slug === 'string')
      )
      .map((m) => ({
        line: m.line,
        // Defense in depth: never accept a slug outside the candidate list (§4).
        slug: m.slug !== null && candidateSet.has(m.slug) ? m.slug : null,
      }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Unit classification fallback (groceries aggregation).
// ---------------------------------------------------------------------------

export interface UnitConversionReply {
  unit: string;
  kind: 'mass' | 'volume' | 'count' | null;
  factor: number | null;
}

/**
 * Ask the worker to classify unknown units of measure. Returns null when the
 * worker is unreachable — callers degrade gracefully (units stay unmerged,
 * nothing is cached).
 */
export async function classifyUnits(units: string[]): Promise<UnitConversionReply[] | null> {
  if (units.length === 0) return [];
  if (!WORKER_URL) return null;
  try {
    const token = await accessToken();
    const response = await fetch(`${WORKER_URL}/units/classify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ units }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { conversions?: unknown };
    if (!Array.isArray(payload.conversions)) return null;
    // Defense in depth: only accept well-formed kinds and finite factors.
    return payload.conversions
      .filter(
        (c): c is { unit: string; kind: unknown; factor: unknown } =>
          !!c && typeof (c as { unit?: unknown }).unit === 'string'
      )
      .map((c) => ({
        unit: c.unit,
        kind: c.kind === 'mass' || c.kind === 'volume' || c.kind === 'count' ? c.kind : null,
        factor: typeof c.factor === 'number' && Number.isFinite(c.factor) && c.factor > 0 ? c.factor : null,
      }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Re-extraction from a stored source (Phase 2 Task 13 / spec Part 6).
// ---------------------------------------------------------------------------

/**
 * Re-run extraction on a stored verbatim (spec Part 6). force_llm skips the
 * JSON-LD shortcut so a bad direct-map gets a fresh model pass. Returns null
 * on any failure — the caller shows "could not re-extract".
 */
export async function reExtract(verbatim: Verbatim): Promise<CanonicalRecipe | null> {
  if (!WORKER_URL) return null;
  try {
    const token = await accessToken();
    const response = await fetch(`${WORKER_URL}/structure`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ verbatim, force_llm: true }),
    });
    if (!response.ok) return null;
    return (await response.json()) as CanonicalRecipe;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Web cover image fetch/validation (Phase 2 Task 15 / spec Part 4/7).
// ---------------------------------------------------------------------------

/** Download + validate a web image via the worker (spec Part 4/7). */
export async function fetchWebImage(url: string): Promise<ArrayBuffer | null> {
  if (!WORKER_URL) return null;
  try {
    const token = await accessToken();
    const response = await fetch(`${WORKER_URL}/image/fetch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Low-FODMAP swap suggestions (Phase 2 Task 16/17 / spec Part 8).
// ---------------------------------------------------------------------------

export interface FodmapSwapRequest {
  title: string;
  language: string;
  servings: number | null;
  ingredients: IngredientRow[];
  steps: string[];
  /** raw ingredient lines flagged high/moderate FODMAP */
  flagged: string[];
}

export interface FodmapSwapResult {
  swaps: { raw: string; replacement: IngredientRow; note: string }[];
  steps: string[];
}

/**
 * Ask the worker for low-FODMAP substitutions + rewritten steps (spec Part 8).
 * Returns null on any failure — the caller shows "could not fetch suggestions".
 */
export async function fodmapSwaps(request: FodmapSwapRequest): Promise<FodmapSwapResult | null> {
  if (!WORKER_URL) return null;
  try {
    const token = await accessToken();
    const response = await fetch(`${WORKER_URL}/fodmap/swaps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) return null;
    return (await response.json()) as FodmapSwapResult;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Persistence: IngestResult -> Supabase rows (+ media upload).
// ---------------------------------------------------------------------------

export interface CaptureOutcome {
  /** null when the worker could not extract a recipe (offer the paste fallback). */
  recipeId: string | null;
  result: IngestResult;
}

async function uploadAsset(path: string, asset: MediaAsset): Promise<void> {
  const data = await fetch(asset.uri).then((r) => r.arrayBuffer());
  const { error } = await supabase.storage.from('recipe-media').upload(path, data, {
    contentType: asset.mimeType ?? 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`Media upload failed: ${error.message}`);
}

/** Persist an IngestResult: recipes + recipe_sources + recipe_images (+ Storage). */
export async function persistIngestResult(
  result: IngestResult,
  ctx: RecipeRowsContext,
  localAssets: MediaAsset[] = [],
  /** User-entered capture URL — kept even if the worker's verbatim drops it. */
  sourceUrl: string | null = null
): Promise<string> {
  const rows = buildRecipeRows(result, ctx);

  const { data: recipe, error: recipeError } = await supabase
    .from('recipes')
    .insert(rows.recipe)
    .select('id')
    .single();
  if (recipeError || !recipe) {
    throw new Error(`Saving the recipe failed: ${recipeError?.message}`);
  }
  const recipeId = recipe.id as string;

  const mediaPaths: string[] = [];
  for (let i = 0; i < localAssets.length; i++) {
    const path = `${ctx.householdId}/${recipeId}/${i}`;
    await uploadAsset(path, localAssets[i]);
    mediaPaths.push(path);
  }

  const { error: sourceError } = await supabase.from('recipe_sources').insert({
    ...rows.source,
    url: rows.source.url ?? sourceUrl,
    recipe_id: recipeId,
    media_paths: mediaPaths,
  });
  if (sourceError) {
    throw new Error(`Saving the source failed: ${sourceError.message}`);
  }

  const galleryPaths = [
    ...mediaPaths,
    ...result.image_urls.filter((u) => u.startsWith('https://')),
  ];
  if (galleryPaths.length > 0) {
    await supabase.from('recipe_images').insert(
      galleryPaths.map((path, i) => ({
        recipe_id: recipeId,
        storage_path: path,
        position: i,
        is_cover: i === 0,
      }))
    );
  }

  if (!rows.recipe.cover_image_path && mediaPaths.length > 0) {
    await supabase.from('recipes').update({ cover_image_path: mediaPaths[0] }).eq('id', recipeId);
  }

  // Derived translation layer: fire-and-forget so capture never waits on it.
  queueRecipeTranslation(recipeId, {
    title: rows.recipe.title,
    language: rows.recipe.language,
    ingredients: rows.recipe.ingredients,
    steps: rows.recipe.steps,
  });

  return recipeId;
}

// ---------------------------------------------------------------------------
// Capture entry points used by the capture screen.
// ---------------------------------------------------------------------------

async function captureCommon(
  result: IngestResult,
  ctx: RecipeRowsContext,
  localAssets: MediaAsset[] = [],
  sourceUrl: string | null = null
): Promise<CaptureOutcome> {
  if (!result.canonical) return { recipeId: null, result };
  const recipeId = await persistIngestResult(result, ctx, localAssets, sourceUrl);
  return { recipeId, result };
}

export async function captureFromUrl(input: string, ctx: RecipeRowsContext): Promise<CaptureOutcome> {
  const kind = detectCaptureKind(input);
  const url = extractCaptureUrl(input) ?? input.trim();
  const result = kind === 'social' ? await ingestSocial(url) : await ingestUrl(url);
  return captureCommon(result, ctx, [], url);
}

export async function captureFromText(text: string, ctx: RecipeRowsContext): Promise<CaptureOutcome> {
  const result = await ingestText(text);
  return captureCommon(result, ctx);
}

export async function captureFromImages(
  assets: MediaAsset[],
  ctx: RecipeRowsContext
): Promise<CaptureOutcome> {
  const result = await ingestImages(assets);
  return captureCommon(result, ctx, assets);
}

export async function captureFromPdf(asset: MediaAsset, ctx: RecipeRowsContext): Promise<CaptureOutcome> {
  const result = await ingestPdf(asset);
  return captureCommon(result, ctx, [asset]);
}
