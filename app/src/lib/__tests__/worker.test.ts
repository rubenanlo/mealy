// reExtract needs a session token — the worker module calls supabase.auth.getSession()
// via its private accessToken() helper. No other test in this file touches Supabase,
// so this mock only matters for the reExtract suite below.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

import {
  buildRecipeRows,
  detectCaptureKind,
  fetchWebImage,
  fodmapSwaps,
  reExtract,
  type IngestResult,
  type IngredientRow,
  type Verbatim,
} from '../worker';

describe('detectCaptureKind', () => {
  it('detects plain URLs', () => {
    expect(detectCaptureKind('https://www.marmiton.org/recettes/tarte.aspx')).toBe('url');
    expect(detectCaptureKind('  http://example.com/recipe  ')).toBe('url');
  });

  it('routes Instagram and TikTok to social', () => {
    expect(detectCaptureKind('https://www.instagram.com/reel/Cxyz123/')).toBe('social');
    expect(detectCaptureKind('https://instagram.com/p/abc/')).toBe('social');
    expect(detectCaptureKind('https://www.tiktok.com/@chef/video/123456')).toBe('social');
    expect(detectCaptureKind('https://vm.tiktok.com/ZM123/')).toBe('social');
  });

  it('treats anything else as pasted text', () => {
    expect(detectCaptureKind('Tarte aux pommes\n3 pommes\n1 pâte brisée')).toBe('text');
    expect(detectCaptureKind('Voici la recette : https://example.com super bonne')).toBe('text');
    expect(detectCaptureKind('')).toBe('text');
  });
});

const verbatim: Verbatim = {
  kind: 'url',
  url: 'https://example.com/tarte',
  json_ld: { '@type': 'Recipe', name: 'Tarte fine — aux pommes “à l’ancienne”' },
  page_text: 'Texte exact de la page\n\navec accents éàü et emoji 🍏',
  caption: null,
  transcript: null,
  overlay_text: null,
  ocr_text: null,
  pasted: null,
};

const result: IngestResult = {
  verbatim,
  canonical: {
    title: 'Tarte aux pommes',
    language: 'fr',
    servings: 6,
    prep_minutes: 20,
    cook_minutes: 40,
    dish_type: 'dessert',
    tags: ['dessert', 'pommes'],
    ingredients: [
      { raw: '3 pommes Golden', quantity: 3, unit: null, name: 'pomme', group: null, fodmap: null },
    ],
    steps: ['Préchauffer le four.', 'Cuire 40 min.'],
    nutrition: null,
    confidence: 0.9,
  },
  needs_review: false,
  image_urls: ['http://insecure.example.com/a.jpg', 'https://example.com/cover.jpg'],
};

const ctx = { householdId: 'hh-1', userId: 'user-1' };

describe('buildRecipeRows', () => {
  it('passes the verbatim layer through byte-identical', () => {
    const rows = buildRecipeRows(result, ctx);
    // Same object reference — no copy, no field-by-field rebuild.
    expect(rows.source.verbatim).toBe(verbatim);
    // And byte-identical when serialised.
    expect(JSON.stringify(rows.source.verbatim)).toBe(JSON.stringify(verbatim));
  });

  it('maps canonical fields onto the recipes row', () => {
    const rows = buildRecipeRows(result, ctx);
    expect(rows.recipe).toMatchObject({
      household_id: 'hh-1',
      created_by: 'user-1',
      title: 'Tarte aux pommes',
      language: 'fr',
      servings: 6,
      prep_minutes: 20,
      cook_minutes: 40,
      dish_type: 'dessert',
      tags: ['dessert', 'pommes'],
      needs_review: false,
    });
    expect(rows.recipe.ingredients[0].raw).toBe('3 pommes Golden');
  });

  it('uses the first https image URL as remote cover, ignoring http', () => {
    const rows = buildRecipeRows(result, ctx);
    expect(rows.recipe.cover_image_path).toBe('https://example.com/cover.jpg');
  });

  it('propagates needs_review and source kind/url', () => {
    const flagged = { ...result, needs_review: true };
    const rows = buildRecipeRows(flagged, ctx);
    expect(rows.recipe.needs_review).toBe(true);
    expect(rows.source.kind).toBe('url');
    expect(rows.source.url).toBe('https://example.com/tarte');
    expect(rows.source.media_paths).toEqual([]);
  });

  it('throws when canonical is null (paste-fallback flow handles that case)', () => {
    expect(() => buildRecipeRows({ ...result, canonical: null }, ctx)).toThrow();
  });
});

