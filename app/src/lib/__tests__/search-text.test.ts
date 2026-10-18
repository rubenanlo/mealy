import { foldForSearch, searchTerms, titleMatches } from '@/lib/search-text';

describe('foldForSearch', () => {
  it('lowercases and strips diacritics', () => {
    expect(foldForSearch('Calabacín')).toBe('calabacin');
    expect(foldForSearch('CRÈME Brûlée')).toBe('creme brulee');
  });
});

describe('titleMatches', () => {
  const titles = [
    'Risotto zucchini and stracchino',
    'Risotto de calabacín y stracchino',
    'Risotto alle zucchine e stracchino',
  ];

  it('matches the query against any language variant', () => {
    expect(titleMatches(titles, 'zucchine')).toBe(true);
    expect(titleMatches(titles, 'calabacin')).toBe(true);
    expect(titleMatches(titles, 'zucchini and')).toBe(true);
  });

  it('is accent- and case-insensitive in both directions', () => {
    expect(titleMatches(titles, 'CALABACÍN')).toBe(true);
    expect(titleMatches(['Purée de pommes'], 'puree')).toBe(true);
  });

  it('rejects queries that match no variant, and accepts empty queries', () => {
    expect(titleMatches(titles, 'lasagna')).toBe(false);
    expect(titleMatches(titles, '   ')).toBe(true);
  });
});

describe('searchTerms', () => {
  it('collects the title and ingredient names of every language variant', () => {
    const terms = searchTerms([
      { title: 'Poulet rôti', ingredients: [{ name: 'Poulet' }, { name: '' }] },
      { title: 'Pollo asado', ingredients: [{ name: 'Pollo' }] },
      { title: 'Roast chicken', ingredients: null },
    ]);
    expect(terms).toEqual(['Poulet rôti', 'Poulet', 'Pollo asado', 'Pollo', 'Roast chicken']);
  });

  it('lets a Spanish ingredient find a recipe whose titles never mention it', () => {
    const terms = searchTerms([
      { title: 'Le Riz sauté au bœuf', ingredients: [{ name: 'Riz' }] },
      { title: 'Arroz salteado con ternera', ingredients: [{ name: 'Arroz' }] },
    ]);
    expect(titleMatches(terms, 'arroz')).toBe(true);
    expect(titleMatches(terms, 'pollo')).toBe(false);
  });
});
