import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Eyebrow, Field, Muted, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { fontSize, screenPadding, useTheme } from '@/lib/theme';

export default function SignInScreen() {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (err) {
      setError('Could not send the code. Check the email address.');
    } else {
      setStep('code');
    }
  };

  const verifyCode = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (err) {
      setError('Invalid or expired code. Request a new one and try again.');
    }
    // On success the auth listener re-routes to the tabs.
  };

  const signInWithPassword = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (err) {
      setError('Incorrect email or password. Try again.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: screenPadding, gap: 16 }}
      >
        <View style={{ gap: 6, marginBottom: 8 }}>
          <Title style={{ fontSize: fontSize.wordmark }}>Mealy</Title>
          <Eyebrow>The family cooking notebook</Eyebrow>
        </View>

        {step === 'email' ? (
          <View style={{ gap: 12 }}>
            <Card style={{ gap: 16 }}>
              <Field
                value={email}
                onChangeText={setEmail}
                placeholder="Email address"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                autoFocus
                onSubmitEditing={sendCode}
              />
              <Button
                label="Send a code"
                onPress={sendCode}
                loading={busy}
                disabled={!email.includes('@')}
              />
            </Card>
            <Button
              label="Use a password"
              kind="secondary"
              onPress={() => setStep('password')}
              disabled={!email.includes('@')}
            />
          </View>
        ) : step === 'password' ? (
          <View style={{ gap: 12 }}>
            <Card style={{ gap: 16 }}>
              <Muted>Signing in with a password as {email.trim()}.</Muted>
              <Field
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                secureTextEntry
                autoCapitalize="none"
                autoFocus
                onSubmitEditing={signInWithPassword}
              />
              <Button
                label="Sign in"
                onPress={signInWithPassword}
                loading={busy}
                disabled={password.length < 8}
              />
            </Card>
            <Button label="Use a different email" kind="secondary" onPress={() => setStep('email')} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Card style={{ gap: 16 }}>
              <Muted>A 6-digit code was sent to {email.trim()}.</Muted>
              <Field
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                onSubmitEditing={verifyCode}
              />
              <Button
                label="Sign in"
                onPress={verifyCode}
                loading={busy}
                disabled={code.trim().length < 6}
              />
            </Card>
            <Button label="Use a different email" kind="secondary" onPress={() => setStep('email')} />
          </View>
        )}
        {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
