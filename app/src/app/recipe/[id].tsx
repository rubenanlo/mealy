import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AddToWeekSheet,
  confirmRemoveFromWeek,
  removeRecipeFromCurrentWeek,
} from '@/components/add-to-week';
import { FixMatchSheet } from '@/components/fix-match';
import { ImageLightbox } from '@/components/image-lightbox';
import { IngredientRow } from '@/components/ingredient-row';
import {
  Body,
  BookmarkChip,
  Button,
  CategoryDot,
  Eyebrow,
  Field,
  Hairline,
  LinkButton,
  Muted,
  Title,
} from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import type { CanonicalIngredient, FodmapTier } from '@/lib/canonical';
import { CATEGORY_LABELS, resolveProteinCategory } from '@/lib/category';
import { normalizeDietProfile } from '@/lib/diet';
import { computeRecipeFodmap, FODMAP_DISCLAIMER, type RecipeFodmap } from '@/lib/fodmap';
import { resolveMatches } from '@/lib/matching';
import { useImageUrl } from '@/lib/media';
import { useReducedMotion } from '@/lib/motion';
import { weekStart } from '@/lib/plan';
import { rescaleIngredients } from '@/lib/servings';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';
import { useCanonicalIndex } from '@/lib/use-canonical';
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

const PINNED_BAR_HEIGHT = 44;

/**
 * v3.2 sheet chrome. iOS relies on the native pageSheet (rounded top, peek,
 * swipe-down); Android/web get a self-drawn dimmed backdrop + 95%-height
 * container with 16px top radii and a 280ms slide-up (reduced-motion: fade).
 */
