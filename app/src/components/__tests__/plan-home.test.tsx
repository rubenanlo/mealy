import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/lib/theme';

import { InstructionsSheet } from '../week/instructions-sheet';
import { PlanHome } from '../week/plan-home';

const mockPush = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ householdId: 'hh-1' }) }));
jest.mock('@/lib/use-canonical', () => ({ useCanonicalIndex: () => null }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, back: jest.fn() }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});
jest.mock('@/lib/supabase', () => {
  const entry = (over: Record<string, unknown>) => ({
    id: 'x',
    meal_plan_id: 'cur',
    day: 0,
    slot: 'dinner',
    recipe_id: null,
    custom_title: null,
    assigned_cook: 'family',
    person_ids: [],
    guest_count: 0,
    position: 0,
    cook_part: false,
    instructions: null,
    ...over,
  });
  const data: Record<string, unknown[]> = {
    persons: [
      { id: 'r', name: 'Ruben', is_employee: false, share_token: null },
      { id: 'm', name: 'Marc', is_employee: false, share_token: null },
      { id: 'e', name: 'Rosa', is_employee: true, share_token: 'tok' },
    ],
    meal_plans: [
      { id: 'next', week_start: '2026-11-16', status: 'draft', employee_notes: [] },
      { id: 'cur', week_start: '2026-11-09', status: 'approved', employee_notes: ['Iron shirts'] },
      { id: 'old', week_start: '2026-11-02', status: 'approved', employee_notes: ['Clean the oven'] },
    ],
    plan_entries: [
      entry({ id: 'e1', day: 6, slot: 'dinner', recipe_id: 'salmon' }),
      entry({ id: 'e2', day: 6, slot: 'dinner', custom_title: 'Rice', position: 1 }),
      entry({ id: 'e3', day: 2, slot: 'lunch', recipe_id: 'soup', assigned_cook: 'employee', cook_part: true, instructions: 'Only the stock' }),
      entry({ id: 'e4', meal_plan_id: 'next', day: 0, slot: 'lunch', recipe_id: 'soup' }),
      entry({ id: 'e5', meal_plan_id: 'old', day: 1, slot: 'dinner', recipe_id: 'salmon' }),
    ],
    recipes: [
      { id: 'salmon', title: 'Salmon with dill', cover_image_path: null, tags: ['fish'], ingredients: null, dish_type: null },
      { id: 'soup', title: 'Lentil soup', cover_image_path: null, tags: [], ingredients: null, dish_type: null },
    ],
  };
  const builder = (table: string) => {
    const rows = data[table] ?? [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'order', 'delete', 'insert', 'upsert']) q[m] = () => q;
    q.update = (patch: unknown) => {
      mockUpdate(table, patch);
      return q;
    };
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.single = () => Promise.resolve({ data: null, error: null });
    q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return q;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrap = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>
  );

describe('PlanHome', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUpdate.mockClear();
    // Sunday noon: tonight's dinner is up next.
    jest.useFakeTimers({ now: new Date(2026, 10, 15, 12, 0), doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => jest.useRealTimers());

  it('shows up next, the weeks, the employee and past weeks', async () => {
    const { getByText, getAllByText } = wrap(<PlanHome />);
    await waitFor(() => expect(getByText('Today · Dinner')).toBeTruthy());
    expect(getByText('Up next')).toBeTruthy();
    expect(getByText(/\+ Rice/)).toBeTruthy();
    fireEvent.press(getByText('Open recipe'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'salmon', planServings: '2' } });

    expect(getByText('Coming up')).toBeTruthy();
    expect(getByText('This week · Nov 9–15')).toBeTruthy();
    expect(getByText('Next week · Nov 16–22')).toBeTruthy();

    expect(getByText('Rosa this week')).toBeTruthy();
    expect(getByText('Wednesday · Lunch · Part: Only the stock')).toBeTruthy();
    expect(getByText('Iron shirts')).toBeTruthy();
    expect(getByText('Send Rosa the link')).toBeTruthy();

    expect(getByText('Last week · Nov 2–8')).toBeTruthy();
    expect(getByText('1 meal · Fish 1')).toBeTruthy();
    expect(getAllByText('Rosa: 1 task').length).toBe(1);
  });

  it('opens a past week in a sheet', async () => {
    const { getByText } = wrap(<PlanHome />);
    await waitFor(() => expect(getByText('Last week · Nov 2–8')).toBeTruthy());
    fireEvent.press(getByText('Last week · Nov 2–8'));
    expect(getByText('Week of Nov 2')).toBeTruthy();
    expect(getByText('Instructions that week')).toBeTruthy();
    expect(getByText('Clean the oven')).toBeTruthy();
    expect(getByText('Copy to a week')).toBeTruthy();
  });

  it('saves edited instructions to this week’s plan', async () => {
    const { getByText, getByPlaceholderText } = wrap(<PlanHome />);
    await waitFor(() => expect(getByText('Edit')).toBeTruthy());
    fireEvent.press(getByText('Edit'));
    fireEvent.changeText(getByPlaceholderText('e.g. Clean the oven'), 'Sew a button');
    fireEvent.press(getByText('Done'));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('meal_plans', { employee_notes: ['Iron shirts', 'Sew a button'] })
    );
  });
});

describe('InstructionsSheet', () => {
  it('removes a line and brings back last week’s', () => {
    const onSave = jest.fn();
    const { getByText, getByLabelText } = wrap(
      <InstructionsSheet
        visible
        title="Instructions for Rosa"
        subtitle="Week of Nov 16"
        notes={['Iron shirts', 'Sew a button']}
        carryOver={['Clean the oven']}
        onSave={onSave}
        onClose={() => {}}
      />
    );
    fireEvent.press(getByLabelText('Remove Sew a button'));
    fireEvent.press(getByText('Add last week’s: Clean the oven'));
    fireEvent.press(getByText('Done'));
    expect(onSave).toHaveBeenCalledWith(['Iron shirts', 'Clean the oven']);
  });
});
