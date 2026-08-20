import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

/** One tab route for groceries (see library/_layout for why). */
export default function GroceriesStack() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
