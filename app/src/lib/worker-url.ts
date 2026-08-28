import Constants from 'expo-constants';

const DEFAULT_WORKER_PORT = '8000';

/**
 * Where the Python worker lives.
 *
 * In Expo Go the bundler host IS the dev machine, which also runs the worker —
 * so derive the address from it. This survives DHCP reassigning the Mac's IP,
 * which a hardcoded EXPO_PUBLIC_WORKER_URL does not (the phone then hangs on a
 * ghost address until fetch times out). The env var still supplies the port,
 * and is the sole source in builds with no bundler (production).
 */
export function workerUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_WORKER_URL ?? null;
  const bundlerHost = Constants?.expoConfig?.hostUri?.split(':')[0];
  if (bundlerHost) {
    let port = DEFAULT_WORKER_PORT;
    if (configured) {
      try {
        port = new URL(configured).port || DEFAULT_WORKER_PORT;
      } catch {
        // Malformed env value: keep the default port.
      }
    }
    return `http://${bundlerHost}:${port}`;
  }
  return configured;
}
