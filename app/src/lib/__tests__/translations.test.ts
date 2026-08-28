import { supabase } from '@/lib/supabase';

import { localizeContent, localizedTitle, translateAndStore } from '../translations';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

const mockFrom = supabase.from as jest.Mock;

const ING = (raw: string, name: string) => ({
  raw,
  name,
  quantity: null,
  unit: null,
  group: null,
  fodmap: null,
});

const RECIPE = {
  title: 'Soupe de légumes',
  language: 'fr',
  ingredients: [ING('1 oignon', 'oignon')],
  steps: ['Émincer.'],
};

describe('localizedTitle', () => {
  it('picks the embedded translation for the active locale', () => {
    const row = {
      title: 'Soupe',
      recipe_translations: [
        { locale: 'es', title: 'Sopa' },
        { locale: 'en', title: 'Soup' },
      ],
    };
    expect(localizedTitle(row, 'es')).toBe('Sopa');
  });

  it('falls back to the original title when no row matches', () => {
    expect(localizedTitle({ title: 'Soupe', recipe_translations: [] }, 'it')).toBe('Soupe');
    expect(localizedTitle({ title: 'Soupe' }, 'es')).toBe('Soupe');
  });
});

describe('localizeContent', () => {
  it('returns the translation content for the active locale', () => {
    const translation = {
      locale: 'en',
      title: 'Vegetable soup',
      ingredients: [ING('1 onion', 'onion')],
      steps: ['Slice.'],
    };
    const out = localizeContent(RECIPE, translation);
    expect(out.title).toBe('Vegetable soup');
    expect(out.ingredients[0].name).toBe('onion');
    expect(out.steps).toEqual(['Slice.']);
  });

  it('falls back to the original content without a translation', () => {
    const out = localizeContent(RECIPE, null);
    expect(out.title).toBe('Soupe de légumes');
    expect(out.steps).toEqual(['Émincer.']);
  });
});

describe('translateAndStore', () => {
  const WORKER_REPLY = {
    source_language: 'fr',
    translations: {
      en: { title: 'Soup', ingredients: [ING('1 onion', 'onion')], steps: ['Slice.'] },
      es: { title: 'Sopa', ingredients: [ING('1 cebolla', 'cebolla')], steps: ['Corta.'] },
      it: {
        title: 'Zuppa',
        ingredients: [ING('1 cipolla', 'cipolla')],
        steps: ['Affetta.'],
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(WORKER_REPLY),
    }) as jest.Mock;
  });

  function tableMocks() {
    const translationsTable = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    };
    const recipesTable = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
    };
    mockFrom.mockImplementation((table: string) =>
      table === 'recipe_translations' ? translationsTable : recipesTable
    );
    return { translationsTable, recipesTable };
  }

  it('stores one row per translated locale', async () => {
    const { translationsTable } = tableMocks();
    const ok = await translateAndStore('r-1', RECIPE);
    expect(ok).toBe(true);
    const rows = translationsTable.upsert.mock.calls[0][0];
    expect(rows).toHaveLength(3);
    expect(rows.map((r: { locale: string }) => r.locale).sort()).toEqual(['en', 'es', 'it']);
    expect(rows[0].recipe_id).toBe('r-1');
  });

  it('updates recipes.language when detection differs from the stored value', async () => {
    const { recipesTable } = tableMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...WORKER_REPLY, source_language: 'ca' }),
    }) as jest.Mock;
    await translateAndStore('r-1', RECIPE);
    expect(recipesTable.update).toHaveBeenCalledWith({ language: 'ca' });
  });

  it('returns false and writes nothing when the worker fails', async () => {
    const { translationsTable } = tableMocks();
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as jest.Mock;
    const ok = await translateAndStore('r-1', RECIPE);
    expect(ok).toBe(false);
    expect(translationsTable.upsert).not.toHaveBeenCalled();
  });
});
