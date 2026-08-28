import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Muted } from '@/components/ui';
import {
  authenticateBiometric,
  biometricsAvailable,
  clearBiometricCredentials,
  hasBiometricCredentials,
  loadBiometricCredentials,
  saveBiometricCredentials,
} from '@/lib/biometrics';
import { fmt, useI18n } from '@/lib/i18n';
import {
  appleAvailable,
  googleAvailable,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/social-auth';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, screenPadding, useTheme } from '@/lib/theme';

export default function SignInScreen() {
  const { colors } = useTheme();
  const { d } = useI18n();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appleReady, setAppleReady] = useState(false);
  const [biometricReady, setBiometricReady] = useState(false);
  const googleReady = googleAvailable();

  useEffect(() => {
    appleAvailable().then(setAppleReady);
    void Promise.all([biometricsAvailable(), hasBiometricCredentials()]).then(
      ([available, stored]) => setBiometricReady(available && stored)
    );
  }, []);

  const signInWithBiometrics = async () => {
    setError(null);
    if (!(await authenticateBiometric(d.auth.faceIdPrompt))) return;
    const credentials = await loadBiometricCredentials();
    if (!credentials) {
      setBiometricReady(false);
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword(credentials);
    setBusy(false);
    if (err) {
      // The password changed since it was stored — never keep a stale secret.
      await clearBiometricCredentials();
      setBiometricReady(false);
      setEmail(credentials.email);
      setStep('password');
      setError(d.auth.faceIdStale);
    }
    // On success the auth listener re-routes.
  };

  /** After a password sign-in on biometric hardware: offer one-tap next time. */
  const offerBiometrics = async (signedInEmail: string, signedInPassword: string) => {
    if (!(await biometricsAvailable()) || (await hasBiometricCredentials())) return;
    Alert.alert(d.auth.faceIdEnableTitle, d.auth.faceIdEnableBody, [
      { text: d.common.cancel, style: 'cancel' },
      {
        text: d.auth.faceIdEnable,
        onPress: () => void saveBiometricCredentials(signedInEmail, signedInPassword),
      },
    ]);
  };

  const withProvider = async (run: () => Promise<{ error: string | null }>) => {
    setBusy(true);
    setError(null);
    const { error: err } = await run();
    setBusy(false);
    if (err) setError(err);
    // On success the auth listener re-routes (same as OTP).
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (err) {
      setError(d.auth.sendFailed);
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
      setError(d.auth.otpInvalid);
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
      setError(d.auth.passwordWrong);
    } else {
      void offerBiometrics(email.trim(), password);
    }
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
          <Eyebrow>{d.auth.tagline}</Eyebrow>
          <Muted>{d.auth.signInIntro}</Muted>
        </View>

        {step === 'email' ? (
          <View style={{ gap: 12 }}>
            {biometricReady ? (
              <Button
                label={Platform.OS === 'ios' ? d.auth.signInFaceId : d.auth.signInBiometrics}
                onPress={() => void signInWithBiometrics()}
                loading={busy}
              />
            ) : null}
            <Field
              value={email}
              onChangeText={setEmail}
              placeholder={d.auth.emailAddress}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              autoFocus
              onSubmitEditing={sendCode}
            />
            <Button
              label={d.auth.sendCode}
              onPress={sendCode}
              loading={busy}
              disabled={!email.includes('@')}
            />
            <Button
              label={d.auth.usePassword}
              kind="secondary"
              onPress={() => setStep('password')}
              disabled={!email.includes('@')}
            />
            {googleReady || appleReady ? (
              <View style={{ gap: 12, marginTop: 8 }}>
                <Muted style={{ textAlign: 'center' }}>{d.common.or}</Muted>
                {googleReady ? (
                  <Button
                    label={d.auth.continueGoogle}
                    kind="secondary"
                    onPress={() => void withProvider(signInWithGoogle)}
                    disabled={busy}
                  />
                ) : null}
                {appleReady ? (
                  <Button
                    label={d.auth.continueApple}
                    kind="secondary"
                    onPress={() => void withProvider(signInWithApple)}
                    disabled={busy}
                  />
                ) : null}
              </View>
            ) : null}
            <Button
              label={d.auth.haveCode}
              kind="secondary"
              onPress={() => router.push('/sign-up')}
              disabled={busy}
            />
          </View>
        ) : step === 'password' ? (
          <View style={{ gap: 12 }}>
            <Muted>{fmt(d.auth.passwordAs, { email: email.trim() })}</Muted>
            <Field
              value={password}
              onChangeText={setPassword}
              placeholder={d.auth.password}
              secureTextEntry
              autoCapitalize="none"
              autoFocus
              onSubmitEditing={signInWithPassword}
            />
            <Button
              label={d.auth.signIn}
              onPress={signInWithPassword}
              loading={busy}
              disabled={password.length < 8}
            />
            <Button label={d.auth.useDifferentEmail} kind="secondary" onPress={() => setStep('email')} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Muted>{fmt(d.auth.codeSentTo, { email: email.trim() })}</Muted>
            <Field
              value={code}
              onChangeText={setCode}
              placeholder={d.auth.sixDigitCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              onSubmitEditing={verifyCode}
            />
            <Button
              label={d.auth.signIn}
              onPress={verifyCode}
              loading={busy}
              disabled={code.trim().length < 6}
            />
            <Button label={d.auth.useDifferentEmail} kind="secondary" onPress={() => setStep('email')} />
          </View>
        )}
        {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
