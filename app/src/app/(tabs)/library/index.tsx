import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  AddToWeekSheet,
  confirmRemoveFromWeek,
  removeRecipeFromCurrentWeek,
} from "@/components/add-to-week";
import { QuickFilters } from "@/components/quick-filters";
import {
  buildUploaderOptions,
  filterByUploader,
  type UploaderOption,
} from "@/lib/uploader-filter";
import {
  CarouselCard,
  Hero,
  RecipeImage,
  RecipeRow,
  ThisWeekCard,
  type RecipeListItem,
  type WeekStripItem,
} from "@/components/recipe-cards";
import { SaveSheet } from "@/components/save-sheet";
import {
  EmptyState,
  Eyebrow,
  Hairline,
  Loading,
  Muted,
  SectionHeader,
} from "@/components/ui";
import { confirmDestructive, notify } from "@/lib/confirm";
import { useAuth, useHousehold } from "@/lib/auth";
import { consumeInvalidation } from "@/lib/list-refresh";
import { matchCanonical, normalizeRaw } from "@/lib/canonical";
import {
  dismissCaptureJob,
  JOB_ERROR_NO_RECIPE,
  loadActiveCaptureJobs,
  retriggerStaleJobs,
  retryCaptureJob,
  type CaptureJobRow,
} from "@/lib/capture-jobs";
import type { ProteinCategory } from "@/lib/category";
import { resolveProteinCategory } from "@/lib/category";
import { computeRecipeFodmap } from "@/lib/fodmap";
import { fmt, useI18n } from "@/lib/i18n";
import {
  collageCovers,
  groupByOwner,
  savedRecipeIds,
  summarizeFolders,
  type FolderLink,
  type FolderRow,
  type FolderSummary,
} from "@/lib/folders";
import { addWeeks, weekStart } from "@/lib/plan";
import { matchesQuickFilters, type QuickFilter } from "@/lib/quick-filters";
import { supabase } from "@/lib/supabase";
import { localizedTitle } from "@/lib/translations";
import {
  fonts,
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  tabBarClearance,
  useTheme,
} from "@/lib/theme";
import { useCanonicalIndex } from "@/lib/use-canonical";

/** Persisted folders-section layout (NYT Recipe Box has both). */
type FolderView = "grid" | "list";
const FOLDER_VIEW_KEY = "mealy.folder-view";

