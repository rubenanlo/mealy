import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Eyebrow, SettingsGroup, SettingsRow, Title } from '@/components/ui';
import { LOCALES, useI18n } from '@/lib/i18n';
import { backOr } from '@/lib/nav';
import {
  fonts,
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  useTheme,
  type ThemeOverride,
} from '@/lib/theme';

export default function AppearanceScreen() {
  const { colors, override, setOverride } = useTheme();
  const router = useRouter();
  const { d, locale, setLocale } = useI18n();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.settings.backToSettings}
          onPress={() => backOr('/settings')}
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
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.settings.title}</Body>
        </Pressable>
        <Title>{d.settings.appearance}</Title>

        <Eyebrow style={{ marginTop: 16 }}>{d.settings.theme}</Eyebrow>
        <SettingsGroup>
          <View style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
            {(
              [
                ['system', d.settings.themeSystem],
                ['light', d.settings.themeLight],
                ['dark', d.settings.themeDark],
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

        {/* Personal UI language: applies immediately, follows the account. */}
        <Eyebrow style={{ marginTop: 16 }}>{d.settings.language}</Eyebrow>
        <SettingsGroup>
          {LOCALES.map((option) => (
            <SettingsRow
              key={option.code}
              label={option.label}
              value={locale === option.code ? '✓' : undefined}
              chevron={false}
              onPress={() => void setLocale(option.code)}
            />
          ))}
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
