import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IngredientRow } from '@/components/ingredient-row';
import { Body, Button, Card, Field, Muted, Title } from '@/components/ui';
import { useImageUrl } from '@/lib/media';
import { supabase } from '@/lib/supabase';
import { fontSize, minTapTarget, useTheme } from '@/lib/theme';
import type { IngredientRow as IngredientData, SourceKind, Verbatim } from '@/lib/worker';

interface RecipeDetail {
  id: string;
  title: string;
  language: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  dish_type: string | null;
  tags: string[];
  ingredients: IngredientData[];
  steps: string[];
  needs_review: boolean;
  cover_image_path: string | null;
}

interface SourceRow {
  id: string;
  kind: SourceKind;
  url: string | null;
  verbatim: Verbatim;
  media_paths: string[];
}

interface ImageRow {
  id: string;
  storage_path: string;
  position: number;
}

const KIND_LABELS: Record<SourceKind, string> = {
  url: 'Page web',
  reel: 'Réel (vidéo)',
  photo: 'Photos',
  pdf: 'PDF',
  paste: 'Texte collé',
};

function GalleryImage({ path }: { path: string }) {
  const url = useImageUrl(path);
  const { colors } = useTheme();
  return (
    <View
      style={{ width: 240, height: 180, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.card }}
    >
      {url ? <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="cover" /> : null}
    </View>
  );
}

function VerbatimBlock({ label, text }: { label: string; text: string | null }) {
  const { colors } = useTheme();
  if (!text) return null;
  return (
    <View style={{ gap: 6 }}>
      <Muted style={{ fontWeight: '700' }}>{label}</Muted>
      <Card>
        <Text selectable style={{ color: colors.text, fontSize: fontSize.base, lineHeight: 24 }}>
          {text}
        </Text>
      </Card>
    </View>
  );
}

