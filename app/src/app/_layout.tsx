import { Bitter_600SemiBold, Bitter_700Bold } from '@expo-google-fonts/bitter';
import {
  LibreFranklin_400Regular,
  LibreFranklin_500Medium,
  LibreFranklin_600SemiBold,
  useFonts,
} from '@expo-google-fonts/libre-franklin';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useKeepAwake } from 'expo-keep-awake';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { ConfirmHost } from '@/components/confirm-modal';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LanguageProvider } from '@/lib/i18n';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { hideWebScrollbars } from '@/lib/web-style';

// Keep the splash up until the display faces are ready (design.md §Type).
SplashScreen.preventAutoHideAsync().catch(() => {});
hideWebScrollbars();

function RootStack() {
  const { colors } = useTheme();
  const { session, membership } = useAuth();
  // Cooking with the recipe up: never let the screen sleep while the app is
  // foregrounded (the OS restores normal sleep once we're backgrounded).
  useKeepAwake();

  const restoring = session === undefined || (!!session && membership === undefined);
  if (restoring) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}
      >
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const signedIn = !!session;
  const hasHousehold = signedIn && !!membership;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)/sign-in" />
        <Stack.Screen name="(auth)/sign-up" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasHousehold}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={hasHousehold}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="folder/[id]" />
        <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
        {/* v3.2 bottom-sheet recipe page. iOS: native pageSheet (peek +
            rounded top + swipe-down). Android/web: transparent modal — the
            screen draws its own dimmed backdrop, 95%-height rounded
            container and slide-up animation (reduced-motion → fade). */}
        <Stack.Screen
          name="recipe/[id]"
          options={
            Platform.OS === 'ios'
              ? { presentation: 'modal' }
              : { presentation: 'transparentModal', animation: 'none' }
          }
        />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Bitter_700Bold,
    Bitter_600SemiBold,
    LibreFranklin_400Regular,
    LibreFranklin_500Medium,
    LibreFranklin_600SemiBold,
    // Explicitly load the icon font: on static web it otherwise renders
    // placeholder triangles until (never) fetched (v3.1 correction).
    ...Ionicons.font,
  });
  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    if (fontsReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);

  // Splash covers this; render nothing until the display face is ready.
  if (!fontsReady) return null;

  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <RootStack />
          <ConfirmHost />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
