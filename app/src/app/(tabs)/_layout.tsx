import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { fonts, useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const { colors, dark } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Monochrome tab bar: active = text color, NOT red (design.md §Chrome).
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
        options={{
          title: 'Recipes',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Week',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-clear-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="groceries"
        options={{
          title: 'Groceries',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="basket-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