function SourceView({ sources }: { sources: SourceRow[] }) {
  return (
    <View style={{ gap: 20 }}>
      {sources.map((source) => (
        <View key={source.id} style={{ gap: 12 }}>
          <Body style={{ fontWeight: '700' }}>{KIND_LABELS[source.kind] ?? source.kind}</Body>
          {source.url ? <Muted>{source.url}</Muted> : null}
          <VerbatimBlock label="Texte collé" text={source.verbatim.pasted} />
          <VerbatimBlock label="Texte de la page" text={source.verbatim.page_text} />
          <VerbatimBlock label="Légende" text={source.verbatim.caption} />
          <VerbatimBlock label="Transcription" text={source.verbatim.transcript} />
          <VerbatimBlock label="Texte à l'écran" text={source.verbatim.overlay_text} />
          <VerbatimBlock label="Texte reconnu (OCR)" text={source.verbatim.ocr_text} />
          <VerbatimBlock
            label="Données structurées (JSON-LD)"
            text={source.verbatim.json_ld ? JSON.stringify(source.verbatim.json_ld, null, 2) : null}
          />
          {source.media_paths.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              {source.media_paths.map((path) => (
                <GalleryImage key={path} path={path} />
              ))}
            </ScrollView>
          ) : null}
        </View>
      ))}
      {sources.length === 0 ? <Muted>Aucune source enregistrée.</Muted> : null}
    </View>
  );
}

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [view, setView] = useState<'recipe' | 'source'>('recipe');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', servings: '', prep: '', cook: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [r, s, i] = await Promise.all([
      supabase.from('recipes').select('*').eq('id', id).single(),
      supabase.from('recipe_sources').select('*').eq('recipe_id', id).order('captured_at'),
      supabase.from('recipe_images').select('id, storage_path, position').eq('recipe_id', id).order('position'),
    ]);
    if (r.data) setRecipe(r.data as RecipeDetail);
    if (s.data) setSources(s.data as SourceRow[]);
    if (i.data) setImages(i.data as ImageRow[]);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEditing = () => {
    if (!recipe) return;
    setDraft({
      title: recipe.title,
      servings: recipe.servings?.toString() ?? '',
      prep: recipe.prep_minutes?.toString() ?? '',
      cook: recipe.cook_minutes?.toString() ?? '',
    });
    setEditing(true);
  };

  const saveEdits = async () => {
    if (!recipe) return;
    setSaving(true);
    const toInt = (v: string) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    };
    // Structured layer only — recipe_sources is never touched (spec §3.1).
    await supabase
      .from('recipes')
      .update({
        title: draft.title.trim() || recipe.title,
        servings: toInt(draft.servings),
        prep_minutes: toInt(draft.prep),
        cook_minutes: toInt(draft.cook),
        updated_at: new Date().toISOString(),
      })
      .eq('id', recipe.id);
    setSaving(false);
    setEditing(false);
    void load();
  };

  const markReviewed = async () => {
    if (!recipe) return;
    await supabase.from('recipes').update({ needs_review: false }).eq('id', recipe.id);
    void load();
  };

  if (!recipe) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: 20 }}>
          <Muted>Chargement…</Muted>
        </View>
      </SafeAreaView>
    );
  }

  const meta = [
    recipe.servings ? `${recipe.servings} pers.` : null,
    recipe.prep_minutes ? `Prép. ${recipe.prep_minutes} min` : null,
    recipe.cook_minutes ? `Cuisson ${recipe.cook_minutes} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const galleryPaths =
    images.length > 0
      ? images.map((img) => img.storage_path)
      : recipe.cover_image_path
        ? [recipe.cover_image_path]
        : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={{ minHeight: minTapTarget, justifyContent: 'center' }}
        >
          <Body style={{ color: colors.accent, fontWeight: '600' }}>‹ Recettes</Body>
        </Pressable>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {(
            [
              ['recipe', 'Recette'],
              ['source', 'Source originale'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              onPress={() => setView(key)}
              style={{
                minHeight: minTapTarget,
                paddingHorizontal: 18,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: view === key ? colors.accent : colors.card,
              }}
            >
              <Text
                style={{
                  color: view === key ? '#FFFFFF' : colors.text,
                  fontSize: fontSize.base,
                  fontWeight: '600',
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {view === 'source' ? (
          <SourceView sources={sources} />
        ) : editing ? (
          <View style={{ gap: 12 }}>
            <Muted>Titre</Muted>
            <Field value={draft.title} onChangeText={(v) => setDraft({ ...draft, title: v })} />
            <Muted>Personnes</Muted>
            <Field
              value={draft.servings}
              onChangeText={(v) => setDraft({ ...draft, servings: v })}
              keyboardType="number-pad"
            />
            <Muted>Préparation (min)</Muted>
            <Field
              value={draft.prep}
              onChangeText={(v) => setDraft({ ...draft, prep: v })}
              keyboardType="number-pad"
            />
            <Muted>Cuisson (min)</Muted>
            <Field
              value={draft.cook}
              onChangeText={(v) => setDraft({ ...draft, cook: v })}
              keyboardType="number-pad"
            />
            <Button label="Enregistrer" onPress={() => void saveEdits()} loading={saving} />
            <Button label="Annuler" kind="secondary" onPress={() => setEditing(false)} />
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {galleryPaths.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12 }}
              >
                {galleryPaths.map((path) => (
                  <GalleryImage key={path} path={path} />
                ))}
              </ScrollView>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Title style={{ flex: 1 }}>{recipe.title}</Title>
            </View>
            {recipe.needs_review ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    backgroundColor: colors.danger,
                    borderRadius: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>
                    à vérifier
                  </Text>
                </View>
                <Button
                  label="Marquer comme vérifiée"
                  kind="secondary"
                  onPress={() => void markReviewed()}
                  style={{ flex: 1 }}
                />
              </View>
            ) : null}
            {meta ? <Muted>{meta}</Muted> : null}
            {recipe.tags.length > 0 ? <Muted>{recipe.tags.join(' · ')}</Muted> : null}

            <Body style={{ fontWeight: '700', fontSize: fontSize.large }}>Ingrédients</Body>
            <Card>
              {recipe.ingredients.map((ing, i) => (
                <IngredientRow key={`${ing.raw}-${i}`} ingredient={ing} />
              ))}
              {recipe.ingredients.length === 0 ? <Muted>Aucun ingrédient extrait.</Muted> : null}
            </Card>

            <Body style={{ fontWeight: '700', fontSize: fontSize.large }}>Étapes</Body>
            <View style={{ gap: 12 }}>
              {recipe.steps.map((step, i) => (
                <Card key={i} style={{ flexDirection: 'row', gap: 12 }}>
                  <Body style={{ color: colors.accent, fontWeight: '700' }}>{i + 1}</Body>
                  <Body style={{ flex: 1 }}>{step}</Body>
                </Card>
              ))}
              {recipe.steps.length === 0 ? <Muted>Aucune étape extraite.</Muted> : null}
            </View>

            <Button label="Modifier" kind="secondary" onPress={startEditing} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
