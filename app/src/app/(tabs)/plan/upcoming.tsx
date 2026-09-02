import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { RecipeImage } from '@/components/recipe-cards';
import { Eyebrow, Hairline, Loading, Muted, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { fmt, useI18n } from '@/lib/i18n';
import { buildCells, type EntryRow, type MealCell, type RecipeLite } from '@/lib/meal-cells';
import { isMealUpcoming, normalizeMealTimes } from '@/lib/meal-times';
import { backOr } from '@/lib/nav';
import { dayDate, weekStart, type MealSlot } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import {
  fonts,
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  tabBarClearance,
  useTheme,
} from '@/lib/theme';
import { localizedTitle } from '@/lib/translations';

/** Read-only list of this week's remaining meals, next one first. */
export default function UpcomingMealsScreen() {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { householdId } = useHousehold();

  const [cells, setCells] = useState<MealCell[]>([]);
  const [loaded, setLoaded] = useState(false);

  const weekIso = weekStart(new Date());
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);
  const todayIndex = Math.floor(
    (new Date().setHours(0, 0, 0, 0) - dayDate(weekIso, 0).getTime()) / 86_400_000
  );

  const load = useCallback(async () => {
    const [{ data: plan }, { data: hh }, { data: personRows }] = await Promise.all([
      supabase
        .from('meal_plans')
        .select('id')
        .eq('household_id', householdId)
        .eq('week_start', weekIso)
        .maybeSingle(),
      supabase.from('households').select('meal_times').eq('id', householdId).single(),
      supabase.from('persons').select('id, name, is_employee').eq('household_id', householdId),
    ]);
    const persons = (personRows as { id: string; name: string; is_employee: boolean }[]) ?? [];
    if (!plan) {
      setCells([]);
      setLoaded(true);
      return;
    }
    const { data: entryRows } = await supabase
      .from('plan_entries')
      .select('meal_plan_id, day, slot, recipe_id, custom_title, assigned_cook, person_ids, guest_count')
      .eq('meal_plan_id', plan.id);
    const entries = (entryRows as EntryRow[]) ?? [];
    const recipeIds = [
      ...new Set(entries.map((e) => e.recipe_id).filter((id): id is string => !!id)),
    ];
    let recipesById = new Map<string, RecipeLite>();
    if (recipeIds.length > 0) {
      const { data: recipeRows } = await supabase
        .from('recipes')
        .select('id, title, cover_image_path, recipe_translations(locale, title)')
        .in('id', recipeIds);
      const rows = (
        (recipeRows as (RecipeLite & {
          recipe_translations: { locale: string; title: string }[] | null;
        })[]) ?? []
      ).map(({ recipe_translations, ...r }) => ({
        ...r,
        title: localizedTitle({ title: r.title, recipe_translations }, locale),
      }));
      recipesById = new Map(rows.map((r) => [r.id, r]));
    }
    const all = buildCells(
      entries,
      recipesById,
      persons.filter((p) => !p.is_employee).length,
      d.plan.recipeFallback,
      new Map(persons.map((p) => [p.id, p.name]))
    );
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const today = Math.floor(
      (new Date(now).setHours(0, 0, 0, 0) - dayDate(weekIso, 0).getTime()) / 86_400_000
    );
    const times = normalizeMealTimes(hh?.meal_times ?? null);
    setCells(all.filter((c) => isMealUpcoming(c.day, c.slot, today, nowMinutes, times)));
    setLoaded(true);
  }, [householdId, weekIso, locale, d]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: screenPadding,
          paddingVertical: 8,
          gap: 8,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.plan.backToWeeks}
          onPress={() => backOr('/plan')}
          style={({ pressed }) => ({
            width: minTapTarget,
            height: minTapTarget,
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: -12,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Eyebrow>
            {new Date()
              .toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })
              .toUpperCase()}
          </Eyebrow>
          <Title>{d.plan.nextMeals}</Title>
        </View>
      </View>

      {!loaded ? (
        <Loading />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: screenPadding,
            paddingBottom: insets.bottom + tabBarClearance,
            gap: 20,
          }}
        >
          {cells.length === 0 ? <Muted>{d.plan.nextMealsEmpty}</Muted> : null}
          {cells.map((cell, i) => (
            <View key={`${cell.day}-${cell.slot}`} style={{ gap: 10 }}>
              <Eyebrow style={i === 0 ? { color: colors.saffron } : undefined}>
                {`${cell.day === todayIndex ? d.plan.today : d.common.days[cell.day]} · ${slotLabel(cell.slot)}`}
                {i === 0 ? ` · ${d.plan.next}` : ''}
              </Eyebrow>
              {cell.titles.map((title, n) => {
                const recipeId = cell.dishRecipeIds[n];
                const servings = cell.dishServings[n];
                return (
                  <Pressable
                    key={n}
                    accessibilityRole={recipeId ? 'button' : undefined}
                    accessibilityLabel={title}
                    disabled={!recipeId}
                    onPress={() =>
                      recipeId
                        ? router.push({
                            pathname: '/recipe/[id]',
                            params: { id: recipeId, planServings: String(servings ?? '') },
                          })
                        : undefined
                    }
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <RecipeImage
                      path={cell.covers[n] ?? null}
                      style={{ width: 96, height: 72, borderRadius: radius.thumb }}
                      iconSize={24}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        numberOfLines={2}
                        style={{
                          color: colors.text,
                          fontSize: fontSize.cardTitle,
                          lineHeight: 21,
                          fontFamily: fonts.displaySemi,
                        }}
                      >
                        {title}
                      </Text>
                      <Muted numberOfLines={1}>
                        {cell.eaters[n]?.length > 0
                          ? cell.eaters[n].join(', ')
                          : d.plan.wholeHousehold}
                      </Muted>
                      {servings !== null ? (
                        <Muted>{fmt(d.plan.serves, { n: servings })}</Muted>
                      ) : null}
                    </View>
                    {recipeId ? (
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    ) : null}
                  </Pressable>
                );
              })}
              {i < cells.length - 1 ? <Hairline /> : null}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
