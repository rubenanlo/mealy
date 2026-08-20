import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

/**
 * Nested stack so this directory registers as ONE tab route. Without a
 * layout, expo-router flattens `library/index` and `library/[id]` into the
 * Tabs navigator as separate (raw-named) tabs — the production-web bug.
 */
export default function LibraryStack() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