describe('reExtract', () => {
  it('POSTs the verbatim with force_llm and returns the canonical', async () => {
    const canonical = { title: 'Neuf', language: 'fr', servings: 2, prep_minutes: null, cook_minutes: null, dish_type: null, tags: [], ingredients: [], steps: ['Cuire.'], nutrition: null, confidence: 0.9 };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => canonical }) as jest.Mock;
    const result = await reExtract({ kind: 'paste', url: null, json_ld: null, page_text: null, caption: null, transcript: null, overlay_text: null, ocr_text: null, pasted: 'x' });
    expect(result?.title).toBe('Neuf');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/structure');
    expect(JSON.parse(init.body).force_llm).toBe(true);
  });
  it('returns null on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as jest.Mock;
    expect(await reExtract({ kind: 'paste', url: null, json_ld: null, page_text: null, caption: null, transcript: null, overlay_text: null, ocr_text: null, pasted: 'x' })).toBeNull();
  });
});

describe('fodmapSwaps', () => {
  const swapIngredients: IngredientRow[] = [
    { raw: '1 oignon', quantity: 1, unit: null, name: 'oignon', group: null, fodmap: 'high' },
  ];

  it('POSTs the full body (incl. flagged) to /fodmap/swaps and returns the parsed response', async () => {
    const swapResponse = {
      swaps: [
        {
          raw: '1 oignon',
          replacement: { raw: '1 oignon', quantity: 1, unit: null, name: 'ciboulette', group: null, fodmap: 'low' },
          note: 'Use the green tops only.',
        },
      ],
      steps: ['Faire revenir la ciboulette.'],
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => swapResponse }) as jest.Mock;
    const result = await fodmapSwaps({
      title: 'Soupe',
      language: 'fr',
      servings: 4,
      ingredients: swapIngredients,
      steps: ['Faire revenir l’oignon.'],
      flagged: ['1 oignon'],
    });
    expect(result).toEqual(swapResponse);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/fodmap/swaps');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      title: 'Soupe',
      language: 'fr',
      servings: 4,
      ingredients: swapIngredients,
      steps: ['Faire revenir l’oignon.'],
      flagged: ['1 oignon'],
    });
  });

  it('returns null on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as jest.Mock;
    expect(
      await fodmapSwaps({
        title: 'Soupe',
        language: 'fr',
        servings: 4,
        ingredients: swapIngredients,
        steps: [],
        flagged: ['1 oignon'],
      })
    ).toBeNull();
  });

  it('returns null when the request throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as jest.Mock;
    expect(
      await fodmapSwaps({
        title: 'Soupe',
        language: 'fr',
        servings: 4,
        ingredients: swapIngredients,
        steps: [],
        flagged: ['1 oignon'],
      })
    ).toBeNull();
  });
});

describe('fetchWebImage', () => {
  it('POSTs the url to /image/fetch and returns the array buffer', async () => {
    const buffer = new ArrayBuffer(8);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => buffer }) as jest.Mock;
    const data = await fetchWebImage('https://example.com/photo.jpg');
    expect(data).toBe(buffer);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/image/fetch');
    expect(JSON.parse(init.body).url).toBe('https://example.com/photo.jpg');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('returns null on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as jest.Mock;
    expect(await fetchWebImage('https://example.com/photo.jpg')).toBeNull();
  });

  it('returns null when the request throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as jest.Mock;
    expect(await fetchWebImage('https://example.com/photo.jpg')).toBeNull();
  });
});

describe('extractCaptureUrl / cruft-tolerant kind detection', () => {
  const { extractCaptureUrl } = jest.requireActual('../worker');
  it('extracts a URL surrounded by share-sheet cruft', () => {
    expect(extractCaptureUrl('https://cooking.nytimes.com/recipes/761573409-basil-tofu an')).toBe(
      'https://cooking.nytimes.com/recipes/761573409-basil-tofu'
    );
    expect(extractCaptureUrl('Check this! https://example.com/r 🍲')).toBe('https://example.com/r');
  });
  it('long pasted recipe text containing a link stays text', () => {
    const text = `Tofu recipe: mix everything and bake. Serve warm with rice and basil leaves. Source: https://example.com/r`;
    expect(extractCaptureUrl(text)).toBeNull();
    expect(detectCaptureKind(text)).toBe('text');
  });
  it('cruft around a URL still routes as url capture', () => {
    expect(detectCaptureKind('https://cooking.nytimes.com/recipes/1 an')).toBe('url');
  });
});