function Sheet({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS === 'ios') return;
    if (reduced) {
      // Reduced motion: quick fade, no travel.
      Animated.timing(progress, { toValue: 1, duration: 150, useNativeDriver: Platform.OS !== 'web' }).start();
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [progress, reduced]);

  if (Platform.OS === 'ios') {
    return <View style={{ flex: 1, backgroundColor: colors.bg }}>{children}</View>;
  }

  const translateY = reduced
    ? 0
    : progress.interpolate({ inputRange: [0, 1], outputRange: [windowHeight * 0.95, 0] });

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.45)', opacity: progress }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the recipe"
          onPress={onDismiss}
          style={{ flex: 1 }}
        />
      </Animated.View>
      <Animated.View
        style={{
          height: '95%',
          backgroundColor: colors.bg,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          overflow: 'hidden',
          opacity: reduced ? progress : 1,
          transform: [{ translateY }],
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

function Hero({
  path,
  saved,
  onBookmark,
  onPress,
}: {
  path: string | null;
  saved: boolean;
  onBookmark: () => void;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const url = useImageUrl(path);
  return (
    <View
      style={{
        aspectRatio: path ? 4 / 3 : undefined,
        height: path ? undefined : 64,
        backgroundColor: colors.cardPressed,
      }}
    >
      {url ? (
        <Pressable
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={onPress ? 'Expand image' : undefined}
          onPress={onPress}
          disabled={!onPress}
          style={{ flex: 1 }}
        >
          <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="cover" />
        </Pressable>
      ) : null}
      {/* Bookmark chip sits above the image Pressable so it keeps its own taps. */}
      {path ? <BookmarkChip saved={saved} onPress={onBookmark} style={{ top: 12, right: 12 }} /> : null}
    </View>
  );
}

function GalleryImage({ path, onPress }: { path: string; onPress?: () => void }) {
  const url = useImageUrl(path);
  const { colors } = useTheme();
  const surface = {
    width: 240,
    height: 180,
    borderRadius: 8,
    overflow: 'hidden' as const,
    backgroundColor: colors.cardPressed,
  };
  const inner = url ? (
    <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="cover" />
  ) : null;
  if (!onPress) return <View style={surface}>{inner}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Expand image"
      onPress={onPress}
      style={({ pressed }) => [surface, { opacity: pressed ? 0.7 : 1 }]}
    >
      {inner}
    </Pressable>
  );
}

/** Clickable original-source link (url/reel captures). */
function SourceLink({ url }: { url: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open the original source, ${url}`}
      onPress={() => Linking.openURL(url).catch(() => {})}
      style={({ pressed }) => ({
        minHeight: minTapTarget,
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        numberOfLines={1}
        ellipsizeMode="middle"
        style={{ color: colors.accent, fontSize: fontSize.base, fontFamily: fonts.uiSemi }}
      >
        {url}
      </Text>
    </Pressable>
  );
}

/** FODMAP tier dot: high = red, moderate = badge, check = hollow, low = none. */
function TierDot({ tier }: { tier: FodmapTier }) {
  const { colors } = useTheme();
  if (tier === 'low') return null;
  const filled = tier === 'high' ? colors.danger : tier === 'moderate' ? colors.saffron : null;
  return (
    <View
      accessibilityLabel={`FODMAP ${tier}`}
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: filled ?? 'transparent',
        borderWidth: filled ? 0 : 1.5,
        borderColor: colors.saffron,
      }}
    />
  );
}

export default function RecipeSheetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { householdId } = useHousehold();
  const canonicalIndex = useCanonicalIndex();

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', servings: '', prep: '', cook: '' });
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState({ servings: '', prep: '', cook: '' });
  const [inThisWeek, setInThisWeek] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Full-screen image viewer for the Original source gallery.
  const [viewer, setViewer] = useState<{ paths: string[]; index: number } | null>(null);
  // FODMAP flags + match corrections (Phase 2 Task 7)
  const [matches, setMatches] = useState<Map<string, CanonicalIngredient | null>>(new Map());
  const [fodmapPersons, setFodmapPersons] = useState<string[]>([]);
  const [expandedRaw, setExpandedRaw] = useState<string | null>(null);
  const [fixRaw, setFixRaw] = useState<string | null>(null);
  // v3.2 pinned-ingredients state
  const [stepsY, setStepsY] = useState<number | null>(null);
  const [pinnedVisible, setPinnedVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const panelProgress = useRef(new Animated.Value(0)).current;

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

  // Resolve ingredient→canonical matches + who has a FODMAP mode enabled.
  const loadMatches = useCallback(async () => {
    if (!recipe || recipe.ingredients.length === 0) return;
    try {
      const [resolved, { data: personRows }] = await Promise.all([
        resolveMatches(recipe.ingredients.map((ing) => ing.raw || ing.name)),
        supabase
          .from('persons')
          .select('name, is_employee, diet_profile')
          .eq('household_id', householdId),
      ]);
      setMatches(new Map([...resolved.entries()].map(([raw, m]) => [raw, m.ingredient])));
      setFodmapPersons(
        ((personRows as { name: string; is_employee: boolean; diet_profile: unknown }[]) ?? [])
          .filter((p) => !p.is_employee && normalizeDietProfile(p.diet_profile).fodmap.mode !== 'off')
          .map((p) => p.name)
      );
    } catch {
      // Reference table unreachable — skip flags this session.
    }
  }, [recipe, householdId]);

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  const fodmap: RecipeFodmap | null = useMemo(() => {
    if (!recipe || recipe.ingredients.length === 0 || matches.size === 0) return null;
    return computeRecipeFodmap(
      recipe.ingredients.map((ing) => ({
        raw: ing.raw || ing.name,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
      })),
      recipe.servings,
      (line) => matches.get(line.raw) ?? null
    );
  }, [recipe, matches]);

  const flagByRaw = useMemo(
    () => new Map((fodmap?.flags ?? []).map((flag) => [flag.raw, flag])),
    [fodmap]
  );

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

  /** Single write path for the structured layer (recipe_sources never touched). */
  const saveRecipe = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!recipe) return;
      await supabase
        .from('recipes')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', recipe.id);
      void load();
    },
    [recipe, load]
  );

  const saveDetails = async () => {
    if (!recipe) return;
    const toInt = (v: string) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const newServings = toInt(details.servings);
    const patch: Record<string, unknown> = {
      servings: newServings,
      prep_minutes: toInt(details.prep),
      cook_minutes: toInt(details.cook),
    };
    // Servings change rescales parsed quantities (spec Part 3).
    if (newServings && recipe.servings && newServings !== recipe.servings) {
      patch.ingredients = rescaleIngredients(recipe.ingredients, newServings / recipe.servings);
    }
    setDetailsOpen(false);
    await saveRecipe(patch);
  };

  const markReviewed = async () => {
    if (!recipe) return;
    await supabase.from('recipes').update({ needs_review: false }).eq('id', recipe.id);
    void load();
  };

  /** Bookmark chip: plan it, or confirm-remove when already in this week (v3). */
  const onBookmark = () => {
    if (!recipe) return;
    if (inThisWeek) {
      confirmRemoveFromWeek(recipe.title, () => {
        void removeRecipeFromCurrentWeek(householdId, recipe.id).then(load);
      });
    } else {
      setSheetOpen(true);
    }
  };

  const togglePanel = useCallback(
    (open: boolean) => {
      setPanelOpen(open);
      if (reduced) {
        panelProgress.setValue(open ? 1 : 0);
        return;
      }
      Animated.timing(panelProgress, {
        toValue: open ? 1 : 0,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    },
    [reduced, panelProgress]
  );

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (stepsY === null) return;
    const y = event.nativeEvent.contentOffset.y;
    const shouldPin = y >= stepsY - PINNED_BAR_HEIGHT;
    if (shouldPin !== pinnedVisible) {
      setPinnedVisible(shouldPin);
      if (!shouldPin && panelOpen) togglePanel(false);
    }
  };

  const dismiss = () => router.back();

  if (!recipe) {
    return (
      <Sheet onDismiss={dismiss}>
        <View style={{ padding: screenPadding }}>
          <Muted>Loading…</Muted>
        </View>
      </Sheet>
    );
  }

  const category = resolveProteinCategory(recipe.tags, recipe.ingredients, canonicalIndex);
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
  // url/reel captures carry the original link; photo/paste/PDF are null.
  const sourceUrl = sources.find((s) => s.url)?.url ?? null;
  const hasSource = galleryPaths.length > 0 || sourceUrl !== null;
  const showAction = !editing;
  const showPinnedBar = pinnedVisible && showAction;
  const actionBottom = (Platform.OS === 'ios' ? insets.bottom : insets.bottom) + 16;

  return (
    <Sheet onDismiss={dismiss}>
      <ImageLightbox
        visible={viewer !== null}
        paths={viewer?.paths ?? []}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />
      <View
        style={{ flex: 1 }}
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
      >
        <ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: showAction ? 140 : 48 }}
        >
          <Hero
            path={heroPath}
            saved={inThisWeek}
            onBookmark={onBookmark}
            onPress={
              galleryPaths.length > 0
                ? () => setViewer({ paths: galleryPaths, index: 0 })
                : undefined
            }
          />

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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit servings and times"
                onPress={() => {
                  setDetails({
                    servings: recipe.servings?.toString() ?? '',
                    prep: recipe.prep_minutes?.toString() ?? '',
                    cook: recipe.cook_minutes?.toString() ?? '',
                  });
                  setDetailsOpen(true);
                }}
              >
                {metaParts.length > 0 ? (
                  <Muted>{metaParts.join(' · ')}</Muted>
                ) : (
                  <Muted>Add servings & time</Muted>
                )}
              </Pressable>
              {recipe.needs_review ? (
                <Text style={{ color: colors.saffron, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>
                  needs review
                </Text>
              ) : null}
            </View>

            {recipe.needs_review && !editing ? (
              <Button label="Mark as reviewed" kind="secondary" onPress={() => void markReviewed()} />
            ) : null}

            <Hairline />

            {editing ? (
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
                {hasSource ? (
                  <View style={{ gap: 12 }}>
                    <Title>Original source</Title>
                    {sourceUrl ? <SourceLink url={sourceUrl} /> : null}
                    {restPaths.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 12 }}
                      >
                        {restPaths.map((path, i) => (
                          <GalleryImage
                            key={path}
                            path={path}
                            // restPaths[i] === galleryPaths[i + 1]; hero is index 0.
                            onPress={() => setViewer({ paths: galleryPaths, index: i + 1 })}
                          />
                        ))}
                      </ScrollView>
                    ) : null}
                  </View>
                ) : null}

                <Title>Ingredients</Title>

                {/* FODMAP summary per FODMAP-mode person (spec §4) */}
                {fodmap && fodmapPersons.length > 0 && fodmap.hasWarnings ? (
                  <View style={{ gap: 6 }}>
                    {fodmapPersons.map((personName) => {
                      const high = fodmap.flags.filter((f) => f.tier === 'high').map((f) => f.name);
                      const check = fodmap.flags.filter((f) => f.tier === 'check').map((f) => f.name);
                      const moderate = fodmap.flags
                        .filter((f) => f.tier === 'moderate')
                        .map((f) => f.name);
                      const partsList = [
                        high.length > 0 ? `High for ${personName}: ${high.join(', ')}` : null,
                        moderate.length > 0 ? `Moderate: ${moderate.join(', ')}` : null,
                        check.length > 0 ? `Check: ${check.join(', ')}` : null,
                      ].filter(Boolean);
                      return partsList.length > 0 ? (
                        <Body key={personName} style={{ fontSize: fontSize.small }}>
                          {partsList.join(' · ')}
                        </Body>
                      ) : null;
                    })}
                    {fodmap.stacking.map((warning) => (
                      <Muted key={warning.group}>
                        {`Stacking: ${warning.ingredients.join(' + ')} share ${warning.group} — check the combined amount.`}
                      </Muted>
                    ))}
                    <Muted style={{ fontStyle: 'italic' }}>{FODMAP_DISCLAIMER}</Muted>
                  </View>
                ) : null}

                <View>
                  {recipe.ingredients.map((ing, i) => {
                    const rawKey = ing.raw || ing.name;
                    const flag = flagByRaw.get(rawKey);
                    const canonical = matches.get(rawKey) ?? null;
                    const isExpanded = expandedRaw === rawKey;
                    return (
                      <View key={`${rawKey}-${i}`}>
                        {i > 0 ? <Hairline /> : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Details for ${ing.name}`}
                          accessibilityState={{ expanded: isExpanded }}
                          onPress={() => setExpandedRaw(isExpanded ? null : rawKey)}
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                            backgroundColor: pressed ? colors.cardPressed : 'transparent',
                          })}
                        >
                          <View style={{ flex: 1 }}>
                            <IngredientRow ingredient={ing} />
                          </View>
                          {fodmapPersons.length > 0 && flag ? <TierDot tier={flag.tier} /> : null}
                        </Pressable>
                        {isExpanded ? (
                          <View style={{ paddingBottom: 10, gap: 4 }}>
                            <Muted>
                              {canonical
                                ? `Matched to ${canonical.name_fr}.`
                                : 'Not matched to the ingredient table.'}
                            </Muted>
                            {fodmapPersons.length > 0 && flag ? (
                              <Muted>{`FODMAP ${flag.tier} — ${flag.explanation}`}</Muted>
                            ) : null}
                            <LinkButton
                              label="Correct the match"
                              onPress={() => setFixRaw(rawKey)}
                              style={{ minHeight: 36 }}
                              textStyle={{ fontSize: fontSize.small }}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {recipe.ingredients.length === 0 ? <Muted>No ingredients extracted.</Muted> : null}
                </View>
              </View>
            )}
          </View>

          {/* Steps live in their own content-level container so onLayout gives
              the exact scroll offset for the pinned-ingredients bar (v3.2). */}
          {!editing ? (
            <View
              onLayout={(e) => setStepsY(e.nativeEvent.layout.y)}
              style={{ paddingHorizontal: screenPadding, gap: 18 }}
            >
              <Title>Steps</Title>
              <View style={{ gap: 20 }}>
                {recipe.steps.map((step, i) => (
                  <Pressable
                    key={i}
                    accessibilityRole="text"
                    onPress={() => {
                      if (panelOpen) togglePanel(false);
                    }}
                    style={{ gap: 6 }}
                  >
                    <Eyebrow>Step {i + 1}</Eyebrow>
                    <Body>{step}</Body>
                  </Pressable>
                ))}
                {recipe.steps.length === 0 ? <Muted>No steps extracted.</Muted> : null}
              </View>
              <Button label="Edit" kind="secondary" onPress={startEditing} />
            </View>
          ) : null}
        </ScrollView>

        {/* v3.2: pinned ingredients bar while reading steps */}
        {showPinnedBar ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 15 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={panelOpen ? 'Hide ingredients' : 'Show ingredients'}
              accessibilityState={{ expanded: panelOpen }}
              onPress={() => togglePanel(!panelOpen)}
              style={({ pressed }) => ({
                height: PINNED_BAR_HEIGHT,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingLeft: screenPadding,
                paddingRight: screenPadding,
                backgroundColor: pressed ? colors.cardPressed : colors.bg,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              })}
            >
              <Text style={{ color: colors.text, fontSize: fontSize.small, fontFamily: fonts.uiSemi }}>
                Ingredients
              </Text>
              <Ionicons
                name={panelOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
            {panelOpen ? (
              <Animated.View
                style={{
                  maxHeight: Math.max(sheetHeight * 0.6, 200),
                  backgroundColor: colors.bg,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                  opacity: panelProgress,
                  transform: [
                    {
                      translateY: panelProgress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }),
                    },
                  ],
                }}
              >
                <ScrollView contentContainerStyle={{ paddingHorizontal: screenPadding, paddingVertical: 8 }}>
                  {recipe.ingredients.map((ing, i) => {
                    const quantity = [ing.quantity, ing.unit].filter((v) => v != null).join(' ');
                    return (
                      <View key={`pin-${ing.raw}-${i}`}>
                        {i > 0 ? <Hairline /> : null}
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'baseline',
                            gap: 12,
                            paddingVertical: 8,
                          }}
                        >
                          <Text
                            style={{ flex: 1, color: colors.text, fontSize: fontSize.small, fontFamily: fonts.ui }}
                          >
                            {ing.name}
                          </Text>
                          {quantity ? (
                            <Text
                              style={{
                                color: colors.text,
                                fontSize: fontSize.small,
                                fontFamily: fonts.ui,
                                fontVariant: ['tabular-nums'],
                              }}
                            >
                              {quantity}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </Animated.View>
            ) : null}
          </View>
        ) : null}

        {/* v3.2: primary action floats inside the sheet, above its bottom edge */}
        {showAction ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: screenPadding,
              right: screenPadding,
              bottom: actionBottom,
              ...Platform.select({
                ios: {
                  shadowColor: '#000000',
                  shadowOpacity: 0.12,
                  shadowRadius: 16,
                  shadowOffset: { width: 0, height: 4 },
                },
                android: { elevation: 8 },
                web: { boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)' } as object,
                default: {},
              }),
            }}
          >
            <Button
              label={inThisWeek ? 'Add again this week' : 'Add to this week'}
              onPress={() => setSheetOpen(true)}
            />
          </View>
        ) : null}
      </View>

      <AddToWeekSheet
        visible={sheetOpen}
        recipeId={recipe.id}
        recipeTitle={recipe.title}
        onClose={() => setSheetOpen(false)}
        onAdded={() => void load()}
      />

      <Modal visible={detailsOpen} transparent animationType="fade" onRequestClose={() => setDetailsOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={() => setDetailsOpen(false)} />
        <View
          style={{
            backgroundColor: colors.bg,
            padding: screenPadding,
            paddingBottom: insets.bottom + 16,
            gap: 12,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
          }}
        >
          <Eyebrow>Servings</Eyebrow>
          <Field
            value={details.servings}
            onChangeText={(v) => setDetails({ ...details, servings: v })}
            keyboardType="number-pad"
          />
          <Eyebrow>Prep (min)</Eyebrow>
          <Field
            value={details.prep}
            onChangeText={(v) => setDetails({ ...details, prep: v })}
            keyboardType="number-pad"
          />
          <Eyebrow>Cook (min)</Eyebrow>
          <Field
            value={details.cook}
            onChangeText={(v) => setDetails({ ...details, cook: v })}
            keyboardType="number-pad"
          />
          <Button label="Save" onPress={() => void saveDetails()} />
          <Button label="Cancel" kind="secondary" onPress={() => setDetailsOpen(false)} />
        </View>
      </Modal>

      {fixRaw !== null ? (
        <FixMatchSheet
          visible
          raw={fixRaw}
          current={matches.get(fixRaw) ?? null}
          onClose={() => setFixRaw(null)}
          onCorrected={() => void loadMatches()}
        />
      ) : null}
    </Sheet>
  );
}
