import { router } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Muted } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, screenPadding, useTheme } from '@/lib/theme';

const CODE_ERROR = 'That code is invalid or expired.';

export default function SignUpScreen() {
  const { colors } = useTheme();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [step, setStep] = useState<'code' | 'email' | 'verify'>('code');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkCode = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('validate_signup_code', {
      p_code: code.trim(),
    });
    setBusy(false);
    if (err) {
      setError('Could not check the code. Try again.');
      return;
    }
    if (data === 'valid') {
      setStep('email');
    } else if (data === 'used') {
      setError('That code has already been used.');
    } else {
      setError(CODE_ERROR);
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    // The signup code rides along as user metadata so the account-creation
    // trigger can verify and redeem it. A rejected code surfaces here.
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { data: { signup_code: code.trim() } },
    });
    setBusy(false);
    if (err) {
      setError(CODE_ERROR);
    } else {
      setStep('verify');
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'email',
    });
    setBusy(false);
    if (err) {
      setError(CODE_ERROR);
    }
    // On success the auth listener re-routes to onboarding to create the family.
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: screenPadding, gap: 16 }}
      >
        <View style={{ gap: 6, marginBottom: 8 }}>
          <Image
            source={require('../../../assets/images/brand-icon-source.png')}
            style={{ width: 44, height: 44, marginBottom: 4 }}
            accessibilityIgnoresInvertColors
          />
          <Text
            accessibilityRole="header"
            style={{
              color: colors.text,
              fontSize: fontSize.wordmark,
              letterSpacing: -0.3,
              fontFamily: fonts.display,
            }}
          >
            Mealy
          </Text>
          <Eyebrow>The family cooking notebook</Eyebrow>
          <Muted>Enter the code your admin sent you to create your family.</Muted>
        </View>

        {step === 'code' ? (
          <View style={{ gap: 12 }}>
            <Field
              value={code}
              onChangeText={setCode}
              placeholder="Signup code"
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              onSubmitEditing={checkCode}
            />
            <Button
              label="Continue"
              onPress={checkCode}
              loading={busy}
              disabled={code.trim().length < 4}
            />
            <Button label="Sign in instead" kind="secondary" onPress={() => router.back()} />
          </View>
        ) : step === 'email' ? (
          <View style={{ gap: 12 }}>
            <Muted>Code accepted. Where should we send your sign-in code?</Muted>
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
            <Button label="Back" kind="secondary" onPress={() => setStep('code')} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Muted>A 6-digit code was sent to {email.trim()}.</Muted>
            <Field
              value={token}
              onChangeText={setToken}
              placeholder="6-digit code"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              onSubmitEditing={verify}
            />
            <Button
              label="Create my family"
              onPress={verify}
              loading={busy}
              disabled={token.trim().length < 6}
            />
            <Button label="Use a different email" kind="secondary" onPress={() => setStep('email')} />
          </View>
        )}
        {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
