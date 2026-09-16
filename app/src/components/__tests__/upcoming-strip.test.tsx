import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';
import type { MealCell } from '@/lib/meal-cells';

import { UpcomingMealsStrip } from '../upcoming-strip';

function cell(over: Partial<MealCell>): MealCell {
  return {
    day: 0,
    slot: 'lunch',
    titles: ['Soup'],
    covers: [null],
    recipeIds: ['r1'],
    servings: [2],
    eaters: [[]],
    dishRecipeIds: ['r1'],
    dishServings: [2],
    ...over,
  };
}

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('UpcomingMealsStrip', () => {
  it('labels the first cell as today + next, later cells by day name', () => {
    const { getByText } = wrap(
      <UpcomingMealsStrip
        cells={[
          cell({ day: 2, slot: 'dinner', titles: ['Soup'] }),
          cell({ day: 3, slot: 'lunch', titles: ['Stew'], recipeIds: ['r2'] }),
        ]}
        todayIndex={2}
        onPressCell={() => {}}
      />
    );
    expect(getByText('Today · Dinner · next')).toBeTruthy();
    expect(getByText('Thursday · Lunch')).toBeTruthy();
  });

  it('joins multi-dish titles and shows eaters per dish', () => {
    const { getByText } = wrap(
      <UpcomingMealsStrip
        cells={[
          cell({
            titles: ['Soup', 'Salad'],
            recipeIds: ['r1', 'r2'],
            eaters: [['Ana'], []],
          }),
        ]}
        todayIndex={0}
        onPressCell={() => {}}
      />
    );
    expect(getByText('Soup · Salad')).toBeTruthy();
    expect(getByText('Ana · Whole household')).toBeTruthy();
  });

  it('shows servings for single-recipe cells and fires onPressCell', () => {
    const onPressCell = jest.fn();
    const only = cell({ titles: ['Soup'], servings: [3] });
    const { getByText, getByLabelText } = wrap(
      <UpcomingMealsStrip cells={[only]} todayIndex={0} onPressCell={onPressCell} />
    );
    expect(getByText('Serves 3')).toBeTruthy();
    fireEvent.press(getByLabelText('Monday Lunch: Soup'));
    expect(onPressCell).toHaveBeenCalledWith(only);
  });
});
