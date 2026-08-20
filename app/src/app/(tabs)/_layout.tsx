import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { fonts, useTheme } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** v3 tab icon: outline when inactive → filled when active (NYT pattern). */
function tabIcon(outline: IconName, filled: IconName) {
  return function TabIcon({ color, size, focused }: { color: string; size: number; focused: boolean }) {
    return <Ionicons name={focused ? filled : outline} color={color} size={size} />;
  };
}

export default function TabsLayout() {
  const { colors, dark } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Monochrome tab bar: active = text color, NOT red (design.md v3).
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.uiMedium },
        sceneStyle: { backgroundColor: colors.bg },
      }}
      key={dark ? 'dark' : 'light'}
    >
      <Tabs.Screen
        name="library"
        options={{ title: 'Home', tabBarIcon: tabIcon('home-outline', 'home') }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Search', tabBarIcon: tabIcon('search-outline', 'search') }}
      />
      <Tabs.Screen
        name="plan"
        options={{ title: 'Week', tabBarIcon: tabIcon('calendar-outline', 'calendar') }}
      />
      <Tabs.Screen
        name="groceries"
        options={{ title: 'Groceries', tabBarIcon: tabIcon('basket-outline', 'basket') }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: tabIcon('person-circle-outline', 'person-circle'),
        }}
      />
    </Tabs>
  );
}
