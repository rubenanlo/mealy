import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
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
  CarouselCard,
  Hero,
  RecipeImage,
  RecipeRow,
  ThisWeekCard,
  type RecipeListItem,
  type WeekStripItem,
} from "@/components/recipe-cards";
import { SaveSheet } from "@/components/save-sheet";
import { EmptyState, Eyebrow, Hairline, Muted, SectionHeader } from "@/components/ui";
import { useAuth, useHousehold } from "@/lib/auth";
import { matchCanonical, normalizeRaw } from "@/lib/canonical";
import type { ProteinCategory } from "@/lib/category";
import { resolveProteinCategory } from "@/lib/category";
import { computeRecipeFodmap } from "@/lib/fodmap";
import {
  collageCovers,
  groupByOwner,
  savedRecipeIds,
  summarizeFolders,
  type FolderLink,
  type FolderRow,
  type FolderSummary,
} from "@/lib/folders";
import { weekStart } from "@/lib/plan";
import { matchesQuickFilters, type QuickFilter } from "@/lib/quick-filters";
import { supabase } from "@/lib/supabase";
import {
  fonts,
  fontSize,
  minTapTarget,
  screenPadding,
  tabBarClearance,
  useTheme,
} from "@/lib/theme";
import { useCanonicalIndex } from "@/lib/use-canonical";

export default function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { householdId } = useHousehold();
  const { session } = useAuth();
  const userId = session?.user.id ?? "";

  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [plannedEverIds, setPlannedEverIds] = useState<Set<string>>(new Set());
  const [weekEntries, setWeekEntries] = useState<
    { id: string; recipe_id: string | null; custom_title: string | null }[]
  >([]);
  const [sheetRecipe, setSheetRecipe] = useState<RecipeListItem | null>(null);
  const [saveRecipe, setSaveRecipe] = useState<RecipeListItem | null>(null);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [memberEmails, setMemberEmails] = useState<Map<string, string>>(
    new Map(),
  );
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
    const weekIso = weekStart(new Date());
    const [
      { data: recipeRows },
      { data: entryRows },
      { data: weekPlan },
      { data: folderRows },
      { data: linkRows },
      { data: memberRows },
    ] = await Promise.all([
        supabase
          .from("recipes")
          .select(
            "id, title, tags, needs_review, cover_image_path, servings, prep_minutes, cook_minutes, created_at, ingredients",
          )
          .eq("household_id", householdId)
          .order("created_at", { ascending: false }),
        supabase
          .from("plan_entries")
          .select("recipe_id, meal_plans!inner(household_id)")
          .eq("meal_plans.household_id", householdId),
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
          .select("user_id, email")
          .eq("household_id", householdId),
      ]);
    if (recipeRows) setRecipes(recipeRows as RecipeListItem[]);
    setFolders(
      summarizeFolders(
        (folderRows as FolderRow[]) ?? [],
        (linkRows as FolderLink[]) ?? [],
      ),
    );
    setMemberEmails(
      new Map(
        ((memberRows ?? []) as { user_id: string; email: string | null }[]).map(
          (m) => [m.user_id, m.email ?? "Family member"],
        ),
      ),
    );
    if (entryRows) {
      setPlannedEverIds(
        new Set(
          (entryRows as { recipe_id: string | null }[])
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
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Same rule as v1/v2: never-planned recipes, newest first, max 6; hero = first.
  const suggestions = useMemo(
    () => recipes.filter((r) => !plannedEverIds.has(r.id)).slice(0, 6),
    [recipes, plannedEverIds],
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

  const createFolderPrompt = () => {
    // Alert.prompt is iOS-only; elsewhere folders are created from the save sheet.
    if (Platform.OS === "ios") {
      Alert.prompt("New folder", undefined, (name) => {
        const trimmed = name?.trim();
        if (!trimmed) return;
        void supabase
          .from("folders")
          .insert({ household_id: householdId, owner_id: userId, name: trimmed })
          .then(() => void load());
      });
    } else {
      Alert.alert("New folder", "Create folders from any recipe's bookmark.");
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
            accessibilityLabel="Add a recipe"
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
            accessibilityLabel="Settings"
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

        <QuickFilters active={activeFilters} onToggle={toggleFilter} />

        <View style={{ marginBottom: 20 }} />

        {recipes.length === 0 ? (
          <EmptyState
            message="Your cooking notebook starts here."
            actionLabel="Add your first recipe"
            onAction={() => router.push("/capture")}
          />
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
                message="No recipes match these filters."
                actionLabel="Clear filters"
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
                <SectionHeader title="Suggested for you" />
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
                  title="This week"
                  linkLabel="See all"
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
                <SectionHeader title="Recently added" />
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
                  title="All recipes"
                  linkLabel="See all"
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
              <SectionHeader
                title="Your folders"
                linkLabel="+ New"
                onLinkPress={createFolderPrompt}
              />
              {myFolders.map((f) => (
                <FolderRowItem
                  key={f.id}
                  folder={f}
                  covers={collageCovers(f, coverByRecipe)}
                  onPress={() => router.push(`/folder/${f.id}`)}
                />
              ))}
              {myFolders.length === 0 ? (
                <Muted>Save any recipe with the bookmark to start a folder.</Muted>
              ) : null}
              {otherFolders.map((group) => (
                <View key={group.ownerId} style={{ gap: 12, paddingTop: 8 }}>
                  <Eyebrow>{memberEmails.get(group.ownerId) ?? "Family member"}</Eyebrow>
                  {group.folders.map((f) => (
                    <FolderRowItem
                      key={f.id}
                      folder={f}
                      covers={collageCovers(f, coverByRecipe)}
                      onPress={() => router.push(`/folder/${f.id}`)}
                    />
                  ))}
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

/** NYT Recipe Box row: 2×2 cover collage, name, count, chevron. */
function FolderRowItem({
  folder,
  covers,
  onPress,
}: {
  folder: FolderSummary;
  covers: (string | null)[];
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const tile = 35; // 2×2 grid + 2px gaps ≈ 72px square
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open folder ${folder.name}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 6,
        backgroundColor: pressed ? colors.cardPressed : "transparent",
      })}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          width: tile * 2 + 2,
          gap: 2,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {covers.map((path, i) => (
          <RecipeImage
            key={i}
            path={path}
            style={{ width: tile, height: tile }}
            iconSize={14}
          />
        ))}
      </View>
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
          {folder.recipeIds.length}{" "}
          {folder.recipeIds.length === 1 ? "recipe" : "recipes"}
        </Muted>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}
