import { fireEvent, render, within } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';

import { CarouselCard, Hero } from '../recipe-cards';

jest.mock('@/lib/use-canonical', () => ({ useCanonicalIndex: () => null }));

const RECIPE = {
  id: 'r1',
  title: 'Test risotto',
  tags: [],
  needs_review: false,
  cover_image_path: null,
  servings: 2,
  prep_minutes: 10,
  cook_minutes: 20,
};

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

// Web renders accessibilityRole="button" as a real <button>; a chip button
// nested inside the card button is invalid HTML (React hydration error).
// The calendar chip is gone from cards entirely (2026-08-31): the recipe
// page's "Add to this week" bar owns planning.
describe('recipe cards', () => {
  it('Hero: no calendar chip; bookmark chip is a sibling and both still fire', () => {
    const onPress = jest.fn();
    const onSave = jest.fn();
    const { getByLabelText, queryByLabelText } = wrap(
      <Hero recipe={RECIPE} saved={false} onPress={onPress} onSave={onSave} />
    );
    expect(queryByLabelText('Add to this week')).toBeNull();
    const card = getByLabelText('Open recipe Test risotto');
    expect(within(card).queryByLabelText('Save to a folder')).toBeNull();
    fireEvent.press(getByLabelText('Save to a folder'));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('CarouselCard: no calendar chip; bookmark chip is a sibling', () => {
    const { getByLabelText, queryByLabelText } = wrap(
      <CarouselCard recipe={RECIPE} saved={false} onPress={() => {}} onSave={() => {}} />
    );
    expect(queryByLabelText('Add to this week')).toBeNull();
    const card = getByLabelText('Open recipe Test risotto');
    expect(within(card).queryByLabelText('Save to a folder')).toBeNull();
    expect(getByLabelText('Save to a folder')).toBeTruthy();
  });

});
