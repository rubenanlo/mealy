import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Field, Muted, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function SignInScreen() {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (err) {
      setError("Impossible d'envoyer le code. Vérifiez l'adresse e-mail.");
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
      setError('Code invalide ou expiré. Réessayez.');
    }
    // On success the auth listener re-routes to the tabs.
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}
      >
        <Title>Mealy</Title>
        <Body>Connexion</Body>
        {step === 'email' ? (
          <View style={{ gap: 16 }}>
            <Field
              value={email}
              onChangeText={setEmail}
              placeholder="Adresse e-mail"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              autoFocus
              onSubmitEditing={sendCode}
            />
            <Button
              label="Recevoir un code"
              onPress={sendCode}
              loading={busy}
              disabled={!email.includes('@')}
            />
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <Muted>Un code à 6 chiffres a été envoyé à {email.trim()}.</Muted>
            <Field
              value={code}
              onChangeText={setCode}
              placeholder="Code à 6 chiffres"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              onSubmitEditing={verifyCode}
            />
            <Button
              label="Se connecter"
              onPress={verifyCode}
              loading={busy}
              disabled={code.trim().length < 6}
            />
            <Button label="Changer d'adresse" kind="secondary" onPress={() => setStep('email')} />
          </View>
        )}
        {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
