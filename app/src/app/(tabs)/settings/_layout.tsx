import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

/** One tab route for settings; person/[id] stays nested (see library/_layout). */
export default function SettingsStack() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
