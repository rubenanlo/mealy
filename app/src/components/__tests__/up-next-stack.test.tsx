import { fireEvent, render } from '@testing-library/react-native';

import { buildCells, type EntryRow } from '@/lib/meal-cells';
import { ThemeProvider } from '@/lib/theme';

import { UpNextCard } from '../week/up-next-card';

const row = (over: Partial<EntryRow>): EntryRow => ({
  meal_plan_id: 'p',
  day: 1,
  slot: 'dinner',
  recipe_id: null,
  custom_title: null,
  assigned_cook: 'family',
  person_ids: [],
  guest_count: 0,
  position: 0,
  ...over,
});

const recipes = new Map([
  ['pasta', { id: 'pasta', title: 'Pasta with tomato', cover_image_path: null }],
  ['salmon', { id: 'salmon', title: 'Salmon with lemon greens', cover_image_path: null }],
  ['greens', { id: 'greens', title: 'Green salad', cover_image_path: null }],
]);
const names = new Map([
  ['r', 'Ruben'],
  ['p', 'Patricia'],
  ['m', 'Marc'],
]);

// Marc's pasta was added first (lower position) so it used to be the "main" title.
const cells = buildCells(
  [
    row({ recipe_id: 'pasta', person_ids: ['m'], position: 0 }),
    row({ recipe_id: 'salmon', person_ids: ['p', 'r'], position: 1 }),
    row({ recipe_id: 'greens', person_ids: ['p', 'r'], position: 2 }),
  ],
  recipes,
  3,
  'Recipe',
  names
);

describe('Up next for a meal with several dishes (design G1)', () => {
  it('groups the meal into dishes, sides riding with their dish', () => {
    expect(cells[0]!.dishes).toEqual([
      { title: 'Pasta with tomato', cover: null, recipeId: 'pasta', servings: 1, eaters: ['Marc'], sides: [] },
      {
        title: 'Salmon with lemon greens',
        cover: null,
        recipeId: 'salmon',
        servings: 2,
        eaters: ['Patricia', 'Ruben'],
        sides: ['Green salad'],
      },
    ]);
  });

  it('shows a deck with both titles, then fans out with a recipe button per dish', () => {
    const onOpenRecipe = jest.fn();
    const { getByText, getAllByText, queryByText } = render(
      <ThemeProvider>
        <UpNextCard cell={cells[0]!} when="Today · Dinner" onOpenRecipe={onOpenRecipe} onPress={() => {}} />
      </ThemeProvider>
    );
    expect(getByText('Pasta with tomato')).toBeTruthy();
    expect(getByText('Salmon with lemon greens')).toBeTruthy();
    expect(getByText('2 dishes')).toBeTruthy();
    expect(queryByText('Open recipe')).toBeNull();
    fireEvent.press(getByText('See all 2 dishes'));
    const buttons = getAllByText('Open recipe');
    expect(buttons).toHaveLength(2);
    fireEvent.press(buttons[1]!);
    expect(onOpenRecipe).toHaveBeenCalledWith('salmon', 2);
    fireEvent.press(getByText('Stack them again'));
    expect(queryByText('Open recipe')).toBeNull();
  });
});
