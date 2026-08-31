import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';

import { OptionPickerHost } from '@/components/option-picker';
import { anchorFromEvent, pickOption } from '@/lib/options';
import { ThemeProvider } from '@/lib/theme';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pickOption (native)', () => {
  it('maps options to Alert.alert with ✓ on the checked entry and a cancel button', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onMetric = jest.fn();

    pickOption({
      title: 'Units',
      message: 'Hint',
      cancelLabel: 'Cancel',
      options: [
        { label: 'Original', onPress: () => {}, checked: true },
        { label: 'Metric', onPress: onMetric },
        { label: 'Delete', onPress: () => {}, destructive: true },
      ],
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Units');
    expect(message).toBe('Hint');
    expect(buttons).toHaveLength(4);
    expect(buttons?.[0]).toMatchObject({ text: 'Original ✓' });
    expect(buttons?.[2]).toMatchObject({ text: 'Delete', style: 'destructive' });
    expect(buttons?.[3]).toMatchObject({ text: 'Cancel', style: 'cancel' });
    buttons?.[1].onPress?.();
    expect(onMetric).toHaveBeenCalled();
  });
});

describe('OptionPickerHost (web)', () => {
  it('shows the dropdown, runs the tapped option, and closes', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const onMetric = jest.fn();
    const { getByLabelText, queryByLabelText, getByText } = render(
      <ThemeProvider>
        <OptionPickerHost />
      </ThemeProvider>
    );

    act(() =>
      pickOption({
        title: 'Units',
        message: 'Hint',
        cancelLabel: 'Cancel',
        anchor: { x: 40, y: 60 },
        options: [
          { label: 'Original', onPress: () => {}, checked: true },
          { label: 'Metric', onPress: onMetric },
        ],
      })
    );

    expect(getByText('Units')).toBeTruthy();
    expect(getByText('Hint')).toBeTruthy();
    fireEvent.press(getByLabelText('Metric'));
    expect(onMetric).toHaveBeenCalledTimes(1);
    expect(queryByLabelText('Metric')).toBeNull();
  });

  it('closes without running anything when the backdrop is tapped', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const onPress = jest.fn();
    const { getByLabelText, queryByLabelText } = render(
      <ThemeProvider>
        <OptionPickerHost />
      </ThemeProvider>
    );

    act(() =>
      pickOption({
        title: 'Units',
        cancelLabel: 'Cancel',
        options: [{ label: 'Original', onPress }],
      })
    );

    fireEvent.press(getByLabelText('Cancel'));
    expect(onPress).not.toHaveBeenCalled();
    expect(queryByLabelText('Original')).toBeNull();
  });
});

describe('anchorFromEvent', () => {
  it('extracts page coordinates and tolerates missing events', () => {
    expect(
      anchorFromEvent({ nativeEvent: { pageX: 12, pageY: 34 } } as never)
    ).toEqual({ x: 12, y: 34 });
    expect(anchorFromEvent(undefined)).toBeUndefined();
    expect(anchorFromEvent({ nativeEvent: {} } as never)).toBeUndefined();
  });
});
