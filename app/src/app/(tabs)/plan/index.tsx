import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { RecipeImage } from '@/components/recipe-cards';
import {
  Body,
  Button,
  Eyebrow,
  Field,
  Hairline,
  LinkButton,
  Loading,
  Muted,
  SectionHeader,
  Title,
} from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { consumeInvalidation } from '@/lib/list-refresh';
import { fmt, useI18n } from '@/lib/i18n';
import { isMealUpcoming, normalizeMealTimes, type MealTimes } from '@/lib/meal-times';
import { addWeeks, dayDate, weekStart, type MealSlot } from '@/lib/plan';
import { entryServings } from '@/lib/servings';
import { supabase } from '@/lib/supabase';
import { localizedTitle } from '@/lib/translations';
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
  /** Extra checklist items for the employee (migration 0016). */
  employee_notes: string[];
}

interface EntryRow {
  meal_plan_id: string;
  day: number;
  slot: MealSlot;
  recipe_id: string | null;
  custom_title: string | null;
  assigned_cook: 'family' | 'employee';
  /** Empty ⇒ whole household eats it. */
  person_ids: string[];
  /** Non-family guests eating this meal (migration 0017). */
  guest_count: number;
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
  /** Servings (covered eaters + guests) per recipe, parallel to recipeIds. */
  servings: number[];
}

