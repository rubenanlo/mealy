import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — check app/.env'
  );
}

// AsyncStorage needs `window`; expo-router's static web rendering runs in Node
const isServerRender = typeof window === 'undefined';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    ...(isServerRender ? {} : { storage: AsyncStorage }),
    autoRefreshToken: !isServerRender,
    persistSession: !isServerRender,
    // Web signs in with Google via the OAuth redirect flow; the tokens come
    // back in the URL hash and must be picked up on load. Native uses id-token
    // sign-in, so URL detection stays off there.
    detectSessionInUrl: Platform.OS === 'web' && !isServerRender,
  },
});
