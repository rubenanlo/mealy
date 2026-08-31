import { render } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';

import { useKeepAwakeSafe } from '../keep-awake';

function Probe() {
  useKeepAwakeSafe();
  return <Text>ok</Text>;
}

type Listener = () => void;

function makeFakeWakeLock() {
  const sentinels: { released: boolean; release: jest.Mock; listeners: Listener[] }[] = [];
  const request = jest.fn(async () => {
    const sentinel = {
      released: false,
      release: jest.fn(async () => {}),
      listeners: [] as Listener[],
      addEventListener(_: 'release', l: Listener) {
        sentinel.listeners.push(l);
      },
    };
    sentinels.push(sentinel);
    return sentinel;
  });
  return { request, sentinels };
}

describe('useKeepAwakeSafe (web)', () => {
  const originalDocument = (global as Record<string, unknown>).document;
  let docListeners: Record<string, Listener[]>;

  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
    docListeners = {};
    (global as Record<string, unknown>).document = {
      visibilityState: 'visible',
      addEventListener: (type: string, l: Listener) => {
        (docListeners[type] ??= []).push(l);
      },
      removeEventListener: () => {},
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (global as Record<string, unknown>).document = originalDocument;
  });

  async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('acquires the wake lock and re-acquires when the browser releases it', async () => {
    const fake = makeFakeWakeLock();
    Object.defineProperty(navigator, 'wakeLock', { value: fake, configurable: true });

    render(<Probe />);
    await flush();
    expect(fake.request).toHaveBeenCalledTimes(1);

    // Browser drops the lock while the page is still visible → retake it.
    fake.sentinels[0].listeners.forEach((l) => l());
    await flush();
    expect(fake.request).toHaveBeenCalledTimes(2);
  });

  it('releases the lock on unmount and stops re-acquiring', async () => {
    const fake = makeFakeWakeLock();
    Object.defineProperty(navigator, 'wakeLock', { value: fake, configurable: true });

    const { unmount } = render(<Probe />);
    await flush();
    unmount();
    expect(fake.sentinels[0].release).toHaveBeenCalled();
    fake.sentinels[0].listeners.forEach((l) => l());
    await flush();
    expect(fake.request).toHaveBeenCalledTimes(1);
  });
});
