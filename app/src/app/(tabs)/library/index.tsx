import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddToWeekSheet } from '@/components/add-to-week';
import {
  Bookmark,
  CategoryDot,
  EmptyState,
  Field,
  Hairline,
  Muted,
  SectionHeader,
} from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { CATEGORY_LABELS, deriveCategory } from '@/lib/category';
import { useImageUrl } from '@/lib/media';
import { SEARCH_EXPAND_MS, useReducedMotion } from '@/lib/motion';
import { weekStart } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';

interface RecipeListItem {
  id: string;
  title: string;
  tags: string[];
  needs_review: boolean;
  cover_image_path: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
}

function totalMinutes(recipe: RecipeListItem): number | null {
  const total = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0);
  return total > 0 ? total : null;
}

/** "35 min · Fish · 4 servings" meta line with the category dot inline. */
function MetaLine({
  recipe,
  showServings = false,
  showBadge = false,
}: {
  recipe: RecipeListItem;
  showServings?: boolean;
  showBadge?: boolean;
}) {
  const { colors } = useTheme();
  const category = deriveCategory(recipe.tags);
  const minutes = totalMinutes(recipe);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {minutes ? <Muted>{minutes} min</Muted> : null}
      {minutes && category ? <Muted>·</Muted> : null}
      {category ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <CategoryDot category={category} />
          <Muted>{CATEGORY_LABELS[category]}</Muted>
        </View>
      ) : null}
      {showServings && recipe.servings ? (
        <>
          {minutes || category ? <Muted>·</Muted> : null}
          <Muted>{recipe.servings} servings</Muted>
        </>
      ) : null}
      {showBadge && recipe.needs_review ? (
        <Text style={{ color: colors.saffron, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>
          needs review
        </Text>
      ) : null}
    </View>
  );
}

function RecipeImage({
  path,
  style,
  iconSize = 28,
}: {
  path: string | null;
  style: object;
  iconSize?: number;
}) {
  const { colors } = useTheme();
  const url = useImageUrl(path);
  return (
    <View
      style={[
        { backgroundColor: colors.cardPressed, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
        style,
      ]}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      ) : (
        <Ionicons name="restaurant-outline" size={iconSize} color={colors.textMuted} />
      )}
    </View>
  );
}

function Hero({
  recipe,
  planned,
  onPress,
  onBookmark,
}: {
  recipe: RecipeListItem;
  planned: boolean;
  onPress: () => void;
  onBookmark: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open recipe ${recipe.title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        marginHorizontal: -screenPadding,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <View>
        <RecipeImage path={recipe.cover_image_path} style={{ width: '100%', aspectRatio: 4 / 3 }} iconSize={48} />
        <View
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bookmark saved={planned} onPress={onBookmark} />
        </View>
      </View>
      <View style={{ paddingHorizontal: screenPadding, paddingTop: 12, paddingBottom: 16, gap: 6 }}>
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
        <MetaLine recipe={recipe} showServings />
      </View>
      <Hairline style={{ marginHorizontal: screenPadding }} />
    </Pressable>
  );
}

function SuggestionCard({
  recipe,
  planned,
  onPress,
  onBookmark,
}: {
  recipe: RecipeListItem;
  planned: boolean;
  onPress: () => void;
  onBookmark: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open recipe ${recipe.title}`}
      onPress={onPress}
      style={({ pressed }) => ({ width: 150, opacity: pressed ? 0.7 : 1 })}
    >
      <View>
        <RecipeImage
          path={recipe.cover_image_path}
          style={{ width: 150, height: 110, borderRadius: radius.card }}
        />
        <View
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bookmark saved={planned} onPress={onBookmark} size={17} />
        </View>
      </View>
      <View style={{ paddingTop: 8, gap: 4 }}>
        <Text
          numberOfLines={2}
          style={{
            color: colors.text,
            fontSize: fontSize.cardTitle,
            lineHeight: 21,
            fontFamily: fonts.displaySemi,
          }}
        >
          {recipe.title}
        </Text>
        <MetaLine recipe={recipe} />
      </View>
    </Pressable>
  );
}

function ThisWeekCard({ recipe, onPress }: { recipe: RecipeListItem; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open the week — ${recipe.title}`}
      onPress={onPress}
      style={({ pressed }) => ({ width: 110, opacity: pressed ? 0.7 : 1 })}
    >
      <RecipeImage
        path={recipe.cover_image_path}
        style={{ width: 110, height: 82, borderRadius: radius.card }}
        iconSize={22}
      />
      <Text
        numberOfLines={2}
        style={{
          color: colors.text,
          fontSize: fontSize.small,
          lineHeight: 19,
          fontFamily: fonts.uiMedium,
          paddingTop: 6,
        }}
      >
        {recipe.title}
      </Text>
    </Pressable>
  );
}