/** Group a week's entries into ordered meal cells (day asc, lunch first). */
function buildCells(
  entries: EntryRow[],
  recipesById: Map<string, RecipeLite>,
  eaterCount: number,
  recipeFallback: string
): MealCell[] {
  const byKey = new Map<string, MealCell>();
  for (const entry of entries) {
    const key = `${entry.day}-${entry.slot}`;
    const cell =
      byKey.get(key) ??
      { day: entry.day, slot: entry.slot, titles: [], covers: [], recipeIds: [], servings: [] };
    if (entry.recipe_id) {
      const recipe = recipesById.get(entry.recipe_id);
      cell.titles.push(recipe?.title ?? recipeFallback);
      cell.covers.push(recipe?.cover_image_path ?? null);
      cell.recipeIds.push(entry.recipe_id);
      cell.servings.push(entryServings(entry.person_ids, entry.guest_count, eaterCount));
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
  const { d, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { householdId } = useHousehold();

  /** Just the date part of a week label, in the active language. */
  const weekDate = (weekIso: string) =>
    dayDate(weekIso, 0).toLocaleDateString(locale, { month: 'long', day: 'numeric' });
  const weekLabel = (weekIso: string) => fmt(d.plan.weekOf, { date: weekDate(weekIso) });
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [recipesById, setRecipesById] = useState<Map<string, RecipeLite>>(new Map());
  const [mealTimes, setMealTimes] = useState<MealTimes>(normalizeMealTimes(null));
  const [employeeNames, setEmployeeNames] = useState<string[]>([]);
  const [eaterCount, setEaterCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  const currentWeek = weekStart(new Date());

  const load = useCallback(async () => {
    // A meal/recipe change elsewhere invalidated the week: show the spinner.
    if (consumeInvalidation('plan')) setLoaded(false);
    const [{ data: planRows }, { data: hh }] = await Promise.all([
      supabase
        .from('meal_plans')
        .select('id, week_start, employee_notes')
        .eq('household_id', householdId)
        .order('week_start', { ascending: false }),
      supabase.from('households').select('meal_times').eq('id', householdId).single(),
      supabase
        .from('persons')
        .select('name, is_employee')
        .eq('household_id', householdId)
        .order('created_at')
        .then((res) => {
          const rows = ((res.data ?? []) as { name: string; is_employee: boolean }[]);
          setEmployeeNames(rows.filter((p) => p.is_employee).map((p) => p.name));
          setEaterCount(rows.filter((p) => !p.is_employee).length);
          return res;
        }),
    ]);
    if (hh) setMealTimes(normalizeMealTimes(hh.meal_times));
    const allPlans = (planRows as PlanRow[]) ?? [];
    setPlans(allPlans);
    if (allPlans.length === 0) {
      setEntries([]);
      setLoaded(true);
      return;
    }
    const { data: entryRows } = await supabase
      .from('plan_entries')
      .select('meal_plan_id, day, slot, recipe_id, custom_title, assigned_cook, person_ids, guest_count')
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
        .select('id, title, cover_image_path, recipe_translations(locale, title)')
        .in('id', recipeIds);
      // Localize titles up front so every downstream display stays unchanged.
      const rows = (
        (recipeRows as (RecipeLite & {
          recipe_translations: { locale: string; title: string }[] | null;
        })[]) ?? []
      ).map(({ recipe_translations, ...r }) => ({
        ...r,
        title: localizedTitle({ title: r.title, recipe_translations }, locale),
      }));
      setRecipesById(new Map(rows.map((r) => [r.id, r])));
    }
    setLoaded(true);
  }, [householdId, locale]);

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
      recipesById,
      eaterCount,
      d.plan.recipeFallback
    );
    const now = new Date();
    const todayIndex = Math.floor(
      (new Date(now).setHours(0, 0, 0, 0) - dayDate(currentWeek, 0).getTime()) / 86_400_000
    );
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return cells.filter((c) =>
      isMealUpcoming(c.day, c.slot, todayIndex, nowMinutes, mealTimes)
    );
  }, [plans, entries, recipesById, currentWeek, mealTimes, eaterCount, d]);

  /** This week's meals the employee cooks (whole week, not just upcoming). */
  const employeeCells = useMemo(() => {
    const plan = plans.find((p) => p.week_start === currentWeek);
    if (!plan) return [];
    return buildCells(
      entries.filter((e) => e.meal_plan_id === plan.id && e.assigned_cook === 'employee'),
      recipesById,
      eaterCount,
      d.plan.recipeFallback
    );
  }, [plans, entries, recipesById, currentWeek, eaterCount, d]);

  /** Past weeks with a plan, newest first. */
  const pastWeeks = useMemo(
    () =>
      plans
        .filter((p) => p.week_start < currentWeek)
        .map((p) => ({
          ...p,
          cells: buildCells(
            entries.filter((e) => e.meal_plan_id === p.id),
            recipesById,
            eaterCount,
            d.plan.recipeFallback
          ),
        })),
    [plans, entries, recipesById, currentWeek, eaterCount, d]
  );

  const currentPlan = plans.find((p) => p.week_start === currentWeek);
  const employeeNotes = Array.isArray(currentPlan?.employee_notes)
    ? currentPlan.employee_notes
    : [];

  const saveEmployeeNotes = async (next: string[]) => {
    if (!currentPlan) return;
    setPlans((prev) =>
      prev.map((p) => (p.id === currentPlan.id ? { ...p, employee_notes: next } : p))
    );
    await supabase.from('meal_plans').update({ employee_notes: next }).eq('id', currentPlan.id);
  };

  const openNotesEditor = () => {
    setNoteDraft(employeeNotes.join('\n'));
    setNotesOpen(true);
  };

  /** One instruction per line; blank lines drop out on save. */
  const saveNotesDraft = () => {
    const items = noteDraft
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    setNotesOpen(false);
    void saveEmployeeNotes(items);
  };

  const newPlan = () => {
    const options = [0, 1, 2, 3].map((delta) => {
      const week = addWeeks(currentWeek, delta);
      const label =
        delta === 0
          ? d.plan.thisWeek
          : delta === 1
            ? d.plan.nextWeek
            : fmt(d.plan.inWeeks, { n: delta });
      return { text: `${label} — ${weekDate(week)}`, week };
    });
    Alert.alert(d.plan.planWhichWeek, undefined, [
      ...options.map((o) => ({ text: o.text, onPress: () => openWeek(o.week) })),
      { text: d.common.cancel, style: 'cancel' as const },
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
              .toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })
              .toUpperCase()}
          </Eyebrow>
          <Title>{d.plan.mealPlans}</Title>
        </View>

        {!loaded ? <Loading /> : null}

        {/* This week: next meal first, then the rest of the upcoming meals. */}
        {loaded ? (
        <>
        <View style={{ gap: 12 }}>
          <SectionHeader
            title={d.plan.thisWeek}
            linkLabel={d.plan.open}
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
                  accessibilityLabel={`${d.common.days[cell.day]} ${slotLabel(cell.slot)}: ${cell.titles.join(', ')}`}
                  onPress={() =>
                    cell.recipeIds.length === 1
                      ? router.push({
                          pathname: '/recipe/[id]',
                          params: { id: cell.recipeIds[0], planServings: String(cell.servings[0]) },
                        })
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
                      {`${cell.day === todayIndex ? d.plan.today : d.common.days[cell.day]} · ${slotLabel(cell.slot)}`}
                      {i === 0 ? ` · ${d.plan.next}` : ''}
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
                    {cell.recipeIds.length === 1 ? (
                      <Muted>{fmt(d.plan.serves, { n: cell.servings[0] })}</Muted>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={d.plan.planThisWeek}
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
              <Muted>{d.plan.nothingPlanned}</Muted>
            </Pressable>
          )}
        </View>

        {/* The employee's cooking list for this week (mirrors her web link). */}
        {employeeNames.length > 0 && employeeCells.length > 0 ? (
          <View style={{ gap: 12, paddingTop: 8 }}>
            <SectionHeader title={fmt(d.plan.assignedTo, { names: employeeNames.join(' & ') })} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -screenPadding }}
              contentContainerStyle={{ gap: 14, paddingHorizontal: screenPadding }}
            >
              {employeeCells.map((cell) => (
                <Pressable
                  key={`emp-${cell.day}-${cell.slot}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.common.days[cell.day]} ${slotLabel(cell.slot)}: ${cell.titles.join(', ')}`}
                  onPress={() =>
                    cell.recipeIds.length === 1
                      ? router.push({
                          pathname: '/recipe/[id]',
                          params: { id: cell.recipeIds[0], planServings: String(cell.servings[0]) },
                        })
                      : openWeek(currentWeek)
                  }
                  style={({ pressed }) => ({ width: 150, opacity: pressed ? 0.7 : 1 })}
                >
                  <RecipeImage
                    path={cell.covers[0] ?? null}
                    style={{ width: 150, height: 110, borderRadius: radius.card }}
                  />
                  <View style={{ paddingTop: 8, gap: 2 }}>
                    <Eyebrow>
                      {`${cell.day === todayIndex ? d.plan.today : d.common.days[cell.day]} · ${slotLabel(cell.slot)}`}
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

            {/* Extra checklist for the employee, mirrored on her web link. */}
            {notesOpen ? (
              <View style={{ gap: 10 }}>
                <Muted>{d.plan.oneInstructionPerLine}</Muted>
                <Field
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder={d.plan.notesPlaceholder}
                  multiline
                  autoFocus
                  style={{ minHeight: 110, textAlignVertical: 'top' }}
                />
                <Button label={d.plan.saveInstructions} kind="secondary" onPress={saveNotesDraft} />
              </View>
            ) : (
              <>
                {employeeNotes.length > 0 ? (
                  // Collapsed: first line only, ellipsized; tap to edit.
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={d.plan.editInstructions}
                    onPress={openNotesEditor}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      minHeight: 40,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Body numberOfLines={1} style={{ flex: 1 }}>
                      {employeeNotes.join(' · ')}
                    </Body>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                ) : (
                  <LinkButton
                    label={d.plan.addMoreInstructions}
                    onPress={openNotesEditor}
                    style={{ alignSelf: 'flex-start', minHeight: 32 }}
                  />
                )}
              </>
            )}
          </View>
        ) : null}

        {/* Past weeks grid; the first tile creates a new plan. */}
        <View style={{ gap: 12, paddingTop: 8 }}>
          <SectionHeader title={d.plan.pastWeeks} />
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
              accessibilityLabel={d.plan.newMealPlan}
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
              <Muted>{d.plan.newPlan}</Muted>
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
                  accessibilityLabel={fmt(d.plan.openWeek, { week: weekLabel(week.week_start) })}
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
                      {meals} {meals === 1 ? d.plan.mealOne : d.plan.mealMany}
                    </Muted>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {pastWeeks.length === 0 ? (
            <Muted>{d.plan.pastWeeksEmpty}</Muted>
          ) : null}
        </View>
        </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
