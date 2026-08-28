import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
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
import { CoverRepositionModal } from '@/components/cover-editor';
import { EditRowControls, SectionTitle } from '@/components/editable-list';
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
import { confirmDestructive, notify } from '@/lib/confirm';
import {
  CATEGORY_LABELS,
  deriveCategory,
  PROTEIN_CATEGORIES,
  resolveProteinCategory,
  type ProteinCategory,
} from '@/lib/category';
import { focalToContentPosition } from '@/lib/cover-focal';
import { normalizeDietProfile } from '@/lib/diet';
import { moveItem, removeItem, updateItem } from '@/lib/edit-list';
import {
  computeRecipeFodmap,
  recipeFodmapTier,
  type RecipeFodmap,
} from '@/lib/fodmap';
import { fmt, useI18n, type Dict } from '@/lib/i18n';
import { resolveMatches } from '@/lib/matching';
import { useImageUrl } from '@/lib/media';
import { useReducedMotion } from '@/lib/motion';
import { type MealSlot, weekStart } from '@/lib/plan';
import { assignRecipeToSlot, isRecipeUntouched } from '@/lib/recipes';
import { entryServings, rescaleIngredients, servingsFactor } from '@/lib/servings';
import { convertIngredients, type UnitSystem } from '@/lib/unit-convert';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';
import {
  localizeContent,
  queueRecipeTranslation,
  translationPending,
  type TranslationRow,
} from '@/lib/translations';
import { useCanonicalIndex } from '@/lib/use-canonical';
import {
  fetchWebImage,
  fodmapSwaps,
  reExtract,
  type CanonicalRecipe,
  type FodmapSwapResult,
  type IngredientRow as IngredientData,
  type SourceKind,
  type Verbatim,
} from '@/lib/worker';

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
  cover_focal: { x: number; y: number } | null;
  /** Manual FODMAP level; null = derived from ingredients. */
  fodmap_override: 'low' | 'moderate' | 'high' | null;
  /** Planner classification; null is treated as 'main' (lunch/dinner). */
  meal_type: 'main' | 'breakfast' | 'dessert' | 'side' | null;
  /** Bumped on every edit — used to ignore not-yet-regenerated translations. */
  updated_at: string | null;
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

/** Localized display word for a FODMAP tier ('low' | 'moderate' | 'high' | 'check'). */
function tierWord(d: Dict, tier: FodmapTier): string {
  return tier === 'low'
    ? d.recipe.tierLow
    : tier === 'moderate'
      ? d.recipe.tierModerate
      : tier === 'high'
        ? d.recipe.tierHigh
        : d.recipe.tierCheck;
}

/**
 * v3.2 sheet chrome. iOS relies on the native pageSheet (rounded top, peek,
 * swipe-down); Android/web get a self-drawn dimmed backdrop + 95%-height
 * container with 16px top radii and a 280ms slide-up (reduced-motion: fade).
 */