function RecipeRow({ recipe, onPress }: { recipe: RecipeListItem; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open recipe ${recipe.title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 12,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <RecipeImage
        path={recipe.cover_image_path}
        style={{ width: 96, height: 72, borderRadius: radius.thumb }}
        iconSize={24}
      />
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          numberOfLines={2}
          style={{
            color: colors.text,
            fontSize: fontSize.cardTitle,
            lineHeight: 21,
            fontFamily: fonts.displaySemi,
          }}
        >
          {recipe.title}
        </Text>
        <MetaLine recipe={recipe} showBadge />
      </View>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();
  const reduced = useReducedMotion();

  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [plannedEverIds, setPlannedEverIds] = useState<Set<string>>(new Set());
  const [thisWeekIds, setThisWeekIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchProgress = useRef(new Animated.Value(0)).current;
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
      setPlannedEverIds(new Set((entryRows as { recipe_id: string }[]).map((e) => e.recipe_id)));
    }
    if (weekPlan) {
      const { data: weekEntries } = await supabase
        .from('plan_entries')
        .select('recipe_id')
        .eq('meal_plan_id', weekPlan.id);
      setThisWeekIds([
        ...new Set(((weekEntries as { recipe_id: string }[]) ?? []).map((e) => e.recipe_id)),
      ]);
    } else {
      setThisWeekIds([]);
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const toggleSearch = () => {
    const open = !searchOpen;
    setSearchOpen(open);
    if (!open) setSearch('');
    if (reduced) {
      searchProgress.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(searchProgress, {
      toValue: open ? 1 : 0,
      duration: SEARCH_EXPAND_MS,
      useNativeDriver: false, // height interpolation
    }).start();
  };

  // Same rule as v1: never-planned recipes, newest first, max 6; hero = first.
  const suggestions = useMemo(
    () => recipes.filter((r) => !plannedEverIds.has(r.id)).slice(0, 6),
    [recipes, plannedEverIds]
  );
  const hero = suggestions[0];
  const carousel = suggestions.slice(1);

  const thisWeek = useMemo(() => {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    return thisWeekIds.map((id) => byId.get(id)).filter((r): r is RecipeListItem => !!r);
  }, [recipes, thisWeekIds]);
  const thisWeekSet = useMemo(() => new Set(thisWeekIds), [thisWeekIds]);

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  const filtered = useMemo(
    () => (query ? recipes.filter((r) => r.title.toLowerCase().includes(query)) : recipes),
    [recipes, query]
  );

  const openRecipe = (id: string) => router.push(`/library/${id}`);

  const header = (
    <View>
      {/* Wordmark + search / add icons */}
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
          accessibilityLabel={searchOpen ? 'Close search' : 'Search recipes'}
          accessibilityState={{ expanded: searchOpen }}
          onPress={toggleSearch}
          style={({ pressed }) => ({
            width: minTapTarget,
            height: minTapTarget,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: minTapTarget / 2,
            backgroundColor: pressed ? colors.cardPressed : 'transparent',
          })}
        >
          <Ionicons name={searchOpen ? 'close' : 'search-outline'} size={24} color={colors.text} />
        </Pressable>
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

      {/* Collapsible search field */}
      <Animated.View
        style={{
          overflow: 'hidden',
          height: searchProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }),
          opacity: searchProgress,
        }}
      >
        <View style={{ paddingBottom: 12 }}>
          <Field
            icon="search-outline"
            value={search}
            onChangeText={setSearch}
            placeholder="Search recipes"
            autoCapitalize="none"
            autoFocus={searchOpen && Platform.OS !== 'web'}
          />
        </View>
      </Animated.View>

      {!searching ? (
        <View>
          {hero ? (
            <Hero
              recipe={hero}
              planned={thisWeekSet.has(hero.id)}
              onPress={() => openRecipe(hero.id)}
              onBookmark={() => setSheetRecipe(hero)}
            />
          ) : null}

          {carousel.length > 0 ? (
            <View style={{ paddingTop: 16, gap: 12 }}>
              <SectionHeader title="Suggested for you" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 14, paddingHorizontal: screenPadding }}
                style={{ marginHorizontal: -screenPadding }}
              >
                {carousel.map((recipe) => (
                  <SuggestionCard
                    key={recipe.id}
                    recipe={recipe}
                    planned={thisWeekSet.has(recipe.id)}
                    onPress={() => openRecipe(recipe.id)}
                    onBookmark={() => setSheetRecipe(recipe)}
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
                contentContainerStyle={{ gap: 14, paddingHorizontal: screenPadding }}
                style={{ marginHorizontal: -screenPadding }}
              >
                {thisWeek.map((recipe) => (
                  <ThisWeekCard
                    key={recipe.id}
                    recipe={recipe}
                    onPress={() => router.navigate('/plan')}
                  />
                ))}
              </ScrollView>
              <Hairline />
            </View>
          ) : null}

          {recipes.length > 0 ? (
            <SectionHeader title="All recipes" style={{ paddingTop: 16, paddingBottom: 4 }} />
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RecipeRow recipe={item} onPress={() => openRecipe(item.id)} />}
        ItemSeparatorComponent={Hairline}
        ListHeaderComponent={header}
        ListEmptyComponent={
          recipes.length === 0 ? (
            <EmptyState
              message="Your cooking notebook starts here."
              actionLabel="Add your first recipe"
              onAction={() => router.push('/capture')}
            />
          ) : (
            <View style={{ paddingVertical: 24 }}>
              <Muted>No recipes match your search.</Muted>
            </View>
          )
        }
        contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: 24 }}
      />

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
