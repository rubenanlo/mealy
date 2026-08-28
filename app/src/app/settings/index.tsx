import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Eyebrow, SettingsGroup, SettingsRow, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { fonts, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session, signOut } = useAuth();
  const { d } = useI18n();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.common.back}
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
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.settings.home}</Body>
        </Pressable>
        <Title>{d.settings.title}</Title>
        {session?.user.email ? <Body>{session.user.email}</Body> : null}

        <Eyebrow style={{ marginTop: 16 }}>{d.settings.account}</Eyebrow>
        <SettingsGroup>
          <SettingsRow
            label={d.settings.manageAccount}
            onPress={() => router.push('/settings/account')}
          />
          <SettingsRow label={d.settings.logOut} chevron={false} onPress={() => void signOut()} />
        </SettingsGroup>

        <Eyebrow style={{ marginTop: 16 }}>{d.settings.preferences}</Eyebrow>
        <SettingsGroup>
          <SettingsRow
            label={d.settings.mealPreferences}
            onPress={() => router.push('/settings/meal-preferences')}
          />
          <SettingsRow
            label={d.settings.appearance}
            onPress={() => router.push('/settings/appearance')}
          />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
