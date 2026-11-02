import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

import { notify } from '@/lib/confirm';
import { buildRecipeShareText, recipeUrl, shareRecipe, type ShareableRecipe } from '@/lib/recipe-share';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/confirm', () => ({ notify: jest.fn() }));

const labels = { ingredients: 'Ingredients', steps: 'Steps', openInMealy: 'Open in Mealy' };

const ing = (raw: string, group: string | null = null) => ({
  raw,
  quantity: null,
  unit: null,
  name: raw,
  group,
  fodmap: null,
});

const recipe: ShareableRecipe = {
  id: 'r-1',
  title: 'Lomo saltado',
  meta: ['4 servings', 'Cook 20 min'],
  ingredients: [ing('500 g beef sirloin'), ing('2 red onions')],
  steps: ['Sear the beef.', ' ', 'Add onions and toss.'],
};

describe('recipeUrl', () => {
  it('points at the recipe page on the web app', () => {
    expect(recipeUrl('r-1')).toBe('https://app.rawdev.link/recipe/r-1');
  });
});

describe('buildRecipeShareText', () => {
  it('lays out title, meta, ingredients, numbered steps and the link', () => {
    expect(buildRecipeShareText(recipe, labels)).toBe(
      [
        'Lomo saltado\n4 servings · Cook 20 min',
        'Ingredients\n- 500 g beef sirloin\n- 2 red onions',
        'Steps\n1. Sear the beef.\n2. Add onions and toss.',
        'Open in Mealy: https://app.rawdev.link/recipe/r-1',
      ].join('\n\n')
    );
  });

  it('keeps ingredient groups and falls back to structured fields', () => {
    const text = buildRecipeShareText(
      {
        ...recipe,
        meta: [],
        ingredients: [
          ing('1 lime', 'Sauce'),
          { raw: '', quantity: 2, unit: 'tbsp', name: 'soy sauce', group: 'Sauce', fodmap: null },
          ing('Rice', 'To serve'),
        ],
        steps: [],
      },
      labels
    );
    expect(text).toBe(
      [
        'Lomo saltado',
        'Ingredients\nSauce:\n- 1 lime\n- 2 tbsp soy sauce\n\nTo serve:\n- Rice',
        'Open in Mealy: https://app.rawdev.link/recipe/r-1',
      ].join('\n\n')
    );
  });
});

describe('shareRecipe', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('opens the system share sheet with the recipe text', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as Awaited<ReturnType<typeof Share.share>>);

    await shareRecipe(recipe, labels, 'Recipe copied');

    expect(shareSpy).toHaveBeenCalledWith(
      { title: 'Lomo saltado', message: buildRecipeShareText(recipe, labels) },
      { subject: 'Lomo saltado' }
    );
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  });

  it('copies the text when no share sheet exists', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('not supported'));

    await shareRecipe(recipe, labels, 'Recipe copied');

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(buildRecipeShareText(recipe, labels));
    expect(notify).toHaveBeenCalledWith('Recipe copied');
  });

  it('does nothing when the person cancels the web share sheet', async () => {
    const abort = new Error('Share canceled');
    abort.name = 'AbortError';
    jest.spyOn(Share, 'share').mockRejectedValue(abort);

    await shareRecipe(recipe, labels, 'Recipe copied');

    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
