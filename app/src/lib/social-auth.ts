import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Native token sign-in for Apple and Google. Both modules are loaded lazily so
 * the app still boots in Expo Go (SDK 54 pin): when a native module is absent
 * the corresponding button simply never renders.
 */

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export async function appleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const Apple = require('expo-apple-authentication');
    return await Apple.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<{ error: string | null }> {
  try {
    const Apple = require('expo-apple-authentication');
    const credential = await Apple.signInAsync({
      requestedScopes: [
        Apple.AppleAuthenticationScope.FULL_NAME,
        Apple.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) return { error: 'Apple sign-in did not complete. Try again.' };
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    return { error: error ? 'Could not sign in with Apple. Try again.' : null };
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return { error: null };
    return { error: 'Could not sign in with Apple. Try again.' };
  }
}

export function googleAvailable(): boolean {
  if (!GOOGLE_WEB_CLIENT_ID) return false;
  try {
    require('@react-native-google-signin/google-signin');
    return true;
  } catch {
    return false;
  }
}

interface GoogleSignInResult {
  type?: string;
  idToken?: string | null;
  data?: { idToken?: string | null } | null;
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  try {
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID,
    });
    await GoogleSignin.hasPlayServices?.();
    const result = (await GoogleSignin.signIn()) as GoogleSignInResult;
    // v13+ wraps the payload; older shapes carry idToken at the top level.
    const idToken = result?.data?.idToken ?? result?.idToken ?? null;
    if (result?.type === 'cancelled' || !idToken) return { error: null };
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    return { error: error ? 'Could not sign in with Google. Try again.' : null };
  } catch {
    return { error: 'Could not sign in with Google. Try again.' };
  }
}
