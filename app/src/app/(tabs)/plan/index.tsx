import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { RecipeImage } from '@/components/recipe-cards';
import { Eyebrow, Muted, SectionHeader, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { isMealUpcoming, normalizeMealTimes, type MealTimes } from '@/lib/meal-times';
import { addWeeks, DAY_LABELS, dayDate, SLOT_LABELS, weekStart, type MealSlot } from '@/lib/plan';
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

interface PlanRow {
  id: string;
  week_start: string;
}

interface EntryRow {
  meal_plan_id: string;
  day: number;
  slot: MealSlot;
  recipe_id: string | null;
  custom_title: string | null;
}

interface RecipeLite {
  id: string;
  title: string;
  cover_image_path: string | null;
}

/** One planned meal cell (day + slot) with everything scheduled in it. */
interface MealCell {
  day: number;
  slot: MealSlot;
  titles: string[];
  covers: (string | null)[];
  recipeIds: string[];
}

function weekLabel(weekIso: string): string {
  return `Week of ${dayDate(weekIso, 0).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })}`;
}

/** Group a week's entries into ordered meal cells (day asc, lunch first). */
function buildCells(entries: EntryRow[], recipesById: Map<string, RecipeLite>): MealCell[] {
  const byKey = new Map<string, MealCell>();
  for (const entry of entries) {
    const key = `${entry.day}-${entry.slot}`;
    const cell =
      byKey.get(key) ?? { day: entry.day, slot: entry.slot, titles: [], covers: [], recipeIds: [] };
    if (entry.recipe_id) {
      const recipe = recipesById.get(entry.recipe_id);
      cell.titles.push(recipe?.title ?? 'Recipe');
      cell.covers.push(recipe?.cover_image_path ?? null);
      cell.recipeIds.push(entry.recipe_id);
    } else if (entry.custom_title) {
      cell.titles.push(entry.custom_title);
      cell.covers.push(null);
    }
    byKey.set(key, cell);
  }
  return [...byKey.values()].sort(
    (a, b) => a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1)
  );
}

