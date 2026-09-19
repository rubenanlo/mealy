/**
 * Weekly rollover contract: the generated list derives from the CURRENT
 * week's meal plan (and checks are week-keyed), so it empties by itself when
 * a week passes — while user-added "Other" items persist until removed.
 *
 * Scenario B models "a week passed": the plan row exists only for LAST week,
 * exactly what the screen sees after the rollover.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/lib/theme';
import { addWeeks, weekStart } from '@/lib/plan';

import GroceriesScreen from '../(tabs)/groceries/index';

// week → plan row; reconfigured per test. Custom items carry the week they
// were added on and roll forward from there.
const mockDb: {
  plans: Record<string, { id: string }>;
  items: { id: string; label: string; week_start: string }[];
} = { plans: {}, items: [] };

jest.mock('@/lib/supabase', () => {
  const query = (table: string, filters: Record<string, unknown>) => {
    switch (table) {
      case 'meal_plans':
        return mockDb.plans[String(filters.week_start)] ?? null;
      case 'grocery_items': {
        // Errands roll forward: visible on their own week and every later one.
        const upto = filters.week_start_lte;
        return mockDb.items.filter((i) => !upto || i.week_start <= String(upto));
      }
      case 'persons':
        return [
          { id: 'p1', name: 'Ana', avatar_color: null, is_employee: false, diet_profile: {} },
          { id: 'p2', name: 'Ben', avatar_color: null, is_employee: false, diet_profile: {} },
        ];
      case 'plan_entries':
        return [
          {
            id: 'e1',
            recipe_id: 'r1',
            day: 0,
            slot: 'dinner',
            position: 0,
            person_ids: [],
            guest_count: 0,
          },
        ];
      case 'recipes':
        return [
          {
            id: 'r1',
            title: 'Test Salad',
            servings: 2,
            cover_image_path: null,
            ingredients: [
              { raw: '2 carrots', name: 'carrots', quantity: 2, unit: null, group: null, fodmap: null },
            ],
          },
        ];
      default:
        return []; // grocery_checks and anything else
    }
  };
  const makeBuilder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const resolve = () => Promise.resolve({ data: query(table, filters), error: null });
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'in', 'insert', 'upsert', 'delete']) {
      builder[method] = () => builder;
    }
    builder.eq = (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    };
    builder.lte = (column: string, value: unknown) => {
      filters[`${column}_lte`] = value;
      return builder;
    };
    builder.maybeSingle = resolve;
    builder.single = resolve;
    builder.then = (onFulfilled: never, onRejected: never) => resolve().then(onFulfilled, onRejected);
    return builder;
  };
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      channel: () => channel,
      removeChannel: async () => {},
    },
  };
});

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } } }),
  useHousehold: () => ({ householdId: 'hh-1' }),
}));

jest.mock('@/lib/i18n', () => {
  const { groceries } = jest.requireActual('@/lib/i18n/groceries');
  return {
    useI18n: () => ({ d: { groceries: groceries.en, common: { cancel: 'Cancel' } }, locale: 'en' }),
    fmt: (s: string, vars: Record<string, unknown>) =>
      s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k])),
  };
});

const carotte = {
  id: 'c1',
  slug: 'carotte',
  name_en: 'carrot',
  name_fr: 'carotte',
  name_es: 'zanahoria',
  name_it: 'carota',
  aliases: [],
  category: null,
  aisle: 'Fruits & Légumes',
  season: null,
  fodmap_tier: 'low',
  fodmap_groups: [],
  fodmap_swaps: [],
  low_serving_g: null,
  high_serving_g: null,
  avg_unit_weight_g: 125,
  density_g_per_ml: null,
  verified: true,
};

jest.mock('@/lib/matching', () => ({
  resolveMatches: async (raws: string[]) =>
    new Map(raws.map((raw) => [raw, { ingredient: carotte, normalized: raw }])),
}));

jest.mock('@/lib/units', () => ({
  resolveUnitOverrides: async () => new Map(),
}));

const metrics = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

/**
 * The list opens fully folded, so every content assertion below has to open
 * its section first — same tap the user makes.
 */
const openSection = (getByLabelText: (t: string) => unknown, name: string) =>
  fireEvent.press(getByLabelText(`Expand ${name}`) as Parameters<typeof fireEvent.press>[0]);

const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <GroceriesScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );

describe('groceries weekly rollover', () => {
  const thisWeek = weekStart(new Date());

  beforeEach(() => {
    mockDb.items = [{ id: 'g1', label: 'Palmolive', week_start: addWeeks(thisWeek, -1) }];
  });

  it('shows the generated list plus custom items during the planned week', async () => {
    mockDb.plans = { [thisWeek]: { id: 'plan-1' } };
    const { getByText, getByLabelText } = renderScreen();
    await waitFor(() => expect(getByText('Produce')).toBeTruthy()); // localized aisle
    openSection(getByLabelText, 'Produce');
    expect(getByText('Carrot')).toBeTruthy();
    expect(getByText('250 g')).toBeTruthy(); // 2 × 125 g
    openSection(getByLabelText, 'Other / errands');
    expect(getByText('Palmolive')).toBeTruthy();
  });

  it('opens with every section folded, and unfolds one on tap', async () => {
    mockDb.plans = { [thisWeek]: { id: 'plan-1' } };
    const { getByText, getAllByText, queryByText, getByLabelText } = renderScreen();
    await waitFor(() => expect(getByText('Produce')).toBeTruthy());
    // Headings and their counts only — no rows from any section. Produce and
    // Other/errands hold one line each, so a folded "1" shows on both.
    expect(getAllByText('1')).toHaveLength(2);
    expect(queryByText('Carrot')).toBeNull();
    expect(queryByText('Palmolive')).toBeNull();
    openSection(getByLabelText, 'Produce');
    expect(getByText('Carrot')).toBeTruthy();
    // Opening one section leaves the others alone.
    expect(queryByText('Palmolive')).toBeNull();
  });

  it('carries an errand added on an earlier week into the current one', async () => {
    mockDb.plans = { [thisWeek]: { id: 'plan-1' } };
    mockDb.items = [
      { id: 'g1', label: 'Seda dental', week_start: addWeeks(thisWeek, -3) },
      // Added while viewing next week — must not leak backwards into this one.
      { id: 'g2', label: 'Picard', week_start: addWeeks(thisWeek, 1) },
    ];
    const { getByText, queryByText, getByLabelText } = renderScreen();
    await waitFor(() => expect(getByText('Other / errands')).toBeTruthy());
    openSection(getByLabelText, 'Other / errands');
    expect(getByText('Seda dental')).toBeTruthy();
    expect(queryByText('Picard')).toBeNull();
  });

  it('empties the generated list a week later but keeps the Other items', async () => {
    // The plan exists only for LAST week — what the screen sees post-rollover.
    mockDb.plans = { [addWeeks(thisWeek, -1)]: { id: 'plan-1' } };
    const { getByText, queryByText, getByLabelText } = renderScreen();
    await waitFor(() => expect(getByText('No meals planned this week.')).toBeTruthy());
    expect(queryByText('Produce')).toBeNull();
    openSection(getByLabelText, 'Other / errands');
    expect(getByText('Palmolive')).toBeTruthy();
    expect(queryByText('Carrot')).toBeNull();
  });
});
