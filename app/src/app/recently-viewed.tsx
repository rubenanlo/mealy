import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecipeRow, type RecipeListItem } from '@/components/recipe-cards';
import { Body, Hairline, Loading, Muted, Title } from '@/components/ui';
import { useAuth, useHousehold } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { backOr } from '@/lib/nav';
import { loadRecentlyViewed, resolveRecentlyViewed } from '@/lib/recently-viewed';
import { supabase } from '@/lib/supabase';
import { localizedTitle } from '@/lib/translations';
import { fonts, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

/** Full "Recently viewed" list behind the Home row's chevron. */
export default function RecentlyViewedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const { householdId } = useHousehold();
  const { d, locale } = useI18n();
  const userId = session?.user.id ?? '';

  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const ids = await loadRecentlyViewed(userId);
    if (ids.length === 0) {
      setRecipes([]);
      setLoaded(true);
      return;
    }
    const { data: recipeRows } = await supabase
      .from('recipes')
      .select(
        'id, title, tags, needs_review, cover_image_path, servings, prep_minutes, cook_minutes, created_at, ingredients, fodmap_override, recipe_translations(locale, title)'
      )
      .eq('household_id', householdId)
      .in('id', ids);
    const localized = (
      (recipeRows ?? []) as (RecipeListItem & {
        recipe_translations?: { locale: string; title: string }[] | null;
      })[]
    ).map(({ recipe_translations, ...r }) => ({
      ...r,
      title: localizedTitle({ title: r.title, recipe_translations }, locale),
    }));
    setRecipes(resolveRecentlyViewed(ids, localized));
    setLoaded(true);
  }, [userId, householdId, locale]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 16, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.common.back}
          onPress={() => backOr('/(tabs)/library')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: minTapTarget,
            alignSelf: 'flex-start',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.common.back}</Body>
        </Pressable>

        <Title>{d.library.recentlyViewed}</Title>
        {!loaded ? <Loading /> : null}

        <View>
          {loaded
            ? recipes.map((recipe, i) => (
                <View key={recipe.id}>
                  {i > 0 ? <Hairline /> : null}
                  <RecipeRow recipe={recipe} onPress={() => router.push(`/recipe/${recipe.id}`)} />
                </View>
              ))
            : null}
          {loaded && recipes.length === 0 ? <Muted>{d.library.recentlyViewedEmpty}</Muted> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
