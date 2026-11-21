import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/lib/theme';

import ImportPlanScreen from '../(tabs)/plan/import';

const mockReplace = jest.fn();
const mockWrites: { table: string; op: string; rows: unknown }[] = [];
const mockImport = jest.fn();

jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ householdId: 'hh-1' }) }));
jest.mock('@/lib/confirm', () => ({ notify: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/lib/worker', () => ({
  aiImportPlan: (body: unknown) => mockImport(body),
  aiPlanText: jest.fn(),
}));
jest.mock('@/lib/supabase', () => {
  const data: Record<string, unknown[]> = {
    persons: [
      { id: 'r', name: 'Ruben', is_employee: false },
      { id: 'p', name: 'Patricia', is_employee: false },
      { id: 'm', name: 'Marc', is_employee: false },
      { id: 's', name: 'Sindy', is_employee: true },
    ],
    recipes: [{ id: 'r-tacos', title: 'Tacos de pollo', recipe_translations: [] }],
    plan_import_matches: [{ phrase: 'arros chaufa', recipe_id: null, custom_title: 'Arroz chaufa' }],
    meal_plans: [],
  };
  const builder = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'delete']) q[m] = () => q;
    for (const op of ['insert', 'upsert']) {
      q[op] = (rows: unknown) => {
        mockWrites.push({ table, op, rows });
        return q;
      };
    }
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.single = () => Promise.resolve({ data: { id: `plan-${mockWrites.length}` }, error: null });
    q.then = (resolve: (v: unknown) => void) => resolve({ data: data[table] ?? [], error: null });
    return q;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

const dish = (phrase: string, title: string, recipe_id: string | null = null) => ({ phrase, title, recipe_id });
const meal = (over: Record<string, unknown>) => ({
  day_word: 'Dijous',
  day_index: 0,
  weekday: 3,
  slot: 'lunch',
  source: 'x',
  eating_out: false,
  main: null,
  sides: [],
  extra_dishes: [],
  away_names: [],
  employee_part: null,
  employee_whole: false,
  undecided: false,
  options: [],
  note: null,
  ...over,
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrap = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ImportPlanScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );

describe('Import a plan', () => {
  beforeEach(() => {
    mockWrites.length = 0;
    mockReplace.mockClear();
    // Saturday 21 Nov 2026: the plan's Thursday is the 26th.
    jest.useFakeTimers({ now: new Date(2026, 10, 21, 12, 0), doNotFake: ['nextTick', 'setImmediate'] });
    mockImport.mockResolvedValue({
      meals: [
        meal({ slot: 'lunch', source: 'amanida Centr? O fora...', main: dish('amanida Centr', 'Amanida Centre'), undecided: true, options: ['Amanida Centre', 'Fora'] }),
        meal({ slot: 'dinner', source: 'tacos pollastre (Sindy patates)', main: dish('tacos pollastre', 'Tacos de pollastre', 'r-tacos'), employee_part: 'patates' }),
        meal({ day_word: 'Diumenge', day_index: 1, weekday: 6, slot: 'lunch', source: 'fora', eating_out: true }),
        meal({ day_word: 'Diumenge', day_index: 1, weekday: 6, slot: 'dinner', source: 'arros chaufa', main: dish('arros chaufa', 'Arròs chaufa') }),
      ],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('reads a pasted plan, lets you settle questions and saves it', async () => {
    const screen = wrap();
    fireEvent.changeText(screen.getByLabelText('Paste text'), 'Dijous:\n• amanida…');
    await waitFor(() => expect(screen.getByText('Read the plan')).toBeTruthy());
    // Persons load asynchronously; wait until the button is enabled.
    await waitFor(() => {
      fireEvent.press(screen.getByText('Read the plan'));
      expect(mockImport).toHaveBeenCalled();
    });
    const body = mockImport.mock.calls[0][0];
    expect(body.people).toContainEqual({ id: 's', name: 'Sindy', employee: true });
    expect(body.remembered).toEqual([{ phrase: 'arros chaufa', recipe_id: null, title: 'Arroz chaufa' }]);

    await waitFor(() => expect(screen.getByText('Check the plan')).toBeTruthy());
    expect(screen.getByText('Tacos de pollo')).toBeTruthy();
    expect(screen.getByText('Sindy: patates')).toBeTruthy();
    expect(screen.getByText('Marc away')).toBeTruthy();
    expect(screen.getByText('Everyone out')).toBeTruthy();
    // Remembered from an earlier import.
    expect(screen.getByText('Arroz chaufa')).toBeTruthy();
    expect(screen.getByText('Remembered')).toBeTruthy();
    // Thursday has both meals, Sunday too: one undecided meal to check.
    expect(screen.getByText('1 to check')).toBeTruthy();

    fireEvent.press(screen.getByText('Fora'));
    expect(screen.queryByText('1 to check')).toBeNull();

    fireEvent.press(screen.getByText('Add 4 meals as a draft'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/plan/detail', params: { week: '2026-11-23' } });

    const entries = mockWrites.find((w) => w.table === 'plan_entries')?.rows as Record<string, unknown>[];
    expect(entries.map((e) => [e.day, e.slot, e.recipe_id ?? e.custom_title, e.assigned_cook])).toEqual([
      [3, 'dinner', 'r-tacos', 'employee'],
      [6, 'dinner', 'Arroz chaufa', 'family'],
    ]);
    const absences = mockWrites.find((w) => w.table === 'plan_absences')?.rows as Record<string, unknown>[];
    // Thursday lunch out for everyone, Sunday lunch out for everyone.
    expect(absences).toHaveLength(6);
    const matches = mockWrites.find((w) => w.table === 'plan_import_matches')?.rows as Record<string, unknown>[];
    expect(matches.map((m) => [m.phrase, m.recipe_id ?? m.custom_title])).toEqual([
      ['tacos pollastre', 'r-tacos'],
      ['arros chaufa', 'Arroz chaufa'],
    ]);
  });
});