export default function HomeScreen() {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { householdId } = useHousehold();
  const { session } = useAuth();
  const userId = session?.user.id ?? "";

  const [householdRecipes, setHouseholdRecipes] = useState<RecipeListItem[]>([]);
  // "Added by" select: defaults to everyone's recipes.
  const [uploaderFilter, setUploaderFilter] = useState<string | null>(null);
  const [uploaderOptions, setUploaderOptions] = useState<UploaderOption[]>([]);
  const [uploaderSheetOpen, setUploaderSheetOpen] = useState(false);
  const recipes = useMemo(
    () => filterByUploader(householdRecipes, uploaderFilter),
    [householdRecipes, uploaderFilter],
  );
  const [plannedRecentIds, setPlannedRecentIds] = useState<Set<string>>(new Set());
  const [weekEntries, setWeekEntries] = useState<
    { id: string; recipe_id: string | null; custom_title: string | null }[]
  >([]);
  const [sheetRecipe, setSheetRecipe] = useState<RecipeListItem | null>(null);
  const [saveRecipe, setSaveRecipe] = useState<RecipeListItem | null>(null);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [memberEmails, setMemberEmails] = useState<Map<string, string | null>>(
    new Map(),
  );
  const [folderView, setFolderView] = useState<FolderView>("grid");
  const [captureJobs, setCaptureJobs] = useState<CaptureJobRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(FOLDER_VIEW_KEY)
      .then((stored) => {
        if (!cancelled && (stored === "grid" || stored === "list")) {
          setFolderView(stored);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const changeFolderView = (view: FolderView) => {
    setFolderView(view);
    AsyncStorage.setItem(FOLDER_VIEW_KEY, view).catch(() => {});
  };
  const [activeFilters, setActiveFilters] = useState<Set<QuickFilter>>(
    new Set(),
  );
  const index = useCanonicalIndex();

  const toggleFilter = (f: QuickFilter) =>
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const load = useCallback(async () => {
    // A deletion elsewhere invalidated this list: spinner instead of stale rows.
    if (consumeInvalidation("library")) setLoaded(false);
    const weekIso = weekStart(new Date());
    const [
      { data: recipeRows },
      { data: entryRows },
      { data: hh },
      { data: weekPlan },
      { data: folderRows },
      { data: linkRows },
      { data: memberRows },
      { data: personRows },
      jobRows,
    ] = await Promise.all([
      supabase
        .from("recipes")
        .select(
          "id, title, tags, needs_review, cover_image_path, servings, prep_minutes, cook_minutes, created_at, created_by, ingredients, fodmap_override, recipe_translations(locale, title)",
        )
        .eq("household_id", householdId)
        .order("created_at", { ascending: false }),
      supabase
        .from("plan_entries")
        .select("recipe_id, meal_plans!inner(household_id, week_start)")
        .eq("meal_plans.household_id", householdId),
      supabase
        .from("households")
        .select("suggested_rest_weeks")
        .eq("id", householdId)
        .single(),
      supabase
        .from("meal_plans")
        .select("id")
        .eq("household_id", householdId)
        .eq("week_start", weekIso)
        .maybeSingle(),
      supabase
        .from("folders")
        .select("id, household_id, owner_id, name, created_at")
        .eq("household_id", householdId),
      supabase.from("folder_recipes").select("folder_id, recipe_id, added_at"),
      supabase
        .from("household_members")
        .select("user_id, email, person_id")
        .eq("household_id", householdId),
      supabase
        .from("persons")
        .select("id, name")
        .eq("household_id", householdId),
      loadActiveCaptureJobs(householdId),
    ]);
    setCaptureJobs(jobRows);
    // Heal lost pings (app closed too fast / worker was down); the worker
    // claims jobs atomically so duplicates are harmless.
    retriggerStaleJobs(jobRows);
    if (recipeRows) {
      // Localize titles once at the fetch boundary, then drop the embed so
      // downstream state keeps the plain RecipeListItem shape.
      setHouseholdRecipes(
        (
          recipeRows as (RecipeListItem & {
            recipe_translations?: { locale: string; title: string }[] | null;
          })[]
        ).map(({ recipe_translations, ...r }) => ({
          ...r,
          title: localizedTitle({ title: r.title, recipe_translations }, locale),
        })),
      );
    }
    setFolders(
      summarizeFolders(
        (folderRows as FolderRow[]) ?? [],
        (linkRows as FolderLink[]) ?? [],
      ),
    );
    const members = (memberRows ?? []) as {
      user_id: string;
      email: string | null;
      person_id: string | null;
    }[];
    setMemberEmails(new Map(members.map((m) => [m.user_id, m.email])));
    setUploaderOptions(
      buildUploaderOptions(
        members,
        ((personRows ?? []) as { id: string; name: string }[]),
        d.library.familyMember,
      ),
    );
    if (entryRows) {
      // Suggestion cool-down: only picks within the household's rest window
      // hide a recipe from "Suggested for you" (settings → meal preferences).
      const restWeeks = hh?.suggested_rest_weeks ?? 3;
      const cutoff = addWeeks(weekIso, -restWeeks);
      setPlannedRecentIds(
        new Set(
          (
            // supabase-js types the to-one join as an array; runtime is an object.
            entryRows as unknown as {
              recipe_id: string | null;
              meal_plans: { week_start: string };
            }[]
          )
            .filter((e) => e.meal_plans.week_start >= cutoff)
            .map((e) => e.recipe_id)
            .filter((id): id is string => id !== null),
        ),
      );
    }
    if (weekPlan) {
      const { data: weekRows } = await supabase
        .from("plan_entries")
        .select("id, recipe_id, custom_title")
        .eq("meal_plan_id", weekPlan.id);
      setWeekEntries(
        (weekRows as {
          id: string;
          recipe_id: string | null;
          custom_title: string | null;
        }[]) ?? [],
      );
    } else {
      setWeekEntries([]);
    }
    setLoaded(true);
  }, [householdId, locale, d.library.familyMember]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // While a background import runs, poll so its card resolves into the
  // finished recipe without a manual refresh.
  useEffect(() => {
    const active = captureJobs.some(
      (j) => j.status === "pending" || j.status === "processing",
    );
    if (!active) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [captureJobs, load]);

  // Recipes not planned within the rest window, newest first, max 6; hero = first.
  const suggestions = useMemo(
    () => recipes.filter((r) => !plannedRecentIds.has(r.id)).slice(0, 6),
    [recipes, plannedRecentIds],
  );
  const hero = suggestions[0];
  const carousel = suggestions.slice(1);

  /** Recipes from the last two weeks, newest first, max 10 (hides as it ages). */
  const recentlyAdded = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return recipes
      .filter((r) => r.created_at && new Date(r.created_at).getTime() >= cutoff)
      .slice(0, 10);
  }, [recipes]);

  /** Browse-everything entry point; Search stays the actual full list. */
  const allRecipes = useMemo(() => recipes.slice(0, 10), [recipes]);

  /** Chip inputs per recipe — pure local matching only (no LLM/cache). */
  const filterInputs = useMemo(() => {
    const map = new Map<
      string,
      { category: ProteinCategory | null; fodmapFriendly: boolean | null }
    >();
    for (const r of recipes) {
      const category = resolveProteinCategory(r.tags, r.ingredients, index);
      let fodmapFriendly: boolean | null = null;
      if (index && r.ingredients && r.ingredients.length > 0) {
        const result = computeRecipeFodmap(
          r.ingredients.map((ing) => ({
            raw: ing.raw || ing.name,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
          })),
          r.servings,
          (line) =>
            matchCanonical(normalizeRaw(line.raw), index)?.ingredient ?? null,
        );
        fodmapFriendly = !result.flags.some((f) => f.tier === "high");
      }
      map.set(r.id, { category, fodmapFriendly });
    }
    return map;
  }, [recipes, index]);

  const filteredRecipes = useMemo(() => {
    if (activeFilters.size === 0) return recipes;
    return recipes.filter((r) => {
      const input = filterInputs.get(r.id);
      return matchesQuickFilters(
        {
          prep_minutes: r.prep_minutes,
          cook_minutes: r.cook_minutes,
          needs_review: r.needs_review,
          category: input?.category ?? null,
          fodmapFriendly: input?.fodmapFriendly ?? null,
        },
        activeFilters,
      );
    });
  }, [recipes, activeFilters, filterInputs]);

  // Recipe entries dedupe by recipe; custom meals appear once per entry.
  const thisWeek = useMemo<WeekStripItem[]>(() => {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const items: WeekStripItem[] = [];
    const seen = new Set<string>();
    for (const entry of weekEntries) {
      if (entry.recipe_id) {
        if (seen.has(entry.recipe_id)) continue;
        seen.add(entry.recipe_id);
        const recipe = byId.get(entry.recipe_id);
        if (recipe) {
          items.push({
            key: `r-${recipe.id}`,
            title: recipe.title,
            path: recipe.cover_image_path,
            recipeId: recipe.id,
          });
        }
      } else if (entry.custom_title) {
        items.push({
          key: `c-${entry.id}`,
          title: entry.custom_title,
          path: null,
          recipeId: null,
        });
      }
    }
    return items;
  }, [recipes, weekEntries]);
  const thisWeekSet = useMemo(
    () =>
      new Set(
        weekEntries
          .map((e) => e.recipe_id)
          .filter((id): id is string => id !== null),
      ),
    [weekEntries],
  );

  const openRecipe = (id: string) => router.push(`/recipe/${id}`);

  const savedSet = useMemo(
    () => savedRecipeIds(folders, userId),
    [folders, userId],
  );
  const { mine: myFolders, others: otherFolders } = useMemo(
    () => groupByOwner(folders, userId),
    [folders, userId],
  );
  const coverByRecipe = useMemo(
    () => new Map(recipes.map((r) => [r.id, r.cover_image_path ?? null])),
    [recipes],
  );

  const renameFolderPrompt = (folder: FolderSummary) => {
    // Alert.prompt is iOS-only; elsewhere rename lives on the folder page.
    Alert.prompt(
      d.library.renameFolder,
      undefined,
      (name) => {
        const trimmed = name?.trim();
        if (!trimmed) return;
        void supabase
          .from("folders")
          .update({ name: trimmed })
          .eq("id", folder.id)
          .then(() => void load());
      },
      "plain-text",
      folder.name,
    );
  };

  const deleteFolderConfirm = (folder: FolderSummary) => {
    confirmDestructive({
      title: d.library.deleteFolderTitle,
      message: fmt(d.library.deleteFolderBody, { name: folder.name }),
      confirmLabel: d.common.delete,
      cancelLabel: d.common.cancel,
      onConfirm: () => {
        void supabase
          .from("folders")
          .delete()
          .eq("id", folder.id)
          .then(() => void load());
      },
    });
  };

  /** ⋯ on a folder I own: quick actions without opening the folder. */
  const folderMenu = (folder: FolderSummary) => {
    Alert.alert(folder.name, undefined, [
      { text: d.library.open, onPress: () => router.push(`/folder/${folder.id}`) },
      ...(Platform.OS === "ios"
        ? [{ text: d.library.rename, onPress: () => renameFolderPrompt(folder) }]
        : []),
      {
        text: d.common.delete,
        style: "destructive" as const,
        onPress: () => deleteFolderConfirm(folder),
      },
      { text: d.common.cancel, style: "cancel" as const },
    ]);
  };

  const createFolderPrompt = () => {
    // Alert.prompt is iOS-only; elsewhere folders are created from the save sheet.
    if (Platform.OS === "ios") {
      Alert.prompt(d.library.newFolder, undefined, (name) => {
        const trimmed = name?.trim();
        if (!trimmed) return;
        void supabase
          .from("folders")
          .insert({
            household_id: householdId,
            owner_id: userId,
            name: trimmed,
          })
          .then(() => void load());
      });
    } else {
      notify(d.library.newFolder, d.library.newFolderHint);
    }
  };

  /** Calendar tap: plan it, or confirm-remove when already in this week (v3). */
  const onPlan = (recipe: { id: string; title: string }) => {
    if (thisWeekSet.has(recipe.id)) {
      confirmRemoveFromWeek(recipe.title, () => {
        void removeRecipeFromCurrentWeek(householdId, recipe.id).then(load);
      });
    } else {
      const full = recipes.find((r) => r.id === recipe.id);
      if (full) setSheetRecipe(full);
    }
  };

  const carouselStyle = {
    marginHorizontal: -screenPadding,
  } as const;
  const carouselContent = {
    gap: 14,
    paddingHorizontal: screenPadding,
  } as const;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={["top"]}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: screenPadding,
          paddingBottom: insets.bottom + tabBarClearance,
        }}
      >
        {/* Brand lockup + capture icon — discovery only, no search here (v3) */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 8,
          }}
        >
          <Image
            source={require("../../../../assets/images/brand-icon-source.png")}
            // ~wordmark cap height (Bitter 700/30); nudged for optical balance.
            style={{ width: 40, height: 40, marginTop: -2 }}
            accessibilityIgnoresInvertColors
          />
          <Text
            accessibilityRole="header"
            style={{
              flex: 1,
              color: colors.text,
              fontSize: fontSize.wordmark,
              letterSpacing: -0.3,
              fontFamily: fonts.display,
            }}
          >
            Mealy
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={d.library.addRecipeA11y}
            onPress={() => router.push("/capture")}
            style={({ pressed }) => ({
              width: minTapTarget,
              height: minTapTarget,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: minTapTarget / 2,
              backgroundColor: pressed ? colors.cardPressed : "transparent",
            })}
          >
            <Ionicons name="add" size={28} color={colors.text} />
          </Pressable>
          {/* v3.1b: Settings left the tab bar — NYT top-right gear, icon only */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={d.library.settingsA11y}
            onPress={() => router.push("/settings")}
            style={({ pressed }) => ({
              width: minTapTarget,
              height: minTapTarget,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: minTapTarget / 2,
              backgroundColor: pressed ? colors.cardPressed : "transparent",
            })}
          >
            <Ionicons name="settings-outline" size={24} color={colors.text} />
          </Pressable>
        </View>

        <QuickFilters
          active={activeFilters}
          onToggle={toggleFilter}
          leading={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={d.library.addedByTitle}
              onPress={() => setUploaderSheetOpen(true)}
              style={({ pressed }) => ({
                minHeight: 36,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                borderRadius: 999,
                paddingHorizontal: 14,
                borderWidth: uploaderFilter ? 0 : 1,
                borderColor: colors.border,
                backgroundColor: uploaderFilter
                  ? colors.accent
                  : pressed
                    ? colors.cardPressed
                    : "transparent",
              })}
            >
              <Ionicons
                name="person-outline"
                size={13}
                color={uploaderFilter ? colors.accentText : colors.text}
              />
              <Text
                style={{
                  color: uploaderFilter ? colors.accentText : colors.text,
                  fontSize: fontSize.meta,
                  fontFamily: fonts.uiMedium,
                }}
              >
                {uploaderOptions.find((o) => o.id === uploaderFilter)?.name ??
                  d.library.addedByEveryone}
              </Text>
              <Ionicons
                name="chevron-down"
                size={12}
                color={uploaderFilter ? colors.accentText : colors.text}
              />
            </Pressable>
          }
        />

        <View style={{ marginBottom: 20 }} />

        {/* Background imports (capture_jobs): running + failed, newest first. */}
        {captureJobs.length > 0 ? (
          <View style={{ gap: 10, marginBottom: 20 }}>
            {captureJobs.map((job) => (
              <CaptureJobCard key={job.id} job={job} onChanged={() => void load()} />
            ))}
          </View>
        ) : null}

        {!loaded ? (
          <Loading />
        ) : recipes.length === 0 ? (
          householdRecipes.length > 0 ? (
            <EmptyState
              message={d.library.noFilterMatches}
              actionLabel={d.library.clearFilters}
              onAction={() => {
                setActiveFilters(new Set());
                setUploaderFilter(null);
              }}
            />
          ) : (
            <EmptyState
              message={d.library.emptyLibrary}
              actionLabel={d.library.addFirstRecipe}
              onAction={() => router.push("/capture")}
            />
          )
        ) : activeFilters.size > 0 ? (
          <View style={{ paddingTop: 8 }}>
            {filteredRecipes.map((recipe, i) => (
              <View key={recipe.id}>
                {i > 0 ? <Hairline /> : null}
                <RecipeRow
                  recipe={recipe}
                  onPress={() => openRecipe(recipe.id)}
                />
              </View>
            ))}
            {filteredRecipes.length === 0 ? (
              <EmptyState
                message={d.library.noFilterMatches}
                actionLabel={d.library.clearFilters}
                onAction={() => setActiveFilters(new Set())}
              />
            ) : null}
          </View>
        ) : (
          <View>
            {hero ? (
              <Hero
                recipe={hero}
                planned={thisWeekSet.has(hero.id)}
                saved={savedSet.has(hero.id)}
                onPress={() => openRecipe(hero.id)}
                onPlan={() => onPlan(hero)}
                onSave={() => setSaveRecipe(hero)}
              />
            ) : null}

            {carousel.length > 0 ? (
              <View style={{ paddingTop: 16, gap: 12 }}>
                <SectionHeader title={d.library.suggestedForYou} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={carouselContent}
                  style={carouselStyle}
                >
                  {carousel.map((recipe) => (
                    <CarouselCard
                      key={recipe.id}
                      recipe={recipe}
                      planned={thisWeekSet.has(recipe.id)}
                      saved={savedSet.has(recipe.id)}
                      onPress={() => openRecipe(recipe.id)}
                      onPlan={() => onPlan(recipe)}
                      onSave={() => setSaveRecipe(recipe)}
                    />
                  ))}
                </ScrollView>
                <Hairline />
              </View>
            ) : null}

            {thisWeek.length > 0 ? (
              <View style={{ paddingTop: 16, gap: 12 }}>
                <SectionHeader
                  title={d.library.thisWeek}
                  linkLabel={d.library.seeAll}
                  onLinkPress={() => router.navigate("/plan")}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={carouselContent}
                  style={carouselStyle}
                >
                  {thisWeek.map((item) => (
                    <ThisWeekCard
                      key={item.key}
                      item={item}
                      // v3.2: recipe entries open the sheet; custom meals open the week.
                      onPress={() =>
                        item.recipeId
                          ? openRecipe(item.recipeId)
                          : router.navigate("/plan")
                      }
                      onBookmark={
                        item.recipeId
                          ? () =>
                              onPlan({
                                id: item.recipeId!,
                                title: item.title,
                              })
                          : undefined
                      }
                    />
                  ))}
                </ScrollView>
                <Hairline />
              </View>
            ) : null}

            {recentlyAdded.length > 0 ? (
              <View style={{ paddingTop: 16, gap: 12 }}>
                <SectionHeader title={d.library.recentlyAdded} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={carouselContent}
                  style={carouselStyle}
                >
                  {recentlyAdded.map((recipe) => (
                    <CarouselCard
                      key={recipe.id}
                      recipe={recipe}
                      planned={thisWeekSet.has(recipe.id)}
                      saved={savedSet.has(recipe.id)}
                      onPress={() => openRecipe(recipe.id)}
                      onPlan={() => onPlan(recipe)}
                      onSave={() => setSaveRecipe(recipe)}
                    />
                  ))}
                </ScrollView>
                <Hairline />
              </View>
            ) : null}

            {/* Browse-everything entry point; Search stays the full list. */}
            {allRecipes.length > 0 ? (
              <View style={{ paddingTop: 16, gap: 12 }}>
                <SectionHeader
                  title={d.library.allRecipes}
                  linkLabel={d.library.seeAll}
                  onLinkPress={() => router.navigate("/search")}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={carouselContent}
                  style={carouselStyle}
                >
                  {allRecipes.map((recipe) => (
                    <CarouselCard
                      key={recipe.id}
                      recipe={recipe}
                      planned={thisWeekSet.has(recipe.id)}
                      saved={savedSet.has(recipe.id)}
                      onPress={() => openRecipe(recipe.id)}
                      onPlan={() => onPlan(recipe)}
                      onSave={() => setSaveRecipe(recipe)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* Recipe Box (spec 2026-08-24): my folders, then the family's. */}
            <View style={{ paddingTop: 24, gap: 12 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <View style={{ flex: 1 }}>
                  <SectionHeader
                    title={d.library.yourFolders}
                    linkLabel={d.library.newFolderLink}
                    onLinkPress={createFolderPrompt}
                    style={{ marginRight: 5 }}
                  />
                </View>
                {(
                  [
                    ["grid", "grid"],
                    ["list", "list"],
                  ] as [FolderView, keyof typeof Ionicons.glyphMap][]
                ).map(([view, icon]) => {
                  const selected = folderView === view;
                  return (
                    <Pressable
                      key={view}
                      accessibilityRole="button"
                      accessibilityLabel={
                        view === "grid"
                          ? d.library.gridViewA11y
                          : d.library.listViewA11y
                      }
                      accessibilityState={{ selected }}
                      onPress={() => changeFolderView(view)}
                      hitSlop={4}
                      style={({ pressed }) => ({
                        width: 36,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 8,
                        backgroundColor:
                          pressed || selected
                            ? colors.cardPressed
                            : "transparent",
                      })}
                    >
                      <Ionicons
                        name={icon}
                        size={18}
                        color={selected ? colors.text : colors.textMuted}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <FolderCollection
                folders={myFolders}
                view={folderView}
                coverByRecipe={coverByRecipe}
                onOpen={(id) => router.push(`/folder/${id}`)}
                onMenu={folderMenu}
              />
              {myFolders.length === 0 ? (
                <Muted>{d.library.foldersEmptyHint}</Muted>
              ) : null}
              {otherFolders.map((group) => (
                <View key={group.ownerId} style={{ gap: 12, paddingTop: 8 }}>
                  <Eyebrow>
                    {memberEmails.get(group.ownerId) ?? d.library.familyMember}
                  </Eyebrow>
                  <FolderCollection
                    folders={group.folders}
                    view={folderView}
                    coverByRecipe={coverByRecipe}
                    onOpen={(id) => router.push(`/folder/${id}`)}
                  />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {sheetRecipe ? (
        <AddToWeekSheet
          visible
          recipeId={sheetRecipe.id}
          recipeTitle={sheetRecipe.title}
          onClose={() => setSheetRecipe(null)}
          onAdded={() => void load()}
        />
      ) : null}

        <Modal
          visible={uploaderSheetOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setUploaderSheetOpen(false)}
        >
          <Pressable
            onPress={() => setUploaderSheetOpen(false)}
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.5)",
              justifyContent: "flex-end",
            }}
          >
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: colors.card,
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                padding: screenPadding,
                paddingBottom: screenPadding + 12,
                gap: 4,
              }}
            >
              <Eyebrow style={{ marginBottom: 8 }}>{d.library.addedByTitle}</Eyebrow>
              {[{ id: null as string | null, name: d.library.addedByEveryone }, ...uploaderOptions].map(
                (option) => {
                  const selected = uploaderFilter === option.id;
                  return (
                    <Pressable
                      key={option.id ?? "everyone"}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        setUploaderFilter(option.id);
                        setUploaderSheetOpen(false);
                      }}
                      style={({ pressed }) => ({
                        minHeight: 44,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderRadius: 10,
                        paddingHorizontal: 10,
                        backgroundColor: pressed ? colors.cardPressed : "transparent",
                      })}
                    >
                      <Text
                        style={{
                          color: colors.text,
                          fontSize: fontSize.base,
                          fontFamily: selected ? fonts.uiSemi : fonts.uiMedium,
                        }}
                      >
                        {option.name}
                      </Text>
                      {selected ? (
                        <Ionicons name="checkmark" size={18} color={colors.accent} />
                      ) : null}
                    </Pressable>
                  );
                },
              )}
            </Pressable>
          </Pressable>
        </Modal>

      {saveRecipe ? (
        <SaveSheet
          visible
          recipeId={saveRecipe.id}
          recipeTitle={saveRecipe.title}
          householdId={householdId}
          userId={userId}
          onClose={() => setSaveRecipe(null)}
          onAddToWeek={() => {
            const r = saveRecipe;
            setSaveRecipe(null);
            if (r) setSheetRecipe(r);
          }}
          onChanged={() => void load()}
        />
      ) : null}
    </SafeAreaView>
  );
}

/** Background import status card: spinner while running, retry/dismiss on failure. */
function CaptureJobCard({
  job,
  onChanged,
}: {
  job: CaptureJobRow;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const failed = job.status === "failed";
  const detail =
    job.error === JOB_ERROR_NO_RECIPE || !job.error
      ? d.library.importNoRecipe
      : job.error;
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.card,
        padding: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {failed ? (
          <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
        ) : (
          <ActivityIndicator size="small" color={colors.textMuted} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              color: failed ? colors.danger : colors.text,
              fontSize: fontSize.base,
              fontFamily: fonts.uiSemi,
            }}
          >
            {failed ? d.library.importFailed : d.library.importingRecipe}
          </Text>
          <Muted numberOfLines={1}>{job.input}</Muted>
        </View>
      </View>
      {failed ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
          <Muted style={{ flex: 1 }} numberOfLines={2}>
            {detail}
          </Muted>
          {(
            [
              [
                d.library.importRetry,
                () => void retryCaptureJob(job.id).then(onChanged),
              ],
              [
                d.library.importDismiss,
                () => void dismissCaptureJob(job.id).then(onChanged),
              ],
            ] as const
          ).map(([label, onPress]) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              onPress={onPress}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                style={{
                  color: colors.text,
                  fontSize: fontSize.base,
                  fontFamily: fonts.uiSemi,
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Grid/list renderer for a set of folders (NYT Recipe Box views). */
function FolderCollection({
  folders,
  view,
  coverByRecipe,
  onOpen,
  onMenu,
}: {
  folders: FolderSummary[];
  view: FolderView;
  coverByRecipe: Map<string, string | null>;
  onOpen: (id: string) => void;
  /** Present only for folders the viewer owns (⋯ quick actions). */
  onMenu?: (folder: FolderSummary) => void;
}) {
  if (view === "list") {
    return (
      <View style={{ gap: 8 }}>
        {folders.map((f) => (
          <FolderRowItem
            key={f.id}
            folder={f}
            cover={collageCovers(f, coverByRecipe)[0]}
            onPress={() => onOpen(f.id)}
            onMenu={onMenu ? () => onMenu(f) : undefined}
          />
        ))}
      </View>
    );
  }
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        rowGap: 24,
      }}
    >
      {folders.map((f) => (
        <FolderGridItem
          key={f.id}
          folder={f}
          covers={collageCovers(f, coverByRecipe)}
          onPress={() => onOpen(f.id)}
          onMenu={onMenu ? () => onMenu(f) : undefined}
        />
      ))}
    </View>
  );
}

/** ⋯ quick-actions button shared by both folder views. */
function FolderMenuButton({
  name,
  onPress,
}: {
  name: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fmt(d.library.folderOptionsA11y, { name })}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
    >
      <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

/** NYT Recipe Box grid tile: gapped 2×2 collage, name + ⋯ row, count. */
function FolderGridItem({
  folder,
  covers,
  onPress,
  onMenu,
}: {
  folder: FolderSummary;
  covers: (string | null)[];
  onPress: () => void;
  onMenu?: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fmt(d.library.openFolderA11y, { name: folder.name })}
      onPress={onPress}
      style={({ pressed }) => ({
        width: "47.5%",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignContent: "space-between",
          aspectRatio: 1,
          borderRadius: radius.card,
          overflow: "hidden",
        }}
      >
        {covers.map((path, i) => (
          <RecipeImage
            key={i}
            path={path}
            style={{ width: "48.5%", height: "48.5%" }}
            iconSize={20}
          />
        ))}
      </View>
      <View style={{ paddingTop: 8, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: colors.text,
              fontSize: fontSize.cardTitle,
              fontFamily: fonts.displaySemi,
            }}
          >
            {folder.name}
          </Text>
          {onMenu ? (
            <FolderMenuButton name={folder.name} onPress={onMenu} />
          ) : null}
        </View>
        <Muted>
          {fmt(
            folder.recipeIds.length === 1
              ? d.library.recipeCountOne
              : d.library.recipeCountMany,
            { count: folder.recipeIds.length },
          )}
        </Muted>
      </View>
    </Pressable>
  );
}

/** NYT Recipe Box list row: single cover thumbnail, name, count, ⋯. */
function FolderRowItem({
  folder,
  cover,
  onPress,
  onMenu,
}: {
  folder: FolderSummary;
  cover: string | null;
  onPress: () => void;
  onMenu?: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fmt(d.library.openFolderA11y, { name: folder.name })}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 6,
        backgroundColor: pressed ? colors.cardPressed : "transparent",
      })}
    >
      <RecipeImage
        path={cover}
        style={{ width: 64, height: 64, borderRadius: 8 }}
        iconSize={20}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{
            color: colors.text,
            fontSize: fontSize.cardTitle,
            fontFamily: fonts.displaySemi,
          }}
        >
          {folder.name}
        </Text>
        <Muted>
          {fmt(
            folder.recipeIds.length === 1
              ? d.library.recipeCountOne
              : d.library.recipeCountMany,
            { count: folder.recipeIds.length },
          )}
        </Muted>
      </View>
      {onMenu ? <FolderMenuButton name={folder.name} onPress={onMenu} /> : null}
    </Pressable>
  );
}
