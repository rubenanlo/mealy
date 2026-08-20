import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

/** One tab route for search (see library/_layout for why this exists). */
export default function SearchStack() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
