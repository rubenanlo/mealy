import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Eyebrow, SettingsGroup, SettingsRow, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  fonts,
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  useTheme,
  type ThemeOverride,
} from '@/lib/theme';

export default function SettingsScreen() {
  const { colors, override, setOverride } = useTheme();
  const router = useRouter();
  const { session, signOut } = useAuth();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: minTapTarget,
            alignSelf: 'flex-start',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Body style={{ fontFamily: fonts.uiSemi }}>Home</Body>
        </Pressable>
        <Title>Settings</Title>
        {session?.user.email ? <Body>{session.user.email}</Body> : null}

        <Eyebrow style={{ marginTop: 16 }}>Account</Eyebrow>
        <SettingsGroup>
          <SettingsRow
            label="Manage your account"
            onPress={() => router.push('/settings/account')}
          />
          <SettingsRow label="Log out" chevron={false} onPress={() => void signOut()} />
        </SettingsGroup>

        <Eyebrow style={{ marginTop: 16 }}>Preferences</Eyebrow>
        <SettingsGroup>
          <SettingsRow
            label="Meal preferences"
            onPress={() => router.push('/settings/meal-preferences')}
          />
        </SettingsGroup>

        <Eyebrow style={{ marginTop: 16 }}>Appearance</Eyebrow>
        <SettingsGroup>
          <View style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
            {(
              [
                ['system', 'System'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ] as [ThemeOverride, string][]
            ).map(([value, label]) => {
              const selected = override === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setOverride(value)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: minTapTarget,
                    borderRadius: radius.control,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected
                      ? colors.text
                      : pressed
                        ? colors.cardPressed
                        : 'transparent',
                    borderWidth: selected ? 0 : 1,
                    borderColor: colors.border,
                  })}
                >
                  <Text
                    style={{
                      color: selected ? colors.bg : colors.text,
                      fontSize: fontSize.base,
                      fontFamily: fonts.uiMedium,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
