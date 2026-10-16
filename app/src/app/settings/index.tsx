import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Eyebrow, SettingsGroup, SettingsRow, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { confirmDestructive, notify } from '@/lib/confirm';
import { useI18n } from '@/lib/i18n';
import { backOr } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { fonts, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session, signOut } = useAuth();
  const { d } = useI18n();

  // Personal key for the "Add to Mealy" iOS Shortcut (share-capture edge
  // function): the Shortcut's only credential, so it can be rotated here.
  const copyShareKey = async (rpc: 'my_share_capture_key' | 'rotate_share_capture_key') => {
    const { data, error } = await supabase.rpc(rpc);
    if (error || typeof data !== 'string') {
      notify(d.settings.shareKeyFailedTitle, error?.message);
      return;
    }
    await Clipboard.setStringAsync(data);
    notify(d.settings.shareKeyCopiedTitle, d.settings.shareKeyCopiedBody);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.common.back}
          onPress={() => backOr('/(tabs)/library')}
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

        <Eyebrow style={{ marginTop: 16 }}>{d.settings.shareSheet}</Eyebrow>
        <SettingsGroup>
          <SettingsRow
            label={d.settings.copyShareKey}
            chevron={false}
            onPress={() => void copyShareKey('my_share_capture_key')}
          />
          <SettingsRow
            label={d.settings.resetShareKey}
            chevron={false}
            onPress={() =>
              confirmDestructive({
                title: d.settings.resetShareKeyTitle,
                message: d.settings.resetShareKeyBody,
                confirmLabel: d.settings.reset,
                cancelLabel: d.common.cancel,
                onConfirm: () => void copyShareKey('rotate_share_capture_key'),
              })
            }
          />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
