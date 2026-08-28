import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { ConfirmHost } from '@/components/confirm-modal';
import { confirmDestructive } from '@/lib/confirm';
import { ThemeProvider } from '@/lib/theme';

const request = (onConfirm: jest.Mock) =>
  confirmDestructive({
    title: 'Delete this recipe?',
    message: 'Gone for everyone.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    onConfirm,
  });

describe('ConfirmHost (web confirm modal)', () => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'web'));
  afterEach(() => jest.restoreAllMocks());

  const mount = () =>
    render(
      <ThemeProvider>
        <ConfirmHost />
      </ThemeProvider>
    );

  it('shows the request in a modal and confirms', () => {
    const onConfirm = jest.fn();
    const screen = mount();

    act(() => request(onConfirm));

    expect(screen.getByText('Delete this recipe?')).toBeTruthy();
    expect(screen.getByText('Gone for everyone.')).toBeTruthy();

    fireEvent.press(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalled();
    expect(screen.queryByText('Delete this recipe?')).toBeNull();
  });

  it('cancel dismisses without confirming', () => {
    const onConfirm = jest.fn();
    const screen = mount();

    act(() => request(onConfirm));
    fireEvent.press(screen.getByText('Cancel'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this recipe?')).toBeNull();
  });
});
