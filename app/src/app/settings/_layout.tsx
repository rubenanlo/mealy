import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

/**
 * Settings lives outside the tab group (v3.1b): pushed from the Home
 * header's gear button, with person/[id] nested in this stack.
 */
export default function SettingsStack() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
