import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, useTheme } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Filled icons for ALL states (v3.1 — active is the pill blob, not an icon swap). */
const TAB_ICONS: Record<string, IconName> = {
  library: 'home',
  search: 'search',
  plan: 'calendar',
  groceries: 'basket',
  settings: 'person-circle',
};

/**
 * v3.1: the real NYT bar — a floating capsule above the bottom safe area.
 * Content scrolls behind it; screens pad their scroll views ≈88 to clear it.
 */
function CapsuleTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 8 }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-evenly',
          height: 64,
          borderRadius: 999,
          backgroundColor: colors.card,
          paddingHorizontal: 6,
          ...Platform.select({
            ios: {
              shadowColor: '#000000',
              shadowOpacity: 0.12,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 4 },
            },
            android: { elevation: 8 },
            web: { boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)' } as object,
            default: {},
          }),
        }}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = options.title ?? route.name;
          const focused = state.index === index;
          const icon = TAB_ICONS[route.name] ?? 'ellipse';
          const color = focused ? colors.text : colors.textMuted;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole={Platform.OS === 'web' ? 'link' : 'button'}
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={onPress}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <View
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  borderRadius: 999,
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  // Active item: rounded-pill blob behind icon+label.
                  backgroundColor: focused ? colors.cardPressed : 'transparent',
                }}
              >
                <Ionicons name={icon} size={22} color={color} />
                <Text style={{ color, fontSize: 11, fontFamily: fonts.uiMedium }}>{label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { colors, dark } = useTheme();

  return (
    <Tabs
      tabBar={(props) => <CapsuleTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
      key={dark ? 'dark' : 'light'}
    >
      {/* Exactly five tabs — each directory has its own Stack layout, so no
          nested route (library/[id], settings/person/[id]) can ever register
          as a tab again. */}
      <Tabs.Screen name="library" options={{ title: 'Home' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="plan" options={{ title: 'Week' }} />
      <Tabs.Screen name="groceries" options={{ title: 'Groceries' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
