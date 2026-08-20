import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Field, Muted, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import {
  captureFromImages,
  captureFromPdf,
  captureFromText,
  captureFromUrl,
  detectCaptureKind,
  type CaptureOutcome,
  type MediaAsset,
} from '@/lib/worker';

export default function CaptureScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const membership = useHousehold();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPaste, setNeedsPaste] = useState(false);

  type Ctx = { householdId: string; userId: string };

  const finish = (outcome: CaptureOutcome) => {
    if (outcome.recipeId) {
      router.replace(`/library/${outcome.recipeId}`);
    } else {
      setNeedsPaste(true);
    }
  };

  const run = async (fn: (ctx: Ctx) => Promise<CaptureOutcome>) => {
    setBusy(true);
    setError(null);
    setNeedsPaste(false);
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) throw new Error('Session expirée — reconnectez-vous.');
      finish(await fn({ householdId: membership.householdId, userId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue pendant l'import.");
    } finally {
      setBusy(false);
    }
  };

  const capturePasted = () => {
    const kind = detectCaptureKind(input);
    void run((ctx) =>
      kind === 'text' ? captureFromText(input, ctx) : captureFromUrl(input, ctx)
    );
  };

  const pickPhotos = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const assets: MediaAsset[] = picked.assets.map((a) => ({
      uri: a.uri,
      mimeType: a.mimeType ?? 'image/jpeg',
      fileName: a.fileName ?? null,
    }));
    void run((ctx) => captureFromImages(assets, ctx));
  };

  const pickPdf = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    void run((ctx) =>
      captureFromPdf(
        { uri: asset.uri, mimeType: asset.mimeType ?? 'application/pdf', fileName: asset.name },
        ctx
      )
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Title>Ajouter une recette</Title>
          <Muted>Collez un lien (site, Instagram, TikTok) ou le texte complet de la recette.</Muted>
          <Field
            value={input}
            onChangeText={setInput}
            placeholder="Lien ou texte de la recette"
            multiline
            style={{ minHeight: 140, textAlignVertical: 'top' }}
            autoCapitalize="none"
          />
          {needsPaste ? (
            <Body style={{ color: colors.danger }}>
              Impossible de récupérer — collez le texte ?
            </Body>
          ) : null}
          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          <Button
            label="Capturer"
            onPress={capturePasted}
            loading={busy}
            disabled={input.trim().length === 0}
          />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button
              label="Photos"
              kind="secondary"
              onPress={() => void pickPhotos()}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <Button
              label="PDF"
              kind="secondary"
              onPress={() => void pickPdf()}
              disabled={busy}
              style={{ flex: 1 }}
            />
          </View>
          {busy ? <Muted>Analyse en cours…</Muted> : null}
          <Button label="Annuler" kind="secondary" onPress={() => router.back()} disabled={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
