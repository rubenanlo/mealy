import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

/** One tab route for the week planner (see library/_layout for why). */
export default function PlanStack() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
