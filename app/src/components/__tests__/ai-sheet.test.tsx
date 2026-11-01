import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AiActionsSheet, FodmapChatSheet, VersionToggle } from '@/components/ai-sheet';
import type { FodmapFlag } from '@/lib/fodmap';
import { ThemeProvider } from '@/lib/theme';

const flag = (raw: string, tier: 'high' | 'moderate', groups: string[]): FodmapFlag => ({
  name: raw,
  raw,
  tier,
  groups,
  portionG: null,
  explanation: '',
  swaps: [],
});

const row = (raw: string, name: string) => ({ raw, name, quantity: null, unit: null, group: null, fodmap: null });

const result = {
  swaps: [
    { raw: '1 onion', replacement: row('4 spring onions, green parts', 'spring onion'), note: 'Greens are low.' },
    { raw: '3 garlic cloves', replacement: row('2 tbsp garlic-infused oil', 'garlic oil'), note: '' },
  ],
  steps: ['Fry the spring onion.'],
};

const baseChat = {
  visible: true,
  recipeTitle: 'Chili',
  checkedCount: 9,
  servings: 4,
  flags: [flag('1 onion', 'high', ['fructan']), flag('3 garlic cloves', 'high', ['fructan'])],
  loading: false,
  failed: false,
  result,
  saving: false,
  saveError: false,
  updatesExisting: false,
  onRetry: jest.fn(),
  onClose: jest.fn(),
};

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const wrap = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>
  );

describe('AiActionsSheet', () => {
  it('runs the low-FODMAP action and keeps the others disabled', () => {
    const onLowFodmap = jest.fn();
    const screen = wrap(
      <AiActionsSheet visible onClose={jest.fn()} onLowFodmap={onLowFodmap} hasFodmapWork />
    );
    fireEvent.press(screen.getByText('Make it low-FODMAP'));
    expect(onLowFodmap).toHaveBeenCalled();
    expect(screen.getAllByText('Soon')).toHaveLength(3);
  });
});

describe('FodmapChatSheet', () => {
  it('lists the flagged lines with their tier and group', () => {
    const screen = wrap(<FodmapChatSheet {...baseChat} onSave={jest.fn()} />);
    expect(screen.getByText(/I checked 9 ingredients\. 2 high or moderate/)).toBeTruthy();
    expect(screen.getAllByText('High · fructans')).toHaveLength(2);
  });

  it('saves only the swaps still ticked', () => {
    const onSave = jest.fn();
    const screen = wrap(<FodmapChatSheet {...baseChat} onSave={onSave} />);
    fireEvent.press(screen.getAllByRole('checkbox')[1]);
    fireEvent.press(screen.getByText('Save version (1)'));
    expect(onSave).toHaveBeenCalledWith(new Set(['1 onion']));
  });

  it('offers a retry when the swaps request failed', () => {
    const onRetry = jest.fn();
    const screen = wrap(
      <FodmapChatSheet {...baseChat} result={null} failed onRetry={onRetry} onSave={jest.fn()} />
    );
    fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('says there is nothing to change when nothing is flagged', () => {
    const screen = wrap(<FodmapChatSheet {...baseChat} flags={[]} result={null} onSave={jest.fn()} />);
    expect(screen.getByText(/found nothing high-FODMAP/)).toBeTruthy();
    expect(screen.queryByText(/Save version/)).toBeNull();
  });
});

describe('VersionToggle', () => {
  it('switches to the other version only', () => {
    const onSelect = jest.fn();
    const screen = wrap(<VersionToggle active="original" onSelect={onSelect} />);
    fireEvent.press(screen.getByText('Original'));
    fireEvent.press(screen.getByText('Low-FODMAP'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('low_fodmap');
  });
});
