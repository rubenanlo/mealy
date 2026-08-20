import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { IngredientRow } from '@/components/ingredient-row';
import { Body, Button, Card, Eyebrow, Field, Muted } from '@/components/ui';
import { deriveCategory, spineColor } from '@/lib/category';
import { useImageUrl } from '@/lib/media';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';
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
  url: 'Web page',
  reel: 'Reel (video)',
  photo: 'Photos',
  pdf: 'PDF',
  paste: 'Pasted text',
};

function Hero({ path, onBack }: { path: string | null; onBack: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const url = useImageUrl(path);
  return (
    <View style={{ height: path ? 260 : insets.top + 64, backgroundColor: colors.cardPressed }}>
      {url ? <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="cover" /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to recipes"
        onPress={onBack}
        style={({ pressed }) => ({
          position: 'absolute',
          top: insets.top + 8,
          left: 12,
          width: minTapTarget,
          height: minTapTarget,
          borderRadius: minTapTarget / 2,
          backgroundColor: pressed ? colors.cardPressed : colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
    </View>
  );
}

function GalleryImage({ path }: { path: string }) {
  const url = useImageUrl(path);
  const { colors } = useTheme();
  return (
    <View
      style={{ width: 240, height: 180, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.cardPressed }}
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
      <Eyebrow>{label}</Eyebrow>
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
          <VerbatimBlock label="Pasted text" text={source.verbatim.pasted} />
          <VerbatimBlock label="Page text" text={source.verbatim.page_text} />
          <VerbatimBlock label="Caption" text={source.verbatim.caption} />
          <VerbatimBlock label="Transcript" text={source.verbatim.transcript} />
          <VerbatimBlock label="On-screen text" text={source.verbatim.overlay_text} />
          <VerbatimBlock label="Recognized text (OCR)" text={source.verbatim.ocr_text} />
          <VerbatimBlock
            label="Structured data (JSON-LD)"
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
      {sources.length === 0 ? <Muted>No source captured.</Muted> : null}
    </View>
  );
}

function ReviewBadge() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.saffron,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
        alignSelf: 'center',
      }}
    >
      <Text style={{ color: '#2B2925', fontSize: fontSize.eyebrow, fontWeight: '700' }}>
        needs review
      </Text>
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
        <View style={{ padding: screenPadding }}>
          <Muted>Loading…</Muted>
        </View>
      </SafeAreaView>
    );
  }

  const meta = [
    recipe.servings ? `${recipe.servings} servings` : null,
    recipe.prep_minutes ? `Prep ${recipe.prep_minutes} min` : null,
    recipe.cook_minutes ? `Cook ${recipe.cook_minutes} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const galleryPaths =
    images.length > 0
      ? images.map((img) => img.storage_path)
      : recipe.cover_image_path
        ? [recipe.cover_image_path]
        : [];
  const heroPath = galleryPaths[0] ?? null;
  const restPaths = galleryPaths.slice(1);
  const category = deriveCategory(recipe.tags);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <Hero path={heroPath} onBack={() => router.back()} />

        <View style={{ padding: screenPadding, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text
              style={{
                flex: 1,
                color: colors.text,
                fontSize: 24,
                lineHeight: 32,
                fontFamily: fonts.display,
              }}
            >
              {recipe.title}
            </Text>
            {category ? (
              <View
                style={{
                  width: 4,
                  height: 28,
                  borderRadius: 2,
                  backgroundColor: spineColor(category, colors),
                }}
              />
            ) : null}
          </View>
          {meta ? <Eyebrow>{meta}</Eyebrow> : null}
          {recipe.tags.length > 0 ? <Muted>{recipe.tags.join(' · ')}</Muted> : null}

          {recipe.needs_review ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ReviewBadge />
              <Button
                label="Mark as reviewed"
                kind="secondary"
                onPress={() => void markReviewed()}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}

          {/* Segmented text buttons: recipe / original source */}
          <View style={{ flexDirection: 'row', gap: 24 }}>
            {(
              [
                ['recipe', 'Recipe'],
                ['source', 'Original source'],
              ] as const
            ).map(([key, label]) => {
              const active = view === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setView(key)}
                  style={{ minHeight: minTapTarget, justifyContent: 'center' }}
                >
                  <Text
                    style={{
                      color: active ? colors.accent : colors.textMuted,
                      fontSize: fontSize.base,
                      fontWeight: '600',
                      borderBottomWidth: 2,
                      borderBottomColor: active ? colors.accent : 'transparent',
                      paddingBottom: 4,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {view === 'source' ? (
            <SourceView sources={sources} />
          ) : editing ? (
            <View style={{ gap: 12 }}>
              <Eyebrow>Title</Eyebrow>
              <Field value={draft.title} onChangeText={(v) => setDraft({ ...draft, title: v })} />
              <Eyebrow>Servings</Eyebrow>
              <Field
                value={draft.servings}
                onChangeText={(v) => setDraft({ ...draft, servings: v })}
                keyboardType="number-pad"
              />
              <Eyebrow>Prep (min)</Eyebrow>
              <Field
                value={draft.prep}
                onChangeText={(v) => setDraft({ ...draft, prep: v })}
                keyboardType="number-pad"
              />
              <Eyebrow>Cook (min)</Eyebrow>
              <Field
                value={draft.cook}
                onChangeText={(v) => setDraft({ ...draft, cook: v })}
                keyboardType="number-pad"
              />
              <Button label="Save" onPress={() => void saveEdits()} loading={saving} />
              <Button label="Cancel" kind="secondary" onPress={() => setEditing(false)} />
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              {restPaths.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 12 }}
                >
                  {restPaths.map((path) => (
                    <GalleryImage key={path} path={path} />
                  ))}
                </ScrollView>
              ) : null}

              <Eyebrow>Ingredients</Eyebrow>
              <Card>
                {recipe.ingredients.map((ing, i) => (
                  <IngredientRow key={`${ing.raw}-${i}`} ingredient={ing} />
                ))}
                {recipe.ingredients.length === 0 ? <Muted>No ingredients extracted.</Muted> : null}
              </Card>

              <Eyebrow>Steps</Eyebrow>
              <View style={{ gap: 16 }}>
                {recipe.steps.map((step, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 14 }}>
                    <Text
                      style={{
                        color: colors.accent,
                        fontSize: fontSize.large,
                        fontFamily: fonts.display,
                        minWidth: 26,
                        lineHeight: 28,
                      }}
                    >
                      {i + 1}
                    </Text>
                    <Body style={{ flex: 1 }}>{step}</Body>
                  </View>
                ))}
                {recipe.steps.length === 0 ? <Muted>No steps extracted.</Muted> : null}
              </View>

              <Button label="Edit" kind="secondary" onPress={startEditing} />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
