import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddToWeekSheet } from '@/components/add-to-week';
import { IngredientRow } from '@/components/ingredient-row';
import {
  Body,
  Bookmark,
  Button,
  Card,
  CategoryDot,
  Eyebrow,
  Field,
  Hairline,
  LinkButton,
  Muted,
  Title,
} from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { CATEGORY_LABELS, deriveCategory } from '@/lib/category';
import { useImageUrl } from '@/lib/media';
import { weekStart } from '@/lib/plan';
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
    <View
      style={{
        aspectRatio: path ? 4 / 3 : undefined,
        height: path ? undefined : insets.top + 64,
        backgroundColor: colors.cardPressed,
      }}
    >
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
          backgroundColor: pressed ? colors.cardPressed : colors.bg,
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
      style={{ width: 240, height: 180, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.cardPressed }}
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
      <Card style={{ backgroundColor: colors.cardPressed }}>
        <Text
          selectable
          style={{ color: colors.text, fontSize: fontSize.base, lineHeight: 24, fontFamily: fonts.ui }}
        >
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
          <Body style={{ fontFamily: fonts.uiSemi }}>{KIND_LABELS[source.kind] ?? source.kind}</Body>
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

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [view, setView] = useState<'recipe' | 'source'>('recipe');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', servings: '', prep: '', cook: '' });
  const [saving, setSaving] = useState(false);
  const [inThisWeek, setInThisWeek] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [r, s, i, weekPlan] = await Promise.all([
      supabase.from('recipes').select('*').eq('id', id).single(),
      supabase.from('recipe_sources').select('*').eq('recipe_id', id).order('captured_at'),
      supabase.from('recipe_images').select('id, storage_path, position').eq('recipe_id', id).order('position'),
      supabase
        .from('meal_plans')
        .select('id')
        .eq('household_id', householdId)
        .eq('week_start', weekStart(new Date()))
        .maybeSingle(),
    ]);
    if (r.data) setRecipe(r.data as RecipeDetail);
    if (s.data) setSources(s.data as SourceRow[]);
    if (i.data) setImages(i.data as ImageRow[]);
    if (weekPlan.data) {
      const { count } = await supabase
        .from('plan_entries')
        .select('id', { count: 'exact', head: true })
        .eq('meal_plan_id', weekPlan.data.id)
        .eq('recipe_id', id);
      setInThisWeek((count ?? 0) > 0);
    } else {
      setInThisWeek(false);
    }
  }, [id, householdId]);

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

  const category = deriveCategory(recipe.tags);
  const metaParts = [
    recipe.servings ? `${recipe.servings} servings` : null,
    recipe.prep_minutes ? `Prep ${recipe.prep_minutes} min` : null,
    recipe.cook_minutes ? `Cook ${recipe.cook_minutes} min` : null,
  ].filter(Boolean);

  const galleryPaths =
    images.length > 0
      ? images.map((img) => img.storage_path)
      : recipe.cover_image_path
        ? [recipe.cover_image_path]
        : [];
  const heroPath = galleryPaths[0] ?? null;
  const restPaths = galleryPaths.slice(1);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <Hero path={heroPath} onBack={() => router.back()} />

        <View style={{ padding: screenPadding, gap: 14 }}>
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.heroTitle,
              lineHeight: Math.round(fontSize.heroTitle * 1.15),
              letterSpacing: -0.3,
              fontFamily: fonts.display,
            }}
          >
            {recipe.title}
          </Text>

          {/* Byline-style meta */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {category ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <CategoryDot category={category} />
                <Muted>{CATEGORY_LABELS[category]}</Muted>
              </View>
            ) : null}
            {category && metaParts.length > 0 ? <Muted>·</Muted> : null}
            {metaParts.length > 0 ? <Muted>{metaParts.join(' · ')}</Muted> : null}
            {recipe.needs_review ? (
              <Text style={{ color: colors.saffron, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>
                needs review
              </Text>
            ) : null}
          </View>

          <LinkButton
            label={view === 'recipe' ? 'Original source' : 'Back to the recipe'}
            onPress={() => setView(view === 'recipe' ? 'source' : 'recipe')}
            style={{ minHeight: 36 }}
          />

          {view === 'recipe' && !editing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Button
                label={inThisWeek ? 'Add again this week' : 'Add to this week'}
                onPress={() => setSheetOpen(true)}
                style={{ flex: 1 }}
              />
              <Bookmark saved={inThisWeek} onPress={() => setSheetOpen(true)} size={26} />
            </View>
          ) : null}

          {recipe.needs_review && view === 'recipe' && !editing ? (
            <Button label="Mark as reviewed" kind="secondary" onPress={() => void markReviewed()} />
          ) : null}

          <Hairline />

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
            <View style={{ gap: 18 }}>
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

              <Title>Ingredients</Title>
              <View>
                {recipe.ingredients.map((ing, i) => (
                  <View key={`${ing.raw}-${i}`}>
                    {i > 0 ? <Hairline /> : null}
                    <IngredientRow ingredient={ing} />
                  </View>
                ))}
                {recipe.ingredients.length === 0 ? <Muted>No ingredients extracted.</Muted> : null}
              </View>

              <Title>Steps</Title>
              <View style={{ gap: 20 }}>
                {recipe.steps.map((step, i) => (
                  <View key={i} style={{ gap: 6 }}>
                    <Eyebrow>Step {i + 1}</Eyebrow>
                    <Body>{step}</Body>
                  </View>
                ))}
                {recipe.steps.length === 0 ? <Muted>No steps extracted.</Muted> : null}
              </View>

              <Button label="Edit" kind="secondary" onPress={startEditing} />
            </View>
          )}
        </View>
      </ScrollView>

      <AddToWeekSheet
        visible={sheetOpen}
        recipeId={recipe.id}
        recipeTitle={recipe.title}
        onClose={() => setSheetOpen(false)}
        onAdded={() => void load()}
      />
    </View>
  );
}
