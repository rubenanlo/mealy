import { Alert, Platform } from 'react-native';

import { confirmDestructive, notify } from '@/lib/confirm';

// jest-expo's window is not a full jsdom: confirm/alert don't exist, so the
// web tests install them rather than spy on them.
const withWindowMock = <K extends 'confirm' | 'alert'>(key: K, impl: jest.Mock) => {
  (window as unknown as Record<string, unknown>)[key] = impl;
  return impl;
};

afterEach(() => {
  jest.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).confirm;
  delete (window as unknown as Record<string, unknown>).alert;
});

describe('confirmDestructive', () => {
  it('uses window.confirm on web and runs onConfirm when accepted', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const confirmSpy = withWindowMock('confirm', jest.fn().mockReturnValue(true));
    const onConfirm = jest.fn();

    confirmDestructive({
      title: 'Delete this recipe?',
      message: 'Gone for everyone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm,
    });

    expect(confirmSpy).toHaveBeenCalledWith('Delete this recipe?\n\nGone for everyone.');
    expect(onConfirm).toHaveBeenCalled();
  });

  it('does not run onConfirm when the web confirm is dismissed', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    withWindowMock('confirm', jest.fn().mockReturnValue(false));
    const onConfirm = jest.fn();

    confirmDestructive({
      title: 'Delete this recipe?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm,
    });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses a destructive Alert natively', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onConfirm = jest.fn();

    confirmDestructive({
      title: 'Delete this recipe?',
      message: 'Gone for everyone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm,
    });

    expect(alertSpy).toHaveBeenCalledWith('Delete this recipe?', 'Gone for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ]);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('notify', () => {
  it('uses window.alert on web (react-native-web Alert is a no-op)', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const alertSpy = withWindowMock('alert', jest.fn());

    notify('Could not delete', 'Try again.');

    expect(alertSpy).toHaveBeenCalledWith('Could not delete\n\nTry again.');
  });

  it('uses Alert.alert natively', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    notify('Could not delete', 'Try again.');

    expect(alertSpy).toHaveBeenCalledWith('Could not delete', 'Try again.');
  });
});
