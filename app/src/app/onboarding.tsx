import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmt, useI18n } from '@/lib/i18n';
import { createFamily } from '@/lib/membership';
import { screenPadding, useTheme } from '@/lib/theme';

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const { d } = useI18n();
  const { session, signOut, refreshMembership } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noInvite, setNoInvite] = useState(false);
  const email = session?.user.email ?? d.onboarding.emailFallback;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createFamily(name.trim());
    } catch {
      setError(d.onboarding.createError);
    } finally {
      // Also covers the invited-meanwhile / double-tap races: whatever
      // membership now exists, routing follows it.
      await refreshMembership();
      setBusy(false);
    }
  };

  const checkInvite = async () => {
    setChecking(true);
    setNoInvite(false);
    await refreshMembership();
    // Still on this screen afterwards ⇒ nothing was claimed.
    setNoInvite(true);
    setChecking(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: screenPadding, gap: 16 }}
      >
        <Title>{d.onboarding.welcome}</Title>

        <View style={{ gap: 12 }}>
          <Eyebrow>{d.onboarding.startFamily}</Eyebrow>
          <Body>{d.onboarding.startBody}</Body>
          <Field
            value={name}
            onChangeText={setName}
            placeholder={d.onboarding.namePlaceholder}
            autoCapitalize="words"
            onSubmitEditing={() => void create()}
          />
          <Button
            label={d.onboarding.createFamily}
            onPress={() => void create()}
            loading={busy}
            disabled={!name.trim()}
          />
          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
        </View>

        <Hairline />

        <View style={{ gap: 12 }}>
          <Eyebrow>{d.onboarding.joining}</Eyebrow>
          <Body>{fmt(d.onboarding.joiningBody, { email })}</Body>
          <Button
            label={d.onboarding.checkInvite}
            kind="secondary"
            onPress={() => void checkInvite()}
            loading={checking}
          />
          {noInvite ? <Muted>{fmt(d.onboarding.noInvite, { email })}</Muted> : null}
        </View>

        <Button label={d.onboarding.signOut} kind="secondary" onPress={() => void signOut()} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
