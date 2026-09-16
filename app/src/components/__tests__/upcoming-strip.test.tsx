import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';

import { UpcomingMealsStrip, type UpcomingCell } from '../upcoming-strip';

function cell(over: Partial<UpcomingCell>): UpcomingCell {
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

  it('a dayLabel override replaces the weekday for future-week cells', () => {
    const { getByText, queryByText } = wrap(
      <UpcomingMealsStrip
        cells={[
          cell({ day: 0, slot: 'lunch', titles: ['Soup'] }),
          cell({
            day: 0,
            slot: 'lunch',
            titles: ['Stew'],
            recipeIds: ['r2'],
            weekIso: '2026-09-21',
            dayLabel: 'Monday 21',
          }),
        ]}
        todayIndex={0}
        onPressCell={() => {}}
      />
    );
    // Same day+slot in two weeks: both render, future one with its date label.
    expect(getByText('Today · Lunch · next')).toBeTruthy();
    expect(getByText('Monday 21 · Lunch')).toBeTruthy();
    expect(queryByText('Stew')).toBeTruthy();
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
