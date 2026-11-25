import { render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/lib/theme';

import { WeekPage } from '../week/week-page';

jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ householdId: 'hh-1' }) }));
jest.mock('@/lib/use-canonical', () => ({ useCanonicalIndex: () => null }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});
jest.mock('@/lib/supabase', () => {
  const persons = [
    { id: 'r', name: 'Ruben', is_employee: false, diet_profile: null },
    { id: 'm', name: 'Marc', is_employee: false, diet_profile: null },
    { id: 'e', name: 'Rosa', is_employee: true, diet_profile: null, share_token: 'tok' },
  ];
  const builder = (table: string) => {
    const rows = table === 'persons' ? persons : [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'order', 'update', 'delete', 'insert', 'upsert']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.single = () => Promise.resolve({ data: null, error: null });
    q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return q;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

describe('WeekPage', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 10, 15, 12, 0), doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => jest.useRealTimers());

  it('renders chips, progress and empty meals for an empty week', async () => {
    const { getByText, getAllByText, getByLabelText } = render(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <WeekPage />
        </ThemeProvider>
      </SafeAreaProvider>
    );
    // The header names the week being planned.
    expect(getByText('THIS WEEK')).toBeTruthy();
    expect(getAllByText('Nov 9 – 15').length).toBeGreaterThan(0);
    // Eating out, ideas, copy, import and delete live in the week's ··· menu.
    expect(getByLabelText('More for this week')).toBeTruthy();
    await waitFor(() => expect(getByText('0 of 14')).toBeTruthy());
    expect(getByText('This week')).toBeTruthy();
    expect(getByText('Last week')).toBeTruthy();
    // Sunday: only today's two meals are left this week.
    expect(getAllByText(/^\+ Add (lunch|dinner)$/).length).toBe(2);
    expect(getByText('Fill 2 with AI')).toBeTruthy();
  });
});
