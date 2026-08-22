import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { createFamily } from '@/lib/membership';
import { screenPadding, useTheme } from '@/lib/theme';

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const { session, signOut, refreshMembership } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noInvite, setNoInvite] = useState(false);
  const email = session?.user.email ?? 'your email address';

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createFamily(name.trim());
    } catch {
      setError('Could not create the family. Try again.');
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
        <Title>Welcome to Mealy</Title>

        <View style={{ gap: 12 }}>
          <Eyebrow>Start your family</Eyebrow>
          <Body>Create your family&apos;s cooking notebook. You can invite everyone else next.</Body>
          <Field
            value={name}
            onChangeText={setName}
            placeholder="Family name (e.g. The Andinos)"
            autoCapitalize="words"
            onSubmitEditing={() => void create()}
          />
          <Button
            label="Create family"
            onPress={() => void create()}
            loading={busy}
            disabled={!name.trim()}
          />
          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
        </View>

        <Hairline />

        <View style={{ gap: 12 }}>
          <Eyebrow>Joining a family?</Eyebrow>
          <Body>
            Ask a family member to invite {email} from Settings → Family, then check again.
          </Body>
          <Button
            label="Check for an invite"
            kind="secondary"
            onPress={() => void checkInvite()}
            loading={checking}
          />
          {noInvite ? <Muted>No invite for {email} yet.</Muted> : null}
        </View>

        <Button label="Sign out" kind="secondary" onPress={() => void signOut()} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
