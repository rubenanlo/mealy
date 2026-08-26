import { workerUrl } from '../worker-url';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: null as string | null } },
}));

const constants = jest.requireMock('expo-constants').default as {
  expoConfig: { hostUri: string | null } | null;
};

describe('workerUrl', () => {
  const OLD_ENV = process.env.EXPO_PUBLIC_WORKER_URL;
  afterEach(() => {
    process.env.EXPO_PUBLIC_WORKER_URL = OLD_ENV;
    constants.expoConfig = { hostUri: null };
  });

  it('derives the worker URL from the Metro bundler host in Expo Go', () => {
    // The dev machine serves the bundle AND runs the worker, so its address
    // is always current even when DHCP reassigns the .env IP.
    constants.expoConfig = { hostUri: '192.168.68.50:8081' };
    expect(workerUrl()).toBe('http://192.168.68.50:8000');
  });

  it('keeps the configured port when the env var has one', () => {
    constants.expoConfig = { hostUri: '192.168.68.50:8081' };
    process.env.EXPO_PUBLIC_WORKER_URL = 'http://10.0.0.9:9999';
    expect(workerUrl()).toBe('http://192.168.68.50:9999');
  });

  it('falls back to the env var without a bundler host (production builds)', () => {
    constants.expoConfig = { hostUri: null };
    process.env.EXPO_PUBLIC_WORKER_URL = 'https://worker.example.com';
    expect(workerUrl()).toBe('https://worker.example.com');
  });

  it('returns null with neither source', () => {
    constants.expoConfig = null;
    delete process.env.EXPO_PUBLIC_WORKER_URL;
    expect(workerUrl()).toBeNull();
  });
});
