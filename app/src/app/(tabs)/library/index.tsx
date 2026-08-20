import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AddToWeekSheet,
  confirmRemoveFromWeek,
  removeRecipeFromCurrentWeek,
} from '@/components/add-to-week';
import {
  CarouselCard,
  Hero,
  ThisWeekCard,
  type RecipeListItem,
  type WeekStripItem,
} from '@/components/recipe-cards';
import { EmptyState, Hairline, SectionHeader } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { weekStart } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

export default function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();

  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [plannedEverIds, setPlannedEverIds] = useState<Set<string>>(new Set());
  const [weekEntries, setWeekEntries] = useState<
    { id: string; recipe_id: string | null; custom_title: string | null }[]
  >([]);
  const [sheetRecipe, setSheetRecipe] = useState<RecipeListItem | null>(null);

  const load = useCallback(async () => {
    const weekIso = weekStart(new Date());
    const [{ data: recipeRows }, { data: entryRows }, { data: weekPlan }] = await Promise.all([
      supabase
        .from('recipes')
        .select('id, title, tags, needs_review, cover_image_path, servings, prep_minutes, cook_minutes')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false }),
      supabase
        .from('plan_entries')
        .select('recipe_id, meal_plans!inner(household_id)')
        .eq('meal_plans.household_id', householdId),
      supabase
        .from('meal_plans')
        .select('id')
        .eq('household_id', householdId)
        .eq('week_start', weekIso)
        .maybeSingle(),
    ]);
    if (recipeRows) setRecipes(recipeRows as RecipeListItem[]);
    if (entryRows) {
      setPlannedEverIds(
        new Set(
          (entryRows as { recipe_id: string | null }[])
            .map((e) => e.recipe_id)
            .filter((id): id is string => id !== null)
        )
      );
    }
    if (weekPlan) {
      const { data: weekRows } = await supabase
        .from('plan_entries')
        .select('id, recipe_id, custom_title')
        .eq('meal_plan_id', weekPlan.id);
      setWeekEntries(
        (weekRows as { id: string; recipe_id: string | null; custom_title: string | null }[]) ?? []
      );
    } else {
      setWeekEntries([]);
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Same rule as v1/v2: never-planned recipes, newest first, max 6; hero = first.
  const suggestions = useMemo(
    () => recipes.filter((r) => !plannedEverIds.has(r.id)).slice(0, 6),
    [recipes, plannedEverIds]
  );
  const hero = suggestions[0];
  const carousel = suggestions.slice(1);

  /** Last 10 by created_at (recipes arrive newest-first). */
  const recentlyAdded = useMemo(() => recipes.slice(0, 10), [recipes]);

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
        items.push({ key: `c-${entry.id}`, title: entry.custom_title, path: null, recipeId: null });
      }
    }
    return items;
  }, [recipes, weekEntries]);
  const thisWeekSet = useMemo(
    () =>
      new Set(weekEntries.map((e) => e.recipe_id).filter((id): id is string => id !== null)),
    [weekEntries]
  );

  const openRecipe = (id: string) => router.push(`/library/${id}`);

  /** Bookmark tap: plan it, or confirm-remove when already in this week (v3). */
  const onBookmark = (recipe: { id: string; title: string }) => {
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
  const carouselContent = { gap: 14, paddingHorizontal: screenPadding } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: 24 }}>
        {/* Wordmark + capture icon — discovery only, no search here (v3) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
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
            onPress={() => router.push('/capture')}
            style={({ pressed }) => ({
              width: minTapTarget,
              height: minTapTarget,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: minTapTarget / 2,
              backgroundColor: pressed ? colors.cardPressed : 'transparent',
            })}
          >
            <Ionicons name="add" size={28} color={colors.text} />
          </Pressable>
        </View>

        {recipes.length === 0 ? (
          <EmptyState
            message="Your cooking notebook starts here."
            actionLabel="Add your first recipe"
            onAction={() => router.push('/capture')}
          />
        ) : (
          <View>
            {hero ? (
              <Hero
                recipe={hero}
                planned={thisWeekSet.has(hero.id)}
                onPress={() => openRecipe(hero.id)}
                onBookmark={() => onBookmark(hero)}
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
                      onPress={() => openRecipe(recipe.id)}
                      onBookmark={() => onBookmark(recipe)}
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
                  onLinkPress={() => router.navigate('/plan')}
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
                      onPress={() => router.navigate('/plan')}
                      onBookmark={
                        item.recipeId
                          ? () => onBookmark({ id: item.recipeId!, title: item.title })
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
                <SectionHeader
                  title="Recently added"
                  linkLabel="See all"
                  onLinkPress={() => router.navigate('/search')}
                />
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
                      onPress={() => openRecipe(recipe.id)}
                      onBookmark={() => onBookmark(recipe)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}
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
    </SafeAreaView>
  );
}
