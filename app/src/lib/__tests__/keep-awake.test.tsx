import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { activateKeepAwakeAsync } from 'expo-keep-awake';

import { useKeepAwakeSafe } from '../keep-awake';

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.reject(new Error('NotAllowedError'))),
  deactivateKeepAwake: jest.fn(() => Promise.reject(new Error('NotAllowedError'))),
}));

function Probe() {
  useKeepAwakeSafe();
  return <Text>ok</Text>;
}

describe('useKeepAwakeSafe', () => {
  it('swallows wake-lock activation and deactivation failures', async () => {
    const onUnhandled = jest.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      const { getByText, unmount } = render(<Probe />);
      expect(getByText('ok')).toBeTruthy();
      expect(activateKeepAwakeAsync).toHaveBeenCalled();
      unmount();
      // Let the rejected promises settle.
      await new Promise((resolve) => setImmediate(resolve));
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
