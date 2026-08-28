import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Face ID / biometric sign-in. After a successful password sign-in the user
 * can opt in: the credentials go into the device keychain (this device only,
 * never synced), and the sign-in screen offers a one-tap biometric sign-in
 * that unlocks them. A failed password later (changed elsewhere) clears the
 * stored pair so a stale secret never lingers.
 */

const KEY = 'mealy.biometric-credentials';

export interface StoredCredentials {
  email: string;
  password: string;
}

export async function biometricsAvailable(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

export async function saveBiometricCredentials(email: string, password: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ email, password }), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadBiometricCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCredentials;
    return parsed.email && parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

export async function hasBiometricCredentials(): Promise<boolean> {
  return (await loadBiometricCredentials()) !== null;
}

export async function clearBiometricCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}

/** Show the system Face ID / fingerprint prompt; true only on success. */
export async function authenticateBiometric(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage });
    return result.success;
  } catch {
    return false;
  }
}
