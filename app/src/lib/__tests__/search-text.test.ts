import {
  buildSearchIndex,
  foldForSearch,
  editDistance,
  scoreRecipes,
  titleMatches,
} from '@/lib/search-text';

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

describe('editDistance', () => {
  it('counts typos, including transpositions, capped at max + 1', () => {
    expect(editDistance('porc', 'pork', 1)).toBe(1);
    expect(editDistance('chiken', 'chicken', 1)).toBe(1);
    expect(editDistance('spagetti', 'spaghetti', 2)).toBe(1);
    expect(editDistance('lasagan', 'lasagna', 1)).toBe(1);
    expect(editDistance('salmon', 'lemon', 1)).toBe(2);
    expect(editDistance('chik', 'chicken', 1)).toBe(2);
  });

  it('can compare against the closest prefix for half-typed words', () => {
    expect(editDistance('chik', 'chicken', 1, true)).toBe(1);
    expect(editDistance('spagh', 'spaghetti', 1, true)).toBe(0);
  });
});

describe('scoreRecipes', () => {
  const docs = [
    {
      // 0: pork only in the ingredients, in every language
      titles: ['Lomo saltado', 'Stir-fried loin', 'Sauté de longe', 'Lombo saltato'],
      ingredients: ['pork loin', 'lomo de cerdo', 'filet de porc', 'lonza di maiale', 'onion'],
    },
    {
      // 1: pork in the title
      titles: [
        'Pulled pork tacos',
        'Tacos de cerdo desmechado',
        'Tacos au porc effiloché',
        'Tacos di maiale sfilacciato',
      ],
      ingredients: ['pork shoulder', 'tortillas'],
    },
    {
      // 2: chicken
      titles: ['Roast chicken', 'Pollo asado', 'Poulet rôti', 'Pollo arrosto'],
      ingredients: ['chicken', 'lemon', 'tomato paste'],
    },
    {
      // 3: pasta
      titles: ['Spaghetti al pomodoro'],
      ingredients: ['spaghetti', 'tomatoes'],
    },
  ];
  const index = buildSearchIndex(docs);
  const hits = (q: string) =>
    (scoreRecipes(index, q) ?? [])
      .map((score, i) => ({ score, i }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i);

  it('returns null for an empty query', () => {
    expect(scoreRecipes(index, '  ')).toBeNull();
  });

  it('finds pork in any language, title matches first', () => {
    for (const q of ['pork', 'cerdo', 'porc', 'maiale']) expect(hits(q)).toEqual([1, 0]);
  });

  it('forgives typos when nothing matches exactly', () => {
    expect(hits('chiken')).toEqual([2]);
    expect(hits('polo asado')).toEqual([2]);
    expect(hits('spagetti')).toEqual([3]);
    expect(hits('pomodro')).toEqual([3]);
    expect(hits('chik')).toEqual([2]); // half-typed and misspelled
  });

  it('does not fuzz words that already match exactly', () => {
    // "pasta" is in the library, so "tomato paste" is not treated as a typo of it.
    const withPasta = buildSearchIndex([
      ...docs,
      { titles: ['Pasta e fagioli'], ingredients: ['pasta', 'beans'] },
    ]);
    const scores = scoreRecipes(withPasta, 'pasta') ?? [];
    expect(scores[2]).toBe(0);
    expect(scores[4]).toBeGreaterThan(0);
  });

  it('requires every word to match somewhere', () => {
    expect(hits('pork chicken')).toEqual([]);
    expect(hits('tacos cerdo')).toEqual([1]);
  });

  it('ignores short garbage instead of fuzzing it', () => {
    expect(hits('xq')).toEqual([]);
  });
});