function Sheet({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  const { colors } = useTheme();
  const { d } = useI18n();
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
          accessibilityLabel={d.recipe.closeRecipe}
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
  focal = null,
  onEdit,
}: {
  path: string | null;
  saved: boolean;
  onBookmark: () => void;
  onPress?: () => void;
  focal?: { x: number; y: number } | null;
  onEdit?: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const url = useImageUrl(path);
  return (
    <View
      style={{
        aspectRatio: path ? 4 / 3 : undefined,
        height: path ? undefined : onEdit ? 96 : 64,
        backgroundColor: colors.cardPressed,
      }}
    >
      {url ? (
        <Pressable
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={onPress ? d.recipe.expandImage : undefined}
          onPress={onPress}
          disabled={!onPress}
          style={{ flex: 1 }}
        >
          <Image
            source={{ uri: url }}
            style={{ flex: 1 }}
            contentFit="cover"
            contentPosition={focalToContentPosition(focal)}
          />
        </Pressable>
      ) : onEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.recipe.addCoverPhoto}
          onPress={onEdit}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="camera-outline" size={20} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.uiMedium }}>
            {d.recipe.addCoverPhoto}
          </Text>
        </Pressable>
      ) : null}
      {/* Bookmark chip sits above the image Pressable so it keeps its own taps. */}
      {path ? <BookmarkChip saved={saved} onPress={onBookmark} style={{ top: 12, right: 12 }} /> : null}
      {/* Edit chip sits bottom-right, clear of the top-right bookmark chip. */}
      {path && onEdit ? (
        <View style={{ position: 'absolute', bottom: 12, right: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={d.recipe.editCoverImage}
            onPress={onEdit}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Ionicons name="camera-outline" size={18} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function GalleryImage({ path, onPress }: { path: string; onPress?: () => void }) {
  const url = useImageUrl(path);
  const { colors } = useTheme();
  const { d } = useI18n();
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
      accessibilityLabel={d.recipe.expandImage}
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
  const { d } = useI18n();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={fmt(d.recipe.openOriginalSourceA11y, { url })}
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
  const { d } = useI18n();
  if (tier === 'low') return null;
  const filled = tier === 'high' ? colors.danger : tier === 'moderate' ? colors.saffron : null;
  return (
    <View
      accessibilityLabel={fmt(d.recipe.fodmapTierLabel, { tier: tierWord(d, tier) })}
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
  const {
    id,
    planServings: planServingsParam,
    isNew: isNewParam,
    assignDay,
    assignSlot,
    assignWeek,
  } = useLocalSearchParams<{
    id: string;
    /** Set when opened from the planner / "what's next": scale to this meal's servings. */
    planServings?: string;
    /** '1' when this is a freshly created blank manual recipe (enables auto-delete + Done). */
    isNew?: string;
    /** Slot to auto-assign this recipe into on finish, when created from the planner. */
    assignDay?: string;
    assignSlot?: string;
    assignWeek?: string;
  }>();
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { householdId } = useHousehold();
  const canonicalIndex = useCanonicalIndex();

  const isNew = isNewParam === '1';
  const assignTarget =
    assignWeek && assignDay != null && assignSlot
      ? { week: assignWeek, day: parseInt(assignDay, 10), slot: assignSlot as MealSlot }
      : null;
  const [busyAssign, setBusyAssign] = useState(false);
  // Guards the abandon cleanup: a blank recipe left untouched is deleted on unmount
  // unless the user finalized it (Done / assigned to a slot).
  const finalizedRef = useRef(false);
  const recipeRef = useRef<RecipeDetail | null>(null);

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [translation, setTranslation] = useState<
    (TranslationRow & { translated_at: string | null }) | null
  >(null);
  /** Live "who eats this" servings for this week's plan (null = not planned). */
  const [livePlanServings, setLivePlanServings] = useState<number | null>(null);
  /** NYT-style unit conversion (display only), persisted across recipes. */
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('original');

  useEffect(() => {
    AsyncStorage.getItem('mealy.unit-system')
      .then((v) => {
        if (v === 'metric' || v === 'us') setUnitSystem(v);
      })
      .catch(() => {});
  }, []);

  const changeUnitSystem = (system: UnitSystem) => {
    setUnitSystem(system);
    AsyncStorage.setItem('mealy.unit-system', system).catch(() => {});
  };

  const pickUnitSystem = () => {
    const mark = (system: UnitSystem, label: string) =>
      unitSystem === system ? `✓ ${label}` : label;
    Alert.alert(d.recipe.unitsTitle, undefined, [
      { text: mark('original', d.recipe.unitsOriginal), onPress: () => changeUnitSystem('original') },
      { text: mark('metric', d.recipe.unitsMetric), onPress: () => changeUnitSystem('metric') },
      { text: mark('us', d.recipe.unitsUs), onPress: () => changeUnitSystem('us') },
      { text: d.common.cancel, style: 'cancel' },
    ]);
  };
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState<{
    servings: string;
    prep: string;
    cook: string;
    fodmap: 'auto' | 'low' | 'moderate' | 'high';
  }>({ servings: '', prep: '', cook: '', fodmap: 'auto' });
  const [inThisWeek, setInThisWeek] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const [repositionOpen, setRepositionOpen] = useState(false);
  const [pickCapturedOpen, setPickCapturedOpen] = useState(false);
  // "From the web" cover sheet (spec Part 4/7). The ref is the synchronous
  // re-entrancy mutex (mirrors reExtractingRef) — a fast double-tap on Fetch
  // fires both presses before the fetching-state flush.
  const [webCoverOpen, setWebCoverOpen] = useState(false);
  const [webCoverUrl, setWebCoverUrl] = useState('');
  const [webCoverError, setWebCoverError] = useState<string | null>(null);
  const webCoverFetchingRef = useRef(false);
  const [webCoverFetching, setWebCoverFetching] = useState(false);
  // Full-screen image viewer for the Original source gallery.
  const [viewer, setViewer] = useState<{
    paths: string[];
    index: number;
    /** Source-gallery viewer allows per-image deletion; the hero view doesn't. */
    deletable?: boolean;
  } | null>(null);
  // FODMAP flags + match corrections (Phase 2 Task 7)
  const [matches, setMatches] = useState<Map<string, CanonicalIngredient | null>>(new Map());
  const [fodmapPersons, setFodmapPersons] = useState<string[]>([]);
  const [expandedRaw, setExpandedRaw] = useState<string | null>(null);
  const [fixRaw, setFixRaw] = useState<string | null>(null);
  const [ingredientsDraft, setIngredientsDraft] = useState<IngredientData[] | null>(null);
  const [stepsDraft, setStepsDraft] = useState<string[] | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  // Re-extract from stored source (confirm-before-replace, spec Part 6).
  // The ref is the synchronous re-entrancy mutex (LinkButton has no disabled
  // prop, and a fast double-tap can beat the state flush); the state only
  // drives the label swap.
  const reExtractingRef = useRef(false);
  const [reExtracting, setReExtracting] = useState(false);
  const [reExtractResult, setReExtractResult] = useState<CanonicalRecipe | null>(null);
  // Tracked separately from reExtractResult so "worker returned null" (show the
  // failure message) is distinguishable from "sheet closed" (both null).
  const [reExtractFailed, setReExtractFailed] = useState(false);
  // Low-FODMAP swap suggestions (spec Part 8). Same ref-guard pattern as
  // reExtractingRef: a fast double-tap on the pill fires both presses before
  // the swapsLoading state flush.
  const swapsLoadingRef = useRef(false);
  const [swapsLoading, setSwapsLoading] = useState(false);
  const [swapsResult, setSwapsResult] = useState<FodmapSwapResult | null>(null);
  // Tracked separately from swapsResult so "worker returned null" (show the
  // failure message) is distinguishable from "sheet closed" (both null).
  const [swapsFailed, setSwapsFailed] = useState(false);
  const [swapsOpen, setSwapsOpen] = useState(false);
  // v3.2 pinned-ingredients state
  const [stepsY, setStepsY] = useState<number | null>(null);
  const [pinnedVisible, setPinnedVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const panelProgress = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    if (!id) return;
    const [r, s, i, t, weekPlan] = await Promise.all([
      supabase.from('recipes').select('*').eq('id', id).single(),
      supabase.from('recipe_sources').select('*').eq('recipe_id', id).order('captured_at'),
      supabase.from('recipe_images').select('id, storage_path, position').eq('recipe_id', id).order('position'),
      supabase
        .from('recipe_translations')
        .select('locale, title, ingredients, steps, translated_at')
        .eq('recipe_id', id)
        .eq('locale', locale)
        .maybeSingle(),
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
    setTranslation((t.data as (TranslationRow & { translated_at: string | null }) | null) ?? null);
    if (weekPlan.data) {
      // Live meal servings: reflects who eats this right now, so quantities
      // rescale immediately when people/guests are added to the meal.
      const [{ data: entryRows }, { data: personRows }] = await Promise.all([
        supabase
          .from('plan_entries')
          .select('person_ids, guest_count')
          .eq('meal_plan_id', weekPlan.data.id)
          .eq('recipe_id', id),
        supabase.from('persons').select('is_employee').eq('household_id', householdId),
      ]);
      const entries = (entryRows as { person_ids: string[]; guest_count: number }[]) ?? [];
      setInThisWeek(entries.length > 0);
      if (entries.length > 0) {
        const eaterCount = (((personRows as { is_employee: boolean }[]) ?? [])).filter(
          (p) => !p.is_employee
        ).length;
        // Planned more than once this week: scale to the largest meal.
        setLivePlanServings(
          Math.max(
            ...entries.map((e) => entryServings(e.person_ids ?? [], e.guest_count ?? 0, eaterCount))
          )
        );
      } else {
        setLivePlanServings(null);
      }
    } else {
      setInThisWeek(false);
      setLivePlanServings(null);
    }
  }, [id, householdId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    recipeRef.current = recipe;
  }, [recipe]);

  // A blank manual recipe the user opened but never filled in is deleted when
  // they leave, so abandoned blanks don't pile up in the library.
  useEffect(() => {
    return () => {
      const r = recipeRef.current;
      if (isNew && !finalizedRef.current && r && isRecipeUntouched(r)) {
        void supabase.from('recipes').delete().eq('id', r.id);
      }
    };
  }, [isNew]);

  // A translation into the active locale exists and matches the current
  // content (fresh + same line counts) — the display can use it.
  const usableTranslation = !!(
    recipe &&
    translation &&
    (!translation.translated_at || !recipe.updated_at || translation.translated_at >= recipe.updated_at) &&
    translation.ingredients.length === recipe.ingredients.length &&
    translation.steps.length === recipe.steps.length
  );
  const awaitingTranslation =
    !!recipe && translationPending(recipe.language, locale, usableTranslation);

  // "Translating…" pill: while a translation should be on its way, refetch
  // its row every few seconds so the content flips over by itself. Bounded —
  // a permanently failed translation stops the poll (and the pill) quietly.
  const [translatePolls, setTranslatePolls] = useState(0);
  const showTranslating = awaitingTranslation && translatePolls < 20;
  useEffect(() => {
    if (!id || !awaitingTranslation || translatePolls >= 20) return;
    const timer = setTimeout(() => {
      void (async () => {
        const { data } = await supabase
          .from('recipe_translations')
          .select('locale, title, ingredients, steps, translated_at')
          .eq('recipe_id', id)
          .eq('locale', locale)
          .maybeSingle();
        if (data) setTranslation(data as TranslationRow & { translated_at: string | null });
        setTranslatePolls((c) => c + 1);
      })();
    }, 4000);
    return () => clearTimeout(timer);
  }, [id, locale, awaitingTranslation, translatePolls]);

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
      (line) => matches.get(line.raw) ?? null,
      (slug) => canonicalIndex?.bySlug.get(slug) ?? null
    );
  }, [recipe, matches, canonicalIndex]);

  // Always present once the recipe loads ('check' → "FODMAP ?") so the
  // byline badge stays a tap target for setting the level manually.
  const recipeTier = useMemo(() => {
    if (!recipe) return null;
    return recipe.fodmap_override ?? (fodmap ? recipeFodmapTier(fodmap) : 'check');
  }, [recipe, fodmap]);

  const flagByRaw = useMemo(
    () => new Map((fodmap?.flags ?? []).map((flag) => [flag.raw, flag])),
    [fodmap]
  );

  const swappableRaws = useMemo(
    () =>
      (fodmap?.flags ?? [])
        .filter((f) => f.tier === 'high' || f.tier === 'moderate')
        .map((f) => f.raw),
    [fodmap]
  );

  /** Single write path for the structured layer (recipe_sources never touched). */
  const saveRecipe = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!recipe) return;
      await supabase
        .from('recipes')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', recipe.id);
      // Content edits invalidate the derived translations: regenerate them all
      // (fire-and-forget) so the other languages never drift from the original.
      if ('title' in patch || 'ingredients' in patch || 'steps' in patch) {
        const next = { ...recipe, ...patch } as RecipeDetail;
        queueRecipeTranslation(recipe.id, {
          title: next.title,
          language: next.language,
          ingredients: next.ingredients,
          steps: next.steps,
        });
      }
      void load();
    },
    [recipe, load]
  );

  const pickCoverFromLibrary = async () => {
    if (!recipe) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    const asset = picked.assets?.[0];
    if (!asset) return;
    const path = `${householdId}/${recipe.id}/cover-custom.jpg`;
    const data = await fetch(asset.uri).then((r) => r.arrayBuffer());
    const { error } = await supabase.storage
      .from('recipe-media')
      .upload(path, data, { contentType: asset.mimeType ?? 'image/jpeg', upsert: true });
    if (error) return;
    await saveRecipe({ cover_image_path: path, cover_focal: null });
  };

  const replaceCoverFromWeb = async () => {
    if (!recipe || webCoverFetchingRef.current) return;
    const imageUrl = webCoverUrl.trim();
    if (!imageUrl) {
      setWebCoverError(d.recipe.pasteUrlFirst);
      return;
    }
    webCoverFetchingRef.current = true;
    setWebCoverFetching(true);
    setWebCoverError(null);
    try {
      const data = await fetchWebImage(imageUrl);
      if (!data) {
        setWebCoverError(d.recipe.imageUnusable);
        return;
      }
      const path = `${householdId}/${recipe.id}/cover-web.jpg`;
      const { error } = await supabase.storage
        .from('recipe-media')
        .upload(path, data, { contentType: 'image/jpeg', upsert: true });
      if (error) {
        setWebCoverError(d.recipe.uploadFailed);
        return;
      }
      setWebCoverOpen(false);
      setWebCoverUrl('');
      setWebCoverError(null);
      await saveRecipe({ cover_image_path: path, cover_focal: null });
    } finally {
      webCoverFetchingRef.current = false;
      setWebCoverFetching(false);
    }
  };

  /** Trash button in the source-image viewer: delete one gallery image. */
  const deleteSourceImage = (path: string) => {
    confirmDestructive({
      title: d.recipe.deleteImageTitle,
      message: d.recipe.deleteImageBody,
      confirmLabel: d.common.delete,
      cancelLabel: d.common.cancel,
      onConfirm: () => {
        void (async () => {
            if (!recipe) return;
            const row = images.find((img) => img.storage_path === path);
            if (row) await supabase.from('recipe_images').delete().eq('id', row.id);
            await supabase.storage.from('recipe-media').remove([path]);
            // The cover falls back to the next gallery image when it
            // pointed at the deleted file.
            if (recipe.cover_image_path === path) {
              const next =
                images.find((img) => img.storage_path !== path)?.storage_path ?? null;
              await supabase
                .from('recipes')
                .update({ cover_image_path: next, cover_focal: null })
                .eq('id', recipe.id);
            }
            setViewer((prev) => {
              if (!prev) return prev;
              const paths = prev.paths.filter((p) => p !== path);
              if (paths.length === 0) return null;
              return { ...prev, paths, index: Math.min(prev.index, paths.length - 1) };
            });
            void load();
          })();
      },
    });
  };

  /** Tap the byline type: pick the recipe category in place (stored as a tag). */
  const editCategory = () => {
    if (!recipe) return;
    const currentTag = deriveCategory(recipe.tags);
    const pick = (cat: ProteinCategory | null) => {
      const rest = recipe.tags.filter(
        (t) => !(PROTEIN_CATEGORIES as readonly string[]).includes(t)
      );
      void saveRecipe({ tags: cat ? [...rest, cat] : rest });
    };
    Alert.alert(d.recipe.recipeTypeTitle, d.recipe.autoDerivesHint, [
      {
        text: currentTag === null ? `${d.recipe.auto} ✓` : d.recipe.auto,
        onPress: () => pick(null),
      },
      ...PROTEIN_CATEGORIES.map((cat) => ({
        text: currentTag === cat ? `${CATEGORY_LABELS[cat]} ✓` : CATEGORY_LABELS[cat],
        onPress: () => pick(cat),
      })),
      { text: d.common.cancel, style: 'cancel' as const },
    ]);
  };

  /** Tap the byline meal chip: main (lunch/dinner) / breakfast / dessert / side. */
  const editMealType = () => {
    if (!recipe) return;
    const current = recipe.meal_type ?? 'main';
    const options: ['main' | 'breakfast' | 'dessert' | 'side', string][] = [
      ['main', d.recipe.mealMainOption],
      ['breakfast', d.recipe.mealBreakfast],
      ['dessert', d.recipe.mealDessert],
      ['side', d.recipe.mealSide],
    ];
    Alert.alert(d.recipe.mealTypeTitle, d.recipe.mealTypeHint, [
      ...options.map(([value, label]) => ({
        text: current === value ? `${label} ✓` : label,
        onPress: () => void saveRecipe({ meal_type: value }),
      })),
      { text: d.common.cancel, style: 'cancel' as const },
    ]);
  };

  /** Tap the byline badge: pick the FODMAP level in place. */
  const editFodmapLevel = () => {
    if (!recipe) return;
    const current = recipe.fodmap_override ?? 'auto';
    const mark = (v: string, label: string) => (current === v ? `${label} ✓` : label);
    Alert.alert(d.recipe.fodmapLevelTitle, d.recipe.autoDerivesHint, [
      {
        text: mark('auto', d.recipe.auto),
        onPress: () => void saveRecipe({ fodmap_override: null }),
      },
      {
        text: mark('low', d.recipe.low),
        onPress: () => void saveRecipe({ fodmap_override: 'low' }),
      },
      {
        text: mark('moderate', d.recipe.moderate),
        onPress: () => void saveRecipe({ fodmap_override: 'moderate' }),
      },
      {
        text: mark('high', d.recipe.high),
        onPress: () => void saveRecipe({ fodmap_override: 'high' }),
      },
      { text: d.common.cancel, style: 'cancel' },
    ]);
  };

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
      fodmap_override: details.fodmap === 'auto' ? null : details.fodmap,
    };
    // Servings change rescales parsed quantities (spec Part 3).
    if (newServings && recipe.servings && newServings !== recipe.servings) {
      patch.ingredients = rescaleIngredients(recipe.ingredients, newServings / recipe.servings);
    }
    setDetailsOpen(false);
    setIngredientsDraft(null);
    await saveRecipe(patch);
  };

  const markReviewed = async () => {
    if (!recipe) return;
    await supabase.from('recipes').update({ needs_review: false }).eq('id', recipe.id);
    void load();
  };

  const runReExtract = async () => {
    // Check-and-set the ref synchronously: a fast double-tap fires both
    // presses before the reExtracting state flush, so state alone can let
    // two concurrent /structure calls through.
    if (sources.length === 0 || reExtractingRef.current) return;
    reExtractingRef.current = true;
    setReExtracting(true);
    try {
      const result = await reExtract(sources[0].verbatim);
      setReExtractResult(result); // null → sheet shows the failure message
      setReExtractFailed(result === null);
    } finally {
      reExtractingRef.current = false;
      setReExtracting(false);
    }
  };

  const closeReExtractSheet = () => {
    setReExtractResult(null);
    setReExtractFailed(false);
  };

  const applyReExtract = async () => {
    const r = reExtractResult;
    if (!r) return;
    setReExtractResult(null);
    setTitleDraft(null);
    setIngredientsDraft(null);
    setStepsDraft(null);
    await saveRecipe({
      title: r.title,
      language: r.language,
      servings: r.servings,
      prep_minutes: r.prep_minutes,
      cook_minutes: r.cook_minutes,
      dish_type: r.dish_type,
      tags: r.tags,
      ingredients: r.ingredients,
      steps: r.steps,
      nutrition: r.nutrition,
      needs_review: r.confidence < 0.6,
    });
  };

  const runSwaps = async () => {
    // Check-and-set the ref synchronously: a fast double-tap fires both
    // presses before the swapsLoading state flush, so state alone can let
    // two concurrent /fodmap/swaps calls through.
    if (!recipe || swappableRaws.length === 0 || swapsLoadingRef.current) return;
    swapsLoadingRef.current = true;
    setSwapsLoading(true);
    try {
      const response = await fodmapSwaps({
        title: recipe.title,
        language: recipe.language,
        servings: recipe.servings,
        ingredients: recipe.ingredients,
        steps: recipe.steps,
        flagged: swappableRaws,
      });
      setSwapsResult(response); // null → sheet shows the failure message
      setSwapsFailed(response === null);
      setSwapsOpen(true);
    } finally {
      swapsLoadingRef.current = false;
      setSwapsLoading(false);
    }
  };

  const closeSwapsSheet = () => {
    setSwapsOpen(false);
    setSwapsResult(null);
    setSwapsFailed(false);
  };

  const applySwaps = async () => {
    const r = swapsResult;
    if (!recipe || !r) return;
    const byRaw = new Map(r.swaps.map((s) => [s.raw, s.replacement]));
    const ingredients = recipe.ingredients.map((ing) => {
      const key = ing.raw || ing.name;
      const rep = byRaw.get(key);
      // Rebase `raw` onto the replacement's name so the FODMAP engine
      // (which keys off `raw`) matches the swapped ingredient going
      // forward instead of re-flagging the original line forever.
      return rep ? { ...rep, raw: rep.name } : ing;
    });
    setSwapsOpen(false);
    setSwapsResult(null);
    // External write: invalidate any open drafts that mirror these fields.
    setIngredientsDraft(null);
    setStepsDraft(null);
    await saveRecipe({ ingredients, steps: r.steps });
  };

  /** Bookmark chip: plan it, or confirm-remove when already in this week (v3). */
  const onBookmark = () => {
    if (!recipe) return;
    if (inThisWeek) {
      confirmRemoveFromWeek(
        localizeContent(recipe, translation).title,
        () => {
          void removeRecipeFromCurrentWeek(householdId, recipe.id).then(load);
        },
        d
      );
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

  // Manual recipe created from Library/Search: keep it, drop the isNew flag,
  // and show it in normal view mode.
  const finishManual = () => {
    finalizedRef.current = true;
    router.replace({ pathname: '/recipe/[id]', params: { id } });
  };

  // Manual/automatic recipe created from the planner: drop it into the slot and
  // return to the planner (which reloads the week on focus).
  const finishAssign = async () => {
    if (!recipe || !assignTarget) return;
    setBusyAssign(true);
    try {
      await assignRecipeToSlot({
        householdId,
        recipeId: recipe.id,
        weekIso: assignTarget.week,
        day: assignTarget.day,
        slot: assignTarget.slot,
      });
      finalizedRef.current = true;
      router.back();
    } catch {
      Alert.alert(d.recipe.addToPlannerFailTitle, d.common.genericError);
    } finally {
      setBusyAssign(false);
    }
  };

  if (!recipe) {
    return (
      <Sheet onDismiss={dismiss}>
        <View style={{ padding: screenPadding }}>
          <Muted>{d.common.loading}</Muted>
        </View>
      </Sheet>
    );
  }

  const category = resolveProteinCategory(recipe.tags, recipe.ingredients, canonicalIndex);
  // Scale ingredient amounts to the meal's servings (eaters + guests) whenever
  // the recipe is planned this week — live from the plan, so adding people to
  // the meal updates the quantities on the next load. The route param is only
  // the fallback while the live value hasn't loaded. Display only — the
  // recipe's stored quantities always stay at its own base yield.
  const planServings =
    livePlanServings ?? (planServingsParam ? parseInt(planServingsParam, 10) : null);
  const planFactor =
    planServings != null ? servingsFactor(planServings, recipe.servings) : null;
  // Active-locale translation, used for DISPLAY only. Edits always operate on
  // the original content; the fidelity guard (same counts) lets flags/matches
  // keyed on original raws pair with translated lines by index. A stale or
  // mismatched translation is ignored rather than half-applied.
  // Freshness: after an edit (e.g. a servings change rescaled the parsed
  // quantities) the translations regenerate asynchronously — until the fresh
  // rows land, the stale ones would show the OLD quantities, so ignore any
  // translation older than the recipe's last edit.
  const contentTranslation = usableTranslation ? translation : null;
  const localized = localizeContent(recipe, contentTranslation);
  const displayTitle = localized.title;
  const displaySteps = localized.steps;
  // Display pipeline: plan scaling first, then the unit-system conversion.
  // Both are skipped while editing — drafts always operate on the original.
  const viewIngredients =
    ingredientsDraft !== null
      ? localized.ingredients
      : convertIngredients(
          planFactor
            ? rescaleIngredients(localized.ingredients, planFactor)
            : localized.ingredients,
          unitSystem
        );
  const metaParts = [
    planFactor && planServings != null
      ? fmt(d.recipe.servingsThisWeek, { n: planServings })
      : recipe.servings
        ? fmt(d.recipe.servingsCount, { n: recipe.servings })
        : null,
    recipe.prep_minutes ? fmt(d.recipe.prepMin, { n: recipe.prep_minutes }) : null,
    recipe.cook_minutes ? fmt(d.recipe.cookMin, { n: recipe.cook_minutes }) : null,
  ].filter(Boolean);

  const galleryPaths =
    images.length > 0
      ? images.map((img) => img.storage_path)
      : recipe.cover_image_path
        ? [recipe.cover_image_path]
        : [];
  const heroPath = recipe.cover_image_path ?? galleryPaths[0] ?? null;
  const restPaths = galleryPaths.filter((p) => p !== heroPath);
  // url/reel captures carry the original link; photo/paste/PDF are null.
  const sourceUrl = sources.find((s) => s.url)?.url ?? null;
  const hasSource = galleryPaths.length > 0 || sourceUrl !== null;

  const deleteRecipe = () => {
    confirmDestructive({
      title: d.recipe.deleteRecipeTitle,
      message: fmt(d.recipe.deleteRecipeBody, { title: recipe.title }),
      confirmLabel: d.common.delete,
      cancelLabel: d.common.cancel,
      onConfirm: () => {
        void (async () => {
          // Best-effort storage cleanup; the row delete is what matters.
          const paths = Array.from(
            new Set([heroPath, ...galleryPaths].filter((p): p is string => p !== null))
          );
          if (paths.length > 0) {
            await supabase.storage.from('recipe-media').remove(paths);
          }
          const { error } = await supabase.from('recipes').delete().eq('id', recipe.id);
          if (error) {
            notify(d.recipe.deleteRecipeFailTitle, d.recipe.tryAgain);
            return;
          }
          // Opened by direct URL (web deep link / refresh) there is no history
          // to go back to — land on the library, which refetches on focus.
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(tabs)/library');
          }
        })();
      },
    });
  };
  const showPinnedBar = pinnedVisible;
  const actionBottom = (Platform.OS === 'ios' ? insets.bottom : insets.bottom) + 16;

  return (
    <Sheet onDismiss={dismiss}>
      <ImageLightbox
        visible={viewer !== null}
        paths={viewer?.paths ?? []}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
        onDelete={viewer?.deletable ? deleteSourceImage : undefined}
      />
      <View
        style={{ flex: 1 }}
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
      >
        <ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 140 }}
        >
          <Hero
            path={heroPath}
            saved={inThisWeek}
            onBookmark={onBookmark}
            focal={recipe.cover_focal}
            onEdit={() => setCoverMenuOpen(true)}
            onPress={
              heroPath
                ? // The cover enlarges alone; the Original source gallery below
                  // is where multi-image paging lives.
                  () => setViewer({ paths: [heroPath], index: 0 })
                : undefined
            }
          />

          <View style={{ padding: screenPadding, gap: 14 }}>
            {titleDraft !== null ? (
              <View style={{ gap: 12 }}>
                <Field value={titleDraft} onChangeText={setTitleDraft} />
                <Button
                  label={d.common.save}
                  onPress={() =>
                    void saveRecipe({ title: titleDraft.trim() || recipe.title }).then(() => setTitleDraft(null))
                  }
                />
                <Button label={d.common.cancel} kind="secondary" onPress={() => setTitleDraft(null)} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text
                  style={{
                    flex: 1,
                    color: colors.text,
                    fontSize: fontSize.heroTitle,
                    lineHeight: Math.round(fontSize.heroTitle * 1.15),
                    letterSpacing: -0.3,
                    fontFamily: fonts.display,
                  }}
                >
                  {displayTitle}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={d.recipe.editTitleA11y}
                  onPress={() => setTitleDraft(recipe.title)}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: minTapTarget - 8,
                    height: minTapTarget - 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: (minTapTarget - 8) / 2,
                    backgroundColor: pressed ? colors.cardPressed : 'transparent',
                  })}
                >
                  <Ionicons name="create-outline" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            )}

            {/* Byline-style meta */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={fmt(d.recipe.recipeTypeA11y, {
                  type: category ? CATEGORY_LABELS[category] : d.recipe.typeUnset,
                })}
                onPress={editCategory}
                hitSlop={8}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                {category ? <CategoryDot category={category} /> : null}
                <Muted>{category ? CATEGORY_LABELS[category] : d.recipe.typeUnknown}</Muted>
                <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
              </Pressable>
              {recipeTier ? (
                <>
                  <Muted>·</Muted>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fmt(d.recipe.fodmapLevelA11y, { tier: tierWord(d, recipeTier) })}
                    onPress={editFodmapLevel}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 2,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text
                      style={{
                        color:
                          recipeTier === 'high'
                            ? colors.danger
                            : recipeTier === 'moderate'
                              ? colors.saffron
                              : recipeTier === 'low'
                                ? colors.spineVeg
                                : colors.textMuted,
                        fontSize: fontSize.meta,
                        fontFamily: fonts.uiSemi,
                      }}
                    >
                      {recipeTier === 'high'
                        ? d.recipe.highFodmap
                        : recipeTier === 'moderate'
                          ? d.recipe.moderateFodmap
                          : recipeTier === 'low'
                            ? d.recipe.lowFodmap
                            : d.recipe.fodmapUnknown}
                    </Text>
                    <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
                  </Pressable>
                </>
              ) : null}
              <Muted>·</Muted>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={d.recipe.mealTypeA11y}
                onPress={editMealType}
                hitSlop={8}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 2,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Muted>
                  {recipe.meal_type === 'breakfast'
                    ? d.recipe.mealBreakfast
                    : recipe.meal_type === 'dessert'
                      ? d.recipe.mealDessert
                      : recipe.meal_type === 'side'
                        ? d.recipe.mealSide
                        : d.recipe.mealMain}
                </Muted>
                <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
              </Pressable>
              {metaParts.length > 0 ? <Muted>·</Muted> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={d.recipe.editServingsTimesA11y}
                onPress={() => {
                  setDetails({
                    servings: recipe.servings?.toString() ?? '',
                    prep: recipe.prep_minutes?.toString() ?? '',
                    cook: recipe.cook_minutes?.toString() ?? '',
                    fodmap: recipe.fodmap_override ?? 'auto',
                  });
                  setDetailsOpen(true);
                }}
              >
                {metaParts.length > 0 ? (
                  <Muted>{metaParts.join(' · ')}</Muted>
                ) : (
                  <Muted>{d.recipe.addServingsTime}</Muted>
                )}
              </Pressable>
              {swappableRaws.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={d.recipe.suggestSwapsA11y}
                  onPress={() => void runSwaps()}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    minHeight: 28,
                    paddingHorizontal: 10,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: colors.accent,
                    backgroundColor: 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons name="leaf-outline" size={14} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>
                    {swapsLoading ? d.recipe.working : d.recipe.lowFodmapChip}
                  </Text>
                </Pressable>
              ) : null}
              {recipe.needs_review ? (
                <Text style={{ color: colors.saffron, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>
                  {d.recipe.needsReview}
                </Text>
              ) : null}
              {showTranslating ? (
                <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>
                  {d.recipe.translating}
                </Text>
              ) : null}
            </View>

            {recipe.needs_review ? (
              <Button label={d.recipe.markReviewed} kind="secondary" onPress={() => void markReviewed()} />
            ) : null}

            {sources.length > 0 ? (
              <LinkButton
                label={reExtracting ? d.recipe.reExtracting : d.recipe.reExtractFromSource}
                onPress={() => void runReExtract()}
              />
            ) : null}

            <Hairline />

            <View style={{ gap: 18 }}>
              {hasSource ? (
                <View style={{ gap: 12 }}>
                  <Title>{d.recipe.originalSource}</Title>
                  {sourceUrl ? <SourceLink url={sourceUrl} /> : null}
                  {restPaths.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 12 }}
                    >
                      {restPaths.map((path) => (
                        <GalleryImage
                          key={path}
                          path={path}
                          // heroPath may not be galleryPaths[0] (cover_image_path wins), so
                          // look up this image's real position for the lightbox.
                          onPress={() =>
                            setViewer({
                              paths: galleryPaths,
                              index: galleryPaths.indexOf(path),
                              deletable: true,
                            })
                          }
                        />
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              ) : null}

              <SectionTitle
                title={d.recipe.ingredients}
                editing={ingredientsDraft !== null}
                onToggle={() =>
                  setIngredientsDraft(
                    ingredientsDraft === null ? recipe.ingredients.map((i) => ({ ...i })) : null
                  )
                }
                extra={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={d.recipe.convertUnitsA11y}
                    onPress={pickUnitSystem}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      width: minTapTarget - 8,
                      height: minTapTarget - 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: (minTapTarget - 8) / 2,
                      backgroundColor: pressed ? colors.cardPressed : 'transparent',
                    })}
                  >
                    <Ionicons
                      name="swap-horizontal"
                      size={20}
                      color={unitSystem === 'original' ? colors.textMuted : colors.text}
                    />
                  </Pressable>
                }
              />

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
                      high.length > 0
                        ? fmt(d.recipe.highFor, { name: personName, items: high.join(', ') })
                        : null,
                      moderate.length > 0
                        ? fmt(d.recipe.moderateList, { items: moderate.join(', ') })
                        : null,
                      check.length > 0
                        ? fmt(d.recipe.checkList, { items: check.join(', ') })
                        : null,
                    ].filter(Boolean);
                    return partsList.length > 0 ? (
                      <Body key={personName} style={{ fontSize: fontSize.small }}>
                        {partsList.join(' · ')}
                      </Body>
                    ) : null;
                  })}
                  {[
                    ...new Map(
                      fodmap.flags
                        .filter(
                          (f) => (f.tier === 'high' || f.tier === 'moderate') && f.swaps.length > 0
                        )
                        .map((f) => [f.name, f])
                    ).values(),
                  ].map((flag) => (
                    <Muted key={`swap-${flag.name}`}>
                      {fmt(d.recipe.swapLine, {
                        name: flag.name,
                        swaps: flag.swaps.join(` ${d.common.or} `),
                      })}
                    </Muted>
                  ))}
                  {fodmap.stacking.map((warning) => (
                    <Muted key={warning.group}>
                      {fmt(d.recipe.stackingWarning, {
                        ingredients: warning.ingredients.join(' + '),
                        group: warning.group,
                      })}
                    </Muted>
                  ))}
                  <Muted style={{ fontStyle: 'italic' }}>{d.recipe.fodmapDisclaimer}</Muted>
                </View>
              ) : null}

              {ingredientsDraft !== null ? (
                <View style={{ gap: 10 }}>
                  {ingredientsDraft.map((ing, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Field
                        value={ing.quantity?.toString() ?? ''}
                        onChangeText={(v) => {
                          const n = parseFloat(v.replace(',', '.'));
                          setIngredientsDraft(
                            updateItem(ingredientsDraft, i, {
                              ...ing,
                              quantity: Number.isFinite(n) ? n : null,
                            })
                          );
                        }}
                        keyboardType="decimal-pad"
                        placeholder={d.recipe.qtyPlaceholder}
                        style={{ width: 64 }}
                      />
                      <Field
                        value={ing.unit ?? ''}
                        onChangeText={(v) =>
                          setIngredientsDraft(updateItem(ingredientsDraft, i, { ...ing, unit: v || null }))
                        }
                        placeholder={d.recipe.unitPlaceholder}
                        style={{ width: 64 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Field
                          value={ing.name}
                          onChangeText={(v) =>
                            setIngredientsDraft(updateItem(ingredientsDraft, i, { ...ing, name: v }))
                          }
                          placeholder={d.recipe.ingredientPlaceholder}
                        />
                      </View>
                      <EditRowControls
                        index={i}
                        count={ingredientsDraft.length}
                        onMove={(from, to) => setIngredientsDraft(moveItem(ingredientsDraft, from, to))}
                        onRemove={(idx) => setIngredientsDraft(removeItem(ingredientsDraft, idx))}
                      />
                    </View>
                  ))}
                  <Button
                    label={d.recipe.addIngredient}
                    kind="secondary"
                    onPress={() =>
                      setIngredientsDraft([
                        ...ingredientsDraft,
                        { raw: '', quantity: null, unit: null, name: '', group: null, fodmap: null },
                      ])
                    }
                  />
                  <Button
                    label={d.recipe.saveIngredients}
                    onPress={() =>
                      void saveRecipe({
                        ingredients: ingredientsDraft
                          .filter((ing) => ing.name.trim())
                          .map((ing) => ({ ...ing, raw: ing.raw || ing.name.trim(), name: ing.name.trim() })),
                      }).then(() => setIngredientsDraft(null))
                    }
                  />
                </View>
              ) : (
                <View>
                  {viewIngredients.map((ing, i) => {
                    // Flags/matches are keyed on the ORIGINAL raw line; the
                    // fidelity guard guarantees index alignment with the
                    // translated display line.
                    const orig = recipe.ingredients[i] ?? ing;
                    const rawKey = orig.raw || orig.name;
                    const flag = flagByRaw.get(rawKey);
                    const canonical = matches.get(rawKey) ?? null;
                    const isExpanded = expandedRaw === rawKey;
                    return (
                      <View key={`${rawKey}-${i}`}>
                        {i > 0 ? <Hairline /> : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={fmt(d.recipe.ingredientDetailsA11y, { name: ing.name })}
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
                                ? fmt(d.recipe.matchedTo, { name: canonical.name_fr })
                                : d.recipe.notMatched}
                            </Muted>
                            {fodmapPersons.length > 0 && flag ? (
                              <Muted>
                                {fmt(d.recipe.fodmapTierLine, {
                                  tier: tierWord(d, flag.tier),
                                  explanation: flag.explanation,
                                })}
                              </Muted>
                            ) : null}
                            <LinkButton
                              label={d.recipe.correctMatch}
                              onPress={() => setFixRaw(rawKey)}
                              style={{ minHeight: 36 }}
                              textStyle={{ fontSize: fontSize.small }}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {recipe.ingredients.length === 0 ? <Muted>{d.recipe.noIngredients}</Muted> : null}
                </View>
              )}
            </View>
          </View>

          {/* Steps live in their own content-level container so onLayout gives
              the exact scroll offset for the pinned-ingredients bar (v3.2). */}
          <View
            onLayout={(e) => setStepsY(e.nativeEvent.layout.y)}
            style={{ paddingHorizontal: screenPadding, gap: 18 }}
          >
            <SectionTitle
              title={d.recipe.steps}
              editing={stepsDraft !== null}
              onToggle={() => setStepsDraft(stepsDraft === null ? [...recipe.steps] : null)}
            />
            {stepsDraft !== null ? (
              <View style={{ gap: 10 }}>
                {stepsDraft.map((step, i) => (
                  <View key={i} style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Eyebrow>{fmt(d.recipe.stepN, { n: i + 1 })}</Eyebrow>
                      <EditRowControls
                        index={i}
                        count={stepsDraft.length}
                        onMove={(from, to) => setStepsDraft(moveItem(stepsDraft, from, to))}
                        onRemove={(idx) => setStepsDraft(removeItem(stepsDraft, idx))}
                      />
                    </View>
                    <Field value={step} onChangeText={(v) => setStepsDraft(updateItem(stepsDraft, i, v))} multiline />
                  </View>
                ))}
                <Button label={d.recipe.addStep} kind="secondary" onPress={() => setStepsDraft([...stepsDraft, ''])} />
                <Button
                  label={d.recipe.saveSteps}
                  onPress={() =>
                    void saveRecipe({ steps: stepsDraft.map((s) => s.trim()).filter(Boolean) }).then(() =>
                      setStepsDraft(null)
                    )
                  }
                />
              </View>
            ) : (
              <View style={{ gap: 20 }}>
                {displaySteps.map((step, i) => (
                  <Pressable
                    key={i}
                    accessibilityRole="text"
                    onPress={() => {
                      if (panelOpen) togglePanel(false);
                    }}
                    style={{ gap: 6 }}
                  >
                    <Eyebrow>{fmt(d.recipe.stepN, { n: i + 1 })}</Eyebrow>
                    <Body>{step}</Body>
                  </Pressable>
                ))}
                {displaySteps.length === 0 ? <Muted>{d.recipe.noSteps}</Muted> : null}
              </View>
            )}
          </View>

          <View style={{ paddingHorizontal: screenPadding, paddingTop: 32 }}>
            <Button label={d.recipe.deleteRecipe} kind="danger" onPress={deleteRecipe} />
          </View>
        </ScrollView>

        {/* v3.2: pinned ingredients bar while reading steps */}
        {showPinnedBar ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 15 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={panelOpen ? d.recipe.hideIngredients : d.recipe.showIngredients}
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
                {d.recipe.ingredients}
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
                <ScrollView
                  contentContainerStyle={{
                    paddingHorizontal: screenPadding,
                    paddingTop: 12,
                    paddingBottom: 20,
                  }}
                >
                  {viewIngredients.map((ing, i) => {
                    const quantity = [ing.quantity, ing.unit].filter((v) => v != null).join(' ');
                    return (
                      <View key={`pin-${ing.raw}-${i}`}>
                        {i > 0 ? <Hairline /> : null}
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'baseline',
                            gap: 12,
                            paddingVertical: 12,
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
          {assignTarget ? (
            <Button
              label={fmt(d.recipe.addToSlot, {
                day: d.common.days[assignTarget.day],
                slot: assignTarget.slot === 'lunch' ? d.common.lunch : d.common.dinner,
              })}
              onPress={() => void finishAssign()}
              loading={busyAssign}
            />
          ) : isNew ? (
            <Button label={d.common.done} onPress={finishManual} />
          ) : (
            <Button
              label={inThisWeek ? d.recipe.addAgainThisWeek : d.recipe.addToThisWeek}
              onPress={() => setSheetOpen(true)}
            />
          )}
        </View>
      </View>

      <AddToWeekSheet
        visible={sheetOpen}
        recipeId={recipe.id}
        recipeTitle={displayTitle}
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
          <Eyebrow>{d.recipe.servings}</Eyebrow>
          <Field
            value={details.servings}
            onChangeText={(v) => setDetails({ ...details, servings: v })}
            keyboardType="number-pad"
          />
          <Eyebrow>{d.recipe.prepMinLabel}</Eyebrow>
          <Field
            value={details.prep}
            onChangeText={(v) => setDetails({ ...details, prep: v })}
            keyboardType="number-pad"
          />
          <Eyebrow>{d.recipe.cookMinLabel}</Eyebrow>
          <Field
            value={details.cook}
            onChangeText={(v) => setDetails({ ...details, cook: v })}
            keyboardType="number-pad"
          />
          <Eyebrow>{d.recipe.fodmapLevelTitle}</Eyebrow>
          <Muted>{d.recipe.fodmapOverrideHint}</Muted>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(
              [
                ['auto', d.recipe.auto],
                ['low', d.recipe.low],
                ['moderate', d.recipe.modShort],
                ['high', d.recipe.high],
              ] as ['auto' | 'low' | 'moderate' | 'high', string][]
            ).map(([value, label]) => {
              const selected = details.fodmap === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setDetails({ ...details, fodmap: value })}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 40,
                    borderRadius: radius.control,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: selected ? 0 : 1,
                    borderColor: colors.border,
                    backgroundColor: selected
                      ? colors.text
                      : pressed
                        ? colors.cardPressed
                        : 'transparent',
                  })}
                >
                  <Text
                    style={{
                      color: selected ? colors.bg : colors.text,
                      fontSize: fontSize.small,
                      fontFamily: fonts.uiMedium,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Button label={d.common.save} onPress={() => void saveDetails()} />
          <Button label={d.common.cancel} kind="secondary" onPress={() => setDetailsOpen(false)} />
        </View>
      </Modal>

      <Modal
        visible={coverMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCoverMenuOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
          onPress={() => setCoverMenuOpen(false)}
        />
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
          <Eyebrow>{d.recipe.coverImage}</Eyebrow>
          {heroPath ? (
            <Button
              label={d.recipe.reposition}
              kind="secondary"
              onPress={() => {
                setCoverMenuOpen(false);
                setRepositionOpen(true);
              }}
            />
          ) : null}
          {images.length > 0 ? (
            <Button
              label={d.recipe.chooseFromCaptured}
              kind="secondary"
              onPress={() => {
                setCoverMenuOpen(false);
                setPickCapturedOpen(true);
              }}
            />
          ) : null}
          <Button
            label={d.recipe.chooseFromLibrary}
            kind="secondary"
            onPress={() => {
              setCoverMenuOpen(false);
              void pickCoverFromLibrary();
            }}
          />
          <Button
            label={d.recipe.fromTheWeb}
            kind="secondary"
            onPress={() => {
              setCoverMenuOpen(false);
              setWebCoverUrl('');
              setWebCoverError(null);
              setWebCoverOpen(true);
            }}
          />
          <Button label={d.common.cancel} kind="secondary" onPress={() => setCoverMenuOpen(false)} />
        </View>
      </Modal>

      <Modal
        visible={webCoverOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setWebCoverOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
          onPress={() => setWebCoverOpen(false)}
        />
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
          <Eyebrow>{d.recipe.fromTheWeb}</Eyebrow>
          <Field
            value={webCoverUrl}
            onChangeText={(v) => {
              setWebCoverUrl(v);
              setWebCoverError(null);
            }}
            placeholder={d.recipe.pasteImageUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {webCoverError ? (
            <Body style={{ color: colors.danger }}>{webCoverError}</Body>
          ) : null}
          <Button
            label={webCoverFetching ? d.recipe.fetching : d.recipe.fetchBtn}
            disabled={webCoverFetching}
            onPress={() => void replaceCoverFromWeb()}
          />
          <Button
            label={d.common.cancel}
            kind="secondary"
            onPress={() => {
              setWebCoverOpen(false);
              setWebCoverUrl('');
              setWebCoverError(null);
            }}
          />
        </View>
      </Modal>

      <Modal
        visible={pickCapturedOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickCapturedOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
          onPress={() => setPickCapturedOpen(false)}
        />
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
          <Eyebrow>{d.recipe.chooseFromCaptured}</Eyebrow>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {galleryPaths.map((path) => (
              <GalleryImage
                key={path}
                path={path}
                onPress={() => {
                  setPickCapturedOpen(false);
                  void saveRecipe({ cover_image_path: path, cover_focal: null });
                }}
              />
            ))}
          </ScrollView>
          <Button label={d.common.cancel} kind="secondary" onPress={() => setPickCapturedOpen(false)} />
        </View>
      </Modal>

      <Modal
        visible={reExtractResult !== null || reExtractFailed}
        transparent
        animationType="fade"
        onRequestClose={closeReExtractSheet}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
          onPress={closeReExtractSheet}
        />
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
          <Eyebrow>{d.recipe.reExtractFromSource}</Eyebrow>
          {reExtractFailed ? (
            <>
              <Body>{d.recipe.reExtractFailedMsg}</Body>
              <Button label={d.common.close} kind="secondary" onPress={closeReExtractSheet} />
            </>
          ) : reExtractResult ? (
            <>
              <Title>{reExtractResult.title}</Title>
              <Muted>
                {fmt(d.recipe.ingredientsStepsCount, {
                  ingredients: reExtractResult.ingredients.length,
                  steps: reExtractResult.steps.length,
                })}
              </Muted>
              <Muted>
                {[
                  reExtractResult.servings
                    ? fmt(d.recipe.servingsCount, { n: reExtractResult.servings })
                    : null,
                  reExtractResult.prep_minutes
                    ? fmt(d.recipe.prepMin, { n: reExtractResult.prep_minutes })
                    : null,
                  reExtractResult.cook_minutes
                    ? fmt(d.recipe.cookMin, { n: reExtractResult.cook_minutes })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || d.recipe.noServingsOrTime}
              </Muted>
              <Button label={d.recipe.apply} onPress={() => void applyReExtract()} />
              <Button label={d.common.cancel} kind="secondary" onPress={closeReExtractSheet} />
            </>
          ) : null}
        </View>
      </Modal>

      <Modal visible={swapsOpen} transparent animationType="fade" onRequestClose={closeSwapsSheet}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={closeSwapsSheet} />
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
          <Eyebrow>{d.recipe.lowFodmapSwaps}</Eyebrow>
          {swapsFailed ? (
            <>
              <Body>{d.recipe.swapsFailedMsg}</Body>
              <Button label={d.common.close} kind="secondary" onPress={closeSwapsSheet} />
            </>
          ) : swapsResult ? (
            <>
              <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 12 }}>
                {swapsResult.swaps.map((swap) => {
                  const flag = flagByRaw.get(swap.raw);
                  return (
                    <View key={swap.raw} style={{ gap: 2 }}>
                      <Body>{`${flag?.name ?? swap.raw} → ${swap.replacement.name}`}</Body>
                      <Muted>{swap.note}</Muted>
                    </View>
                  );
                })}
                {swapsResult.swaps.length === 0 ? <Muted>{d.recipe.noSwaps}</Muted> : null}
              </ScrollView>
              <Button label={d.recipe.applyAll} onPress={() => void applySwaps()} />
              <Button label={d.common.cancel} kind="secondary" onPress={closeSwapsSheet} />
            </>
          ) : null}
        </View>
      </Modal>

      {heroPath && repositionOpen ? (
        <CoverRepositionModal
          visible
          path={heroPath}
          focal={recipe.cover_focal}
          onClose={() => setRepositionOpen(false)}
          onSave={(f) => {
            setRepositionOpen(false);
            void saveRecipe({ cover_focal: f, cover_image_path: heroPath });
          }}
        />
      ) : null}

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
