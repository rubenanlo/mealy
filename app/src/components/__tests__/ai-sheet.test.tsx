import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AiActionsSheet, VersionToggle } from '@/components/ai-sheet';
import { ThemeProvider } from '@/lib/theme';

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
  it('routes each action to its handler', () => {
    const handlers = { onChange: jest.fn(), onAsk: jest.fn(), onUnits: jest.fn(), onLowFodmap: jest.fn() };
    const screen = wrap(<AiActionsSheet visible onClose={jest.fn()} {...handlers} hasFodmapWork />);
    fireEvent.press(screen.getByText('Change this recipe'));
    fireEvent.press(screen.getByText('Ask a question'));
    fireEvent.press(screen.getByText('Switch units'));
    fireEvent.press(screen.getByText('Make it low-FODMAP'));
    for (const fn of Object.values(handlers)) expect(fn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Soon')).toBeNull();
  });
});

describe('VersionToggle', () => {
  it('switches to the other version only', () => {
    const onSelect = jest.fn();
    const screen = wrap(
      <VersionToggle active="original" available={['original', 'low_fodmap']} onSelect={onSelect} />
    );
    fireEvent.press(screen.getByText('Original'));
    fireEvent.press(screen.getByText('Low-FODMAP'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('low_fodmap');
  });

  it('opens the manage sheet when the active My version is tapped', () => {
    const onSelect = jest.fn();
    const onActivePress = jest.fn();
    const screen = wrap(
      <VersionToggle
        active="custom"
        available={['original', 'custom']}
        onSelect={onSelect}
        onActivePress={onActivePress}
      />
    );
    fireEvent.press(screen.getByText('My version'));
    expect(onActivePress).toHaveBeenCalledWith('custom');
    fireEvent.press(screen.getByText('Original'));
    expect(onSelect).toHaveBeenCalledWith('original');
  });
});
