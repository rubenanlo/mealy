import { foldForSearch, titleMatches } from '@/lib/search-text';

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
