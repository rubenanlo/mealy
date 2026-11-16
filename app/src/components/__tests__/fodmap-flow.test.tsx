import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FodmapFlowSheet } from '@/components/fodmap-flow';
import { checkRecipe, type FodmapListEntry } from '@/lib/fodmap-list';
import { ThemeProvider } from '@/lib/theme';
import { aiEditRecipe, fodmapAlternatives } from '@/lib/worker';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/worker', () => ({
  fodmapListMatch: jest.fn(),
  fodmapAlternatives: jest.fn(),
  aiEditRecipe: jest.fn(),
  aiAskRecipe: jest.fn(),
}));

const entry = (over: Partial<FodmapListEntry>): FodmapListEntry => ({
  id: over.name ?? 'x',
  name: 'x',
  category: null,
  overall: 'green',
  green_max: null,
  amber_qty: null,
  red_qty: null,
  unit: 'g',
  notes: null,
  ...over,
});

const garlic = entry({ name: 'Garlic, peeled, raw', overall: 'red', red_qty: 3 });
const garlicOil = entry({ name: 'Oil, garlic infused', overall: 'green', green_max: 15, unit: 'ml' });
const pepper = entry({ name: 'Bell pepper, red, raw', overall: 'red', green_max: 43, red_qty: 75 });
const entries = [garlic, garlicOil, pepper];

const row = (raw: string, quantity: number | null, unit: string | null, name: string) => ({
  raw,
  quantity,
  unit,
  name,
  group: null,
  fodmap: null,
});

const recipe = {
  title: 'Arroz chaufa',
  language: 'en',
  servings: 4,
  ingredients: [row('6 g garlic', 6, 'g', 'garlic'), row('160 g red pepper', 160, 'g', 'red pepper'), row('2 tbsp soy sauce', 2, 'tbsp', 'soy sauce')],
  steps: ['Fry the garlic.', 'Add the pepper.'],
};

const byRaw: Record<string, FodmapListEntry | null> = { '6 g garlic': garlic, '160 g red pepper': pepper };
const check = checkRecipe(recipe.ingredients, 4, (raw) => byRaw[raw] ?? null);

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const wrap = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>
  );

const base = {
  visible: true,
  recipe,
  status: 'ready' as const,
  check,
  entries,
  replacesExisting: false,
  saving: false,
  saveError: false,
  onClose: jest.fn(),
};

describe('FodmapFlowSheet', () => {
  it('shows flagged ingredients with their limits, then runs chat → choose → review → save', async () => {
    (fodmapAlternatives as jest.Mock).mockResolvedValue({
      message: 'Garlic oil keeps the taste.',
      alternatives: [
        {
          for_raw: '6 g garlic',
          options: [
            { line: '1 tbsp garlic-infused oil', quantity: 1, unit: 'tbsp', name: 'garlic oil', entry_index: 1, remove: false, recommended: true, note: '' },
            { line: 'Leave it out', quantity: null, unit: null, name: '', entry_index: null, remove: true, recommended: false, note: 'Ginger carries it.' },
          ],
        },
      ],
    });
    (aiEditRecipe as jest.Mock).mockResolvedValue({
      summary: 'Swapped the garlic.',
      title_suffix: '',
      ingredients: [
        { ...row('1 tbsp garlic-infused oil', 1, 'tbsp', 'garlic oil'), change: 'changed', was: '6 g garlic' },
        { ...row('160 g red pepper', 160, 'g', 'red pepper'), change: 'same', was: null },
        { ...row('2 tbsp soy sauce', 2, 'tbsp', 'soy sauce'), change: 'same', was: null },
      ],
      removed: [],
      steps: [{ text: 'Warm the garlic oil.', change: 'changed' }, { text: 'Add the pepper.', change: 'same' }],
      extra_minutes: null,
    });
    const onSave = jest.fn();
    const screen = wrap(<FodmapFlowSheet {...base} onSave={onSave} />);

    expect(screen.getByText(/some ingredients go over their limit/)).toBeTruthy();
    expect(screen.getByText(/1.5 g per serving\. No green amount in your list, red from 3 g\./)).toBeTruthy();
    expect(screen.getByText('OK at this amount')).toBeTruthy(); // pepper: rated red, 40 g ≤ 43 g
    expect(screen.getByText(/Not in your list: soy sauce/)).toBeTruthy();

    fireEvent.press(screen.getByText('Make a low-FODMAP version'));
    await waitFor(() => expect(screen.getByText('Garlic oil keeps the taste.')).toBeTruthy());
    expect((fodmapAlternatives as jest.Mock).mock.calls[0][0].flagged).toEqual([
      expect.objectContaining({ raw: '6 g garlic', entry: 'Garlic, peeled, raw' }),
    ]);

    fireEvent.press(screen.getByText('Choose my swaps'));
    expect(screen.getByText('1 tbsp garlic-infused oil')).toBeTruthy();
    expect(screen.getByText('3.8 ml per serving, green up to 15 ml.')).toBeTruthy();

    fireEvent.press(screen.getByText('Review 1 changes'));
    await waitFor(() => expect(screen.getByText('Warm the garlic oil.')).toBeTruthy());
    expect((aiEditRecipe as jest.Mock).mock.calls[0][1]).toContain('Replace "6 g garlic" with "1 tbsp garlic-infused oil"');
    expect(screen.getByText(/Rechecked: everything in your list is within its limit/)).toBeTruthy();

    fireEvent.press(screen.getByText('Save as My version'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Swapped the garlic.' }), 'Low-FODMAP: garlic swapped');
  });

  it('says so when the list is empty', () => {
    const screen = wrap(<FodmapFlowSheet {...base} status="empty" check={null} onSave={jest.fn()} />);
    expect(screen.getByText(/Your FODMAP list is empty/)).toBeTruthy();
    expect(screen.queryByText('Make a low-FODMAP version')).toBeNull();
  });
});