export default function WeeksScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { householdId } = useHousehold();

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [recipesById, setRecipesById] = useState<Map<string, RecipeLite>>(new Map());
  const [mealTimes, setMealTimes] = useState<MealTimes>(normalizeMealTimes(null));

  const currentWeek = weekStart(new Date());

  const load = useCallback(async () => {
    const [{ data: planRows }, { data: hh }] = await Promise.all([
      supabase
        .from('meal_plans')
        .select('id, week_start')
        .eq('household_id', householdId)
        .order('week_start', { ascending: false }),
      supabase.from('households').select('meal_times').eq('id', householdId).single(),
    ]);
    if (hh) setMealTimes(normalizeMealTimes(hh.meal_times));
    const allPlans = (planRows as PlanRow[]) ?? [];
    setPlans(allPlans);
    if (allPlans.length === 0) {
      setEntries([]);
      return;
    }
    const { data: entryRows } = await supabase
      .from('plan_entries')
      .select('meal_plan_id, day, slot, recipe_id, custom_title')
      .in(
        'meal_plan_id',
        allPlans.map((p) => p.id)
      );
    const all = (entryRows as EntryRow[]) ?? [];
    setEntries(all);
    const recipeIds = [...new Set(all.map((e) => e.recipe_id).filter((id): id is string => !!id))];
    if (recipeIds.length > 0) {
      const { data: recipeRows } = await supabase
        .from('recipes')
        .select('id, title, cover_image_path')
        .in('id', recipeIds);
      setRecipesById(new Map(((recipeRows as RecipeLite[]) ?? []).map((r) => [r.id, r])));
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const openWeek = (week: string) =>
    router.push({ pathname: '/plan/detail', params: { week } });

  /** Current week's meals from today onward; the first one is "next". */
  const upcoming = useMemo(() => {
    const plan = plans.find((p) => p.week_start === currentWeek);
    if (!plan) return [];
    const cells = buildCells(
      entries.filter((e) => e.meal_plan_id === plan.id),
      recipesById
    );
    const now = new Date();
    const todayIndex = Math.floor(
      (new Date(now).setHours(0, 0, 0, 0) - dayDate(currentWeek, 0).getTime()) / 86_400_000
    );
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return cells.filter((c) =>
      isMealUpcoming(c.day, c.slot, todayIndex, nowMinutes, mealTimes)
    );
  }, [plans, entries, recipesById, currentWeek, mealTimes]);

  /** Past weeks with a plan, newest first. */
  const pastWeeks = useMemo(
    () =>
      plans
        .filter((p) => p.week_start < currentWeek)
        .map((p) => ({
          ...p,
          cells: buildCells(
            entries.filter((e) => e.meal_plan_id === p.id),
            recipesById
          ),
        })),
    [plans, entries, recipesById, currentWeek]
  );

  const newPlan = () => {
    const options = [0, 1, 2, 3].map((delta) => {
      const week = addWeeks(currentWeek, delta);
      const label =
        delta === 0 ? 'This week' : delta === 1 ? 'Next week' : `In ${delta} weeks`;
      return { text: `${label} — ${weekLabel(week).replace('Week of ', '')}`, week };
    });
    Alert.alert('Plan which week?', undefined, [
      ...options.map((o) => ({ text: o.text, onPress: () => openWeek(o.week) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const todayIndex = Math.floor(
    (new Date().setHours(0, 0, 0, 0) - dayDate(currentWeek, 0).getTime()) / 86_400_000
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: screenPadding,
          paddingBottom: insets.bottom + tabBarClearance,
          gap: 16,
        }}
      >
        <View style={{ paddingVertical: 8, gap: 2 }}>
          <Eyebrow>
            {new Date()
              .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
              .toUpperCase()}
          </Eyebrow>
          <Title>Meal plans</Title>
        </View>

        {/* This week: next meal first, then the rest of the upcoming meals. */}
        <View style={{ gap: 12 }}>
          <SectionHeader
            title="This week"
            linkLabel="Open"
            onLinkPress={() => openWeek(currentWeek)}
          />
          {upcoming.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -screenPadding }}
              contentContainerStyle={{ gap: 14, paddingHorizontal: screenPadding }}
            >
              {upcoming.map((cell, i) => (
                <Pressable
                  key={`${cell.day}-${cell.slot}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${DAY_LABELS[cell.day]} ${SLOT_LABELS[cell.slot]}: ${cell.titles.join(', ')}`}
                  onPress={() =>
                    cell.recipeIds.length === 1
                      ? router.push(`/recipe/${cell.recipeIds[0]}`)
                      : openWeek(currentWeek)
                  }
                  style={({ pressed }) => ({ width: 150, opacity: pressed ? 0.7 : 1 })}
                >
                  {cell.covers.length > 1 ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        alignContent: 'space-between',
                        width: 150,
                        height: 110,
                        borderRadius: radius.card,
                        overflow: 'hidden',
                      }}
                    >
                      {[0, 1, 2, 3].map((n) => (
                        <RecipeImage
                          key={n}
                          path={cell.covers[n] ?? null}
                          style={{ width: '49%', height: '48.5%' }}
                          iconSize={16}
                        />
                      ))}
                    </View>
                  ) : (
                    <RecipeImage
                      path={cell.covers[0] ?? null}
                      style={{ width: 150, height: 110, borderRadius: radius.card }}
                    />
                  )}
                  <View style={{ paddingTop: 8, gap: 2 }}>
                    <Eyebrow style={i === 0 ? { color: colors.saffron } : undefined}>
                      {`${cell.day === todayIndex ? 'Today' : DAY_LABELS[cell.day]} · ${SLOT_LABELS[cell.slot]}`}
                      {i === 0 ? ' · next' : ''}
                    </Eyebrow>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: colors.text,
                        fontSize: fontSize.cardTitle,
                        lineHeight: 21,
                        fontFamily: fonts.displaySemi,
                      }}
                    >
                      {cell.titles.join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Plan this week"
              onPress={() => openWeek(currentWeek)}
              style={({ pressed }) => ({
                minHeight: 110,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                backgroundColor: pressed ? colors.cardPressed : 'transparent',
              })}
            >
              <Ionicons name="calendar-outline" size={24} color={colors.textMuted} />
              <Muted>Nothing planned yet — plan this week</Muted>
            </Pressable>
          )}
        </View>

        {/* Past weeks grid; the first tile creates a new plan. */}
        <View style={{ gap: 12, paddingTop: 8 }}>
          <SectionHeader title="Past weeks" />
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              rowGap: 20,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New meal plan"
              onPress={newPlan}
              style={({ pressed }) => ({
                width: '47.5%',
                aspectRatio: 1,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                backgroundColor: pressed ? colors.cardPressed : 'transparent',
              })}
            >
              <View
                style={{
                  width: minTapTarget,
                  height: minTapTarget,
                  borderRadius: minTapTarget / 2,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={28} color={colors.text} />
              </View>
              <Muted>New plan</Muted>
            </Pressable>

            {pastWeeks.map((week) => {
              const covers: (string | null)[] = week.cells
                .flatMap((c) => c.covers)
                .filter((c): c is string => !!c)
                .slice(0, 4);
              while (covers.length < 4) covers.push(null);
              const meals = week.cells.length;
              return (
                <Pressable
                  key={week.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${weekLabel(week.week_start)}`}
                  onPress={() => openWeek(week.week_start)}
                  style={({ pressed }) => ({ width: '47.5%', opacity: pressed ? 0.7 : 1 })}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignContent: 'space-between',
                      aspectRatio: 1,
                      borderRadius: radius.card,
                      overflow: 'hidden',
                    }}
                  >
                    {covers.map((path, n) => (
                      <RecipeImage
                        key={n}
                        path={path ?? null}
                        style={{ width: '48.5%', height: '48.5%' }}
                        iconSize={20}
                      />
                    ))}
                  </View>
                  <View style={{ paddingTop: 8, gap: 2 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: colors.text,
                        fontSize: fontSize.cardTitle,
                        fontFamily: fonts.displaySemi,
                      }}
                    >
                      {weekLabel(week.week_start)}
                    </Text>
                    <Muted>
                      {meals} {meals === 1 ? 'meal' : 'meals'}
                    </Muted>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {pastWeeks.length === 0 ? (
            <Muted>Planned weeks land here once they wrap up.</Muted>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
