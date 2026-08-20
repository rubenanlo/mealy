import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';

import { minTapTarget, useTheme } from '@/lib/theme';

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 24, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { colors, dark } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.card, minHeight: minTapTarget },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
      key={dark ? 'dark' : 'light'}
    >
      <Tabs.Screen
        name="library"
        options={{
          title: 'Recettes',
          tabBarIcon: ({ color }) => <TabIcon glyph="📖" color={color} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Semaine',
          tabBarIcon: ({ color }) => <TabIcon glyph="🗓️" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Réglages',
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙️" color={color} />,
        }}
      />
    </Tabs>
  );
}
