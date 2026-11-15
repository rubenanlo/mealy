import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';

import { AddToWeekSheet } from '../add-to-week';

const mockInserts: { table: string; row: unknown }[] = [];

jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ householdId: 'hh-1' }) }));
jest.mock('@/lib/supabase', () => {
  // Chainable query stub: every filter returns itself; awaiting it yields no rows.
  const builder = (table: string) => {
    const result = { data: table === 'persons' ? [] : null, error: null, count: 0 };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'order', 'update', 'delete']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.single = () => Promise.resolve({ data: { id: 'plan-1' }, error: null });
    q.insert = (row: unknown) => {
      mockInserts.push({ table, row });
      return Object.assign(Promise.resolve({ error: null }), q);
    };
    q.then = (resolve: (v: unknown) => void) => resolve(result);
    return q;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

describe('AddToWeekSheet', () => {
  beforeEach(() => {
    mockInserts.length = 0;
    jest.useFakeTimers({ now: new Date(2026, 10, 12, 12, 0), doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => jest.useRealTimers());

  it('offers week chips and saves "No day yet" as an idea for the chosen week', async () => {
    const onClose = jest.fn();
    const { getByText, getByLabelText } = render(
      <ThemeProvider>
        <AddToWeekSheet visible recipeId="r1" recipeTitle="Riz sauté" onClose={onClose} />
      </ThemeProvider>
    );
    expect(getByText('Add to plan')).toBeTruthy();
    expect(getByText('This week')).toBeTruthy();
    expect(getByText('Next week')).toBeTruthy();

    // Wednesday is already past on Thursday the 12th.
    expect(getByLabelText('Wednesday Lunch')).toBeDisabled();

    fireEvent.press(getByText('Next week'));
    fireEvent.press(getByText('No day yet'));
    expect(getByText('Save idea for week of November 16')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Save idea for week of November 16'));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockInserts).toEqual([
      {
        table: 'plan_ideas',
        row: {
          household_id: 'hh-1',
          week_start: '2026-11-16',
          recipe_id: 'r1',
          custom_title: null,
          note: null,
        },
      },
    ]);
  });

  it('names the picked day and slot on the button', () => {
    const { getByText, getByLabelText } = render(
      <ThemeProvider>
        <AddToWeekSheet visible recipeId="r1" recipeTitle="Riz sauté" onClose={() => {}} />
      </ThemeProvider>
    );
    fireEvent.press(getByLabelText('Friday Dinner'));
    expect(getByText(/^Add to .*13.* · Dinner$/)).toBeTruthy();
  });
});
