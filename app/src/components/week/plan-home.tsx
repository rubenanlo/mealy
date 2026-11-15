// Meal plans home (2026-11-15): the summary page before the week. Up next and
// the coming meals, the weeks with how far along each is, what the employee
// does this week (with her instructions), and past weeks. Tapping a week
// opens the one-page week planner (plan/detail).

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { IdeaSheet } from '@/components/idea-sheet';
import { RecipeImage } from '@/components/recipe-cards';
import { UpcomingMealsStrip, type UpcomingCell } from '@/components/upcoming-strip';
import { Button, Eyebrow, LinkButton, Loading, Muted, SectionHeader, Title } from '@/components/ui';
import { InstructionsSheet } from '@/components/week/instructions-sheet';
import { PastWeekSheet, type PastDay, type PastDish } from '@/components/week/past-week-sheet';
import { Badge } from '@/components/week/sheet';
import { UpNextCard, useMealWhen } from '@/components/week/up-next-card';
import { isSalad } from '@/lib/ai-week';
import { useHousehold } from '@/lib/auth';
import { resolveProteinCategory } from '@/lib/category';
import { confirmDestructive, notify } from '@/lib/confirm';
import { shareEmployeeLink } from '@/lib/employee-link';
import { fmt, useI18n } from '@/lib/i18n';
import { consumeInvalidation, invalidateLists } from '@/lib/list-refresh';
import { buildCells, type EntryRow, type RecipeLite } from '@/lib/meal-cells';
import { isMealUpcoming, normalizeMealTimes, type MealTimes } from '@/lib/meal-times';
import { anchorFromEvent, pickOption } from '@/lib/options';
import { addWeeks, dayDate, weekStart, type MealSlot, type PlanAbsence } from '@/lib/plan';
import { copyEntriesToWeek, weekEntryCount } from '@/lib/plan-copy';
import { carryOverNotes, tallyCounts, weekRange } from '@/lib/plan-home';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, radius, screenPadding, tabBarClearance, useTheme } from '@/lib/theme';
import { localizedTitle } from '@/lib/translations';
import { useCanonicalIndex } from '@/lib/use-canonical';
import { splitSlot, weekProgress } from '@/lib/week-page';
import type { IngredientRow } from '@/lib/worker';

interface PlanRow {
  id: string;
  week_start: string;
  status: 'draft' | 'approved';
  employee_notes: string[] | null;
}

interface HomeEntry extends EntryRow {
  id: string;
  position: number;
  cook_part: boolean | null;
  instructions: string | null;
}

interface HomeRecipe extends RecipeLite {
  tags: string[];
  ingredients: IngredientRow[] | null;
  dish_type: string | null;
}

interface Person {
  id: string;
  name: string;
  is_employee: boolean;
  share_token: string | null;
}

/** The employee cooks the week's batch on Wednesday. */
const EMPLOYEE_COOK_DAY = 2;
const PAST_WEEKS_SHOWN = 4;

const byDaySlot = (a: Pick<EntryRow, 'day' | 'slot'>, b: Pick<EntryRow, 'day' | 'slot'>) =>
  a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1);

const notesOf = (plan: PlanRow | undefined) => (Array.isArray(plan?.employee_notes) ? plan.employee_notes : []);

export function PlanHome() {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const t = d.planHome;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { householdId } = useHousehold();
  const index = useCanonicalIndex();
  const mealWhen = useMealWhen();
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [entries, setEntries] = useState<HomeEntry[]>([]);
  const [absences, setAbsences] = useState<PlanAbsence[]>([]);
  const [recipesById, setRecipesById] = useState<Map<string, HomeRecipe>>(new Map());
  const [persons, setPersons] = useState<Person[]>([]);
  const [mealTimes, setMealTimes] = useState<MealTimes>(normalizeMealTimes(null));
  const [ideasByWeek, setIdeasByWeek] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const [pastPlanId, setPastPlanId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [ideaSheetOpen, setIdeaSheetOpen] = useState(false);

  const currentWeek = weekStart(new Date());
  const lastWeek = addWeeks(currentWeek, -1);

  const load = useCallback(async () => {
    if (consumeInvalidation('plan')) setLoaded(false);
    const [{ data: planRows }, { data: hh }, { data: personRows }, { data: ideaRows }] = await Promise.all([
      supabase
        .from('meal_plans')
        .select('id, week_start, status, employee_notes')
        .eq('household_id', householdId)
        .order('week_start', { ascending: false }),
      supabase.from('households').select('meal_times').eq('id', householdId).single(),
      supabase
        .from('persons')
        .select('id, name, is_employee, share_token')
        .eq('household_id', householdId)
        .order('created_at'),
      supabase.from('plan_ideas').select('week_start').eq('household_id', householdId).gte('week_start', currentWeek),
    ]);
    if (hh) setMealTimes(normalizeMealTimes(hh.meal_times));
    setPersons((personRows as Person[]) ?? []);
    const ideaCounts = new Map<string, number>();
    for (const row of (ideaRows as { week_start: string }[]) ?? []) {
      ideaCounts.set(row.week_start, (ideaCounts.get(row.week_start) ?? 0) + 1);
    }
    setIdeasByWeek(ideaCounts);
    const allPlans = (planRows as PlanRow[]) ?? [];
    setPlans(allPlans);
    if (allPlans.length === 0) {
      setEntries([]);
      setAbsences([]);
      setLoaded(true);
      return;
    }
    const current = allPlans.find((p) => p.week_start === currentWeek);
    const [{ data: entryRows }, { data: absenceRows }] = await Promise.all([
      supabase
        .from('plan_entries')
        .select(
          'id, meal_plan_id, day, slot, recipe_id, custom_title, assigned_cook, person_ids, guest_count, position, cook_part, instructions'
        )
        .in(
          'meal_plan_id',
          allPlans.map((p) => p.id)
        ),
      current
        ? supabase.from('plan_absences').select('day, slot, person_id').eq('meal_plan_id', current.id)
        : Promise.resolve({ data: [] }),
    ]);
    const all = ((entryRows as HomeEntry[]) ?? []).sort((a, b) => a.position - b.position);
    setEntries(all);
    setAbsences((absenceRows as PlanAbsence[]) ?? []);
    const recipeIds = [...new Set(all.map((e) => e.recipe_id).filter((id): id is string => !!id))];
    if (recipeIds.length > 0) {
      const { data: recipeRows } = await supabase
        .from('recipes')
        .select('id, title, cover_image_path, tags, ingredients, dish_type, recipe_translations(locale, title)')
        .in('id', recipeIds);
      const rows = (
        (recipeRows as (HomeRecipe & { recipe_translations: { locale: string; title: string }[] | null })[]) ?? []
      ).map(({ recipe_translations, ...r }) => ({
        ...r,
        title: localizedTitle({ title: r.title, recipe_translations }, locale),
      }));
      setRecipesById(new Map(rows.map((r) => [r.id, r])));
    }
    setLoaded(true);
  }, [householdId, locale, currentWeek]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const eaters = useMemo(() => persons.filter((p) => !p.is_employee), [persons]);
  const eaterIds = useMemo(() => eaters.map((p) => p.id), [eaters]);
  const employee = persons.find((p) => p.is_employee) ?? null;
  const personNameById = useMemo(() => new Map(persons.map((p) => [p.id, p.name])), [persons]);
  const recipeLite = recipesById as unknown as Map<string, RecipeLite>;
  const entriesOf = useCallback((planId: string) => entries.filter((e) => e.meal_plan_id === planId), [entries]);
  const cellsOf = useCallback(
    (planId: string) => buildCells(entriesOf(planId), recipeLite, eaters.length, d.plan.recipeFallback, personNameById),
    [entriesOf, recipeLite, eaters.length, d, personNameById]
  );

  const todayIndex = Math.floor((new Date().setHours(0, 0, 0, 0) - dayDate(currentWeek, 0).getTime()) / 86_400_000);
  const currentPlan = plans.find((p) => p.week_start === currentWeek);
  const lastPlan = plans.find((p) => p.week_start === lastWeek);

  const openWeek = (week: string) => router.push({ pathname: '/plan/detail', params: { week } });
  const openRecipe = (id: string, servings?: number) =>
    router.push({
      pathname: '/recipe/[id]',
      params: servings ? { id, planServings: String(servings) } : { id },
    });
  const shortDate = (week: string) => dayDate(week, 0).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  // ---------- upcoming ----------
  const upcoming = useMemo<UpcomingCell[]>(() => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const thisWeek = currentPlan
      ? cellsOf(currentPlan.id)
          .filter((c) => isMealUpcoming(c.day, c.slot, todayIndex, nowMinutes, mealTimes))
          .map((c) => ({ ...c, weekIso: currentWeek }))
      : [];
    const future = plans
      .filter((p) => p.week_start > currentWeek)
      .sort((a, b) => (a.week_start < b.week_start ? -1 : 1))
      .flatMap((p) =>
        cellsOf(p.id).map((c) => ({
          ...c,
          weekIso: p.week_start,
          dayLabel: dayDate(p.week_start, c.day).toLocaleDateString(locale, { weekday: 'long', day: 'numeric' }),
        }))
      );
    return [...thisWeek, ...future];
  }, [plans, currentPlan, cellsOf, todayIndex, mealTimes, currentWeek, locale]);

  // ---------- weeks ----------
  const currentEntries = useMemo(() => (currentPlan ? entriesOf(currentPlan.id) : []), [currentPlan, entriesOf]);
  const progress = useMemo(() => weekProgress(currentEntries, absences, eaterIds), [currentEntries, absences, eaterIds]);
  const futureWeeks = useMemo(() => {
    const weeks = new Set<string>([addWeeks(currentWeek, 1)]);
    for (const p of plans) if (p.week_start > currentWeek) weeks.add(p.week_start);
    for (const w of ideasByWeek.keys()) if (w > currentWeek) weeks.add(w);
    return [...weeks].sort();
  }, [plans, ideasByWeek, currentWeek]);
  const weekRowLabel = (week: string) => {
    const name =
      week === currentWeek ? d.plan.thisWeek : week === addWeeks(currentWeek, 1) ? d.plan.nextWeek : null;
    return name ? `${name} · ${weekRange(week, locale)}` : weekRange(week, locale);
  };
  const mealsLabel = (n: number) => (n === 1 ? t.mealOne : fmt(t.mealMany, { n }));

  const newWeek = (e?: GestureResponderEvent) =>
    pickOption({
      title: d.plan.planWhichWeek,
      cancelLabel: d.common.cancel,
      anchor: anchorFromEvent(e),
      options: [0, 1, 2, 3].map((delta) => {
        const week = addWeeks(currentWeek, delta);
        const label =
          delta === 0 ? d.plan.thisWeek : delta === 1 ? d.plan.nextWeek : fmt(d.plan.inWeeks, { n: delta });
        return { label: `${label} · ${weekRange(week, locale)}`, onPress: () => openWeek(week) };
      }),
    });

  // ---------- employee ----------
  const employeeDishes = useMemo(
    () =>
      currentEntries
        .filter((e) => e.assigned_cook === 'employee' && (e.recipe_id || e.custom_title))
        .sort((a, b) => byDaySlot(a, b) || a.position - b.position),
    [currentEntries]
  );
  const currentNotes = notesOf(currentPlan);
  const carryOver = useMemo(() => carryOverNotes(currentNotes, notesOf(lastPlan)), [currentNotes, lastPlan]);

  const saveNotes = async (next: string[]) => {
    setNotesOpen(false);
    if (currentPlan) {
      setPlans((prev) => prev.map((p) => (p.id === currentPlan.id ? { ...p, employee_notes: next } : p)));
      const { error } = await supabase.from('meal_plans').update({ employee_notes: next }).eq('id', currentPlan.id);
      if (error) notify(d.common.genericError, '');
      return;
    }
    if (next.length === 0) return;
    const { data, error } = await supabase
      .from('meal_plans')
      .insert({ household_id: householdId, week_start: currentWeek, employee_notes: next })
      .select('id, week_start, status, employee_notes')
      .single();
    if (error || !data) {
      notify(d.common.genericError, '');
      return;
    }
    setPlans((prev) => [data as PlanRow, ...prev]);
  };

  // ---------- past weeks ----------
  const categoryName = (key: string) =>
    key === 'fish'
      ? d.plan.categoryFish
      : key === 'meat'
        ? d.plan.categoryMeat
        : key === 'vegetarian'
          ? d.plan.categoryVeg
          : key === 'legume'
            ? d.plan.categoryLegume
            : d.weekPage.salad;
  const mainsOf = useCallback(
    (planId: string) => {
      const rows = entriesOf(planId);
      return rows.filter((e) => splitSlot(rows, e.day, e.slot).main?.id === e.id).sort(byDaySlot);
    },
    [entriesOf]
  );
  const tallyOf = useCallback(
    (planId: string) =>
      tallyCounts(
        mainsOf(planId).map((e) => {
          const r = e.recipe_id ? recipesById.get(e.recipe_id) : undefined;
          if (!r) return null;
          return isSalad(r) ? 'salad' : resolveProteinCategory(r.tags ?? [], r.ingredients, index);
        })
      ),
    [mainsOf, recipesById, index]
  );
  const pastPlans = useMemo(() => plans.filter((p) => p.week_start < currentWeek), [plans, currentWeek]);
  const pastRowLabel = (week: string) =>
    week === lastWeek ? `${d.weekPage.lastWeek} · ${weekRange(week, locale)}` : weekRange(week, locale);
  const titleOf = (e: HomeEntry) =>
    e.custom_title ?? (e.recipe_id ? recipesById.get(e.recipe_id)?.title : undefined) ?? d.plan.recipeFallback;

  const pastPlan = pastPlans.find((p) => p.id === pastPlanId) ?? null;
  const pastDays = useMemo<PastDay[]>(() => {
    if (!pastPlan) return [];
    const mains = mainsOf(pastPlan.id);
    const dish = (day: number, slot: MealSlot): PastDish | null => {
      const e = mains.find((m) => m.day === day && m.slot === slot);
      return e ? { title: titleOf(e), recipeId: e.recipe_id, employee: e.assigned_cook === 'employee' } : null;
    };
    return Array.from({ length: 7 }, (_, day) => ({
      day,
      label: dayDate(pastPlan.week_start, day).toLocaleDateString(locale, { weekday: 'short' }).replace('.', ''),
      lunch: dish(day, 'lunch'),
      dinner: dish(day, 'dinner'),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastPlan, mainsOf, locale, recipesById]);

  /** iOS can't present an alert/sheet while a modal is still closing. */
  const afterSheet = (fn: () => void) => setTimeout(fn, Platform.OS === 'ios' ? 450 : 0);

  const copyPast = (plan: PlanRow) => {
    const source = entriesOf(plan.id);
    if (source.length === 0) return;
    setPastPlanId(null);
    afterSheet(() =>
      pickOption({
        title: t.copyWhich,
        cancelLabel: d.common.cancel,
        options: [currentWeek, addWeeks(currentWeek, 1)].map((week) => ({
          label: weekRowLabel(week),
          onPress: () => {
            void (async () => {
              const { planId, count } = await weekEntryCount(householdId, week);
              const run = async () => {
                setBusy(true);
                try {
                  const ok = await copyEntriesToWeek(householdId, source, week, planId);
                  if (!ok) {
                    notify(d.common.genericError, '');
                    return;
                  }
                  invalidateLists('plan', 'groceries');
                  openWeek(week);
                } finally {
                  setBusy(false);
                }
              };
              if (count === 0) {
                await run();
                return;
              }
              const name = week === currentWeek ? d.plan.thisWeek : d.plan.nextWeek;
              confirmDestructive({
                title: fmt(t.replaceTitle, { week: name.toLowerCase() }),
                message: fmt(t.replaceBody, { week: name, n: count }),
                confirmLabel: d.plan.replace,
                cancelLabel: d.common.cancel,
                onConfirm: () => void run(),
              });
            })();
          },
        })),
      })
    );
  };

  const deletePast = (plan: PlanRow) => {
    setPastPlanId(null);
    afterSheet(() =>
      confirmDestructive({
        title: d.plan.deletePlanTitle,
        message: fmt(d.plan.deletePlanBody, { week: fmt(d.plan.weekOf, { date: shortDate(plan.week_start) }) }),
        confirmLabel: d.common.delete,
        cancelLabel: d.common.cancel,
        onConfirm: () => {
          void (async () => {
            const { error } = await supabase.from('meal_plans').delete().eq('id', plan.id);
            if (error) {
              notify(d.plan.deletePlanFailTitle, d.common.genericError);
              return;
            }
            setPlans((prev) => prev.filter((p) => p.id !== plan.id));
          })();
        },
      })
    );
  };

  // ---------- render ----------
  const rowStyle = ({ pressed }: { pressed: boolean }) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    minHeight: minTapTarget + 8,
    paddingVertical: 8,
    opacity: pressed ? 0.6 : 1,
  });
  const chevron = <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />;
  const rowTitle = (text: string) => (
    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>{text}</Text>
  );

  const visiblePast = showAllPast ? pastPlans : pastPlans.slice(0, PAST_WEEKS_SHOWN);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: screenPadding,
          paddingBottom: insets.bottom + tabBarClearance,
          gap: 18,
        }}
      >
        <View style={{ paddingVertical: 8, gap: 2 }}>
          <Eyebrow>
            {new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
          </Eyebrow>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Title style={{ flex: 1 }}>{d.plan.mealPlans}</Title>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={d.weekPage.saveIdeaA11y}
              onPress={() => setIdeaSheetOpen(true)}
              style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="bulb-outline" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {!loaded ? <Loading /> : null}

        {loaded ? (
          <>
            {/* Up next + coming up */}
            {upcoming.length > 0 ? (
              <UpNextCard
                cell={upcoming[0]!}
                when={mealWhen(upcoming[0]!)}
                onOpenRecipe={openRecipe}
                onPress={() => openWeek(upcoming[0]!.weekIso ?? currentWeek)}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => openWeek(currentWeek)}
                style={({ pressed }) => ({
                  minHeight: 110,
                  borderRadius: radius.card * 2,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: pressed ? colors.cardPressed : 'transparent',
                })}
              >
                <Muted>{t.nothingNext}</Muted>
                <Text style={{ color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>
                  {t.planThisWeek}
                </Text>
              </Pressable>
            )}

            {upcoming.length > 1 ? (
              <View style={{ gap: 12 }}>
                <SectionHeader title={t.comingUp} linkLabel={t.thisWeekLink} onLinkPress={() => openWeek(currentWeek)} />
                <UpcomingMealsStrip
                  cells={upcoming.slice(1, 15)}
                  todayIndex={todayIndex}
                  markFirst={false}
                  onPressCell={(cell) =>
                    cell.recipeIds.length === 1
                      ? openRecipe(cell.recipeIds[0]!, cell.servings[0])
                      : openWeek(cell.weekIso ?? currentWeek)
                  }
                />
              </View>
            ) : null}

            {/* Weeks */}
            <View style={{ gap: 8 }}>
              <SectionHeader title={t.weeks} linkLabel={t.newWeek} onLinkPress={() => newWeek()} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={weekRowLabel(currentWeek)}
                onPress={() => openWeek(currentWeek)}
                style={({ pressed }) => ({
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.card * 1.5,
                  padding: 14,
                  gap: 8,
                  backgroundColor: pressed ? colors.cardPressed : colors.bg,
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>{rowTitle(weekRowLabel(currentWeek))}</View>
                  {currentPlan ? (
                    <Badge label={currentPlan.status === 'approved' ? d.weekPage.approved : d.weekPage.draft} />
                  ) : null}
                </View>
                {progress.total > 0 ? (
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.bgGrouped, overflow: 'hidden' }}>
                    <View
                      style={{
                        width: `${Math.round((progress.planned / progress.total) * 100)}%`,
                        height: 6,
                        backgroundColor: colors.text,
                      }}
                    />
                  </View>
                ) : null}
                <Muted>
                  {progress.planned === 0
                    ? t.weekEmpty
                    : progress.planned < progress.total
                      ? fmt(t.progressLeft, {
                          planned: progress.planned,
                          total: progress.total,
                          left: progress.total - progress.planned,
                        })
                      : fmt(t.allPlanned, { total: progress.total })}
                </Muted>
              </Pressable>
              {futureWeeks.map((week) => {
                const plan = plans.find((p) => p.week_start === week);
                const meals = plan ? cellsOf(plan.id).length : 0;
                const ideas = ideasByWeek.get(week) ?? 0;
                const sub = [
                  meals > 0 ? mealsLabel(meals) : null,
                  ideas > 0 ? (ideas === 1 ? t.ideaOne : fmt(t.ideaMany, { n: ideas })) : null,
                ].filter(Boolean);
                return (
                  <Pressable
                    key={week}
                    accessibilityRole="button"
                    accessibilityLabel={weekRowLabel(week)}
                    onPress={() => openWeek(week)}
                    style={rowStyle}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      {rowTitle(weekRowLabel(week))}
                      <Muted>{sub.length > 0 ? sub.join(' · ') : t.weekEmpty}</Muted>
                    </View>
                    {chevron}
                  </Pressable>
                );
              })}
            </View>

            {/* Employee this week */}
            {employee ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.bgGrouped,
                  borderRadius: radius.card * 1.5,
                  padding: 14,
                  gap: 10,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.displaySemi, fontSize: 20 }}>
                    {fmt(t.employeeThisWeek, { name: employee.name })}
                  </Text>
                  {employeeDishes.length > 0 && todayIndex <= EMPLOYEE_COOK_DAY ? (
                    <Badge label={fmt(t.cooksOn, { day: d.common.days[EMPLOYEE_COOK_DAY]!.toLowerCase() })} />
                  ) : null}
                </View>
                {employeeDishes.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    <Eyebrow>{fmt(t.prepares, { n: employeeDishes.length })}</Eyebrow>
                    {employeeDishes.map((e) => {
                      const r = e.recipe_id ? recipesById.get(e.recipe_id) : undefined;
                      const how = e.cook_part
                        ? e.instructions
                          ? fmt(d.weekPage.partLine, { note: e.instructions })
                          : d.weekPage.partOfIt
                        : d.weekPage.wholeDish;
                      return (
                        <Pressable
                          key={e.id}
                          accessibilityRole="button"
                          onPress={() => (e.recipe_id ? openRecipe(e.recipe_id) : openWeek(currentWeek))}
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                            opacity: pressed ? 0.6 : 1,
                          })}
                        >
                          <RecipeImage
                            path={r?.cover_image_path ?? null}
                            style={{ width: 44, height: 44, borderRadius: radius.thumb }}
                            iconSize={16}
                          />
                          <View style={{ flex: 1, gap: 1 }}>
                            <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.base }}>
                              {titleOf(e)}
                            </Text>
                            <Muted numberOfLines={2}>
                              {`${d.common.days[e.day]} · ${slotLabel(e.slot)} · ${how}`}
                            </Muted>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <Muted>{fmt(t.nothingForEmployee, { name: employee.name })}</Muted>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Eyebrow>{t.instructions}</Eyebrow>
                  </View>
                  <LinkButton
                    label={currentNotes.length > 0 ? t.edit : t.addInstructions}
                    onPress={() => setNotesOpen(true)}
                    textStyle={{ fontSize: fontSize.small }}
                  />
                </View>
                {currentNotes.length > 0 ? (
                  <View style={{ gap: 6 }}>
                    {currentNotes.map((note, i) => (
                      <View key={`${i}-${note}`} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                        <Text style={{ color: colors.textMuted, fontSize: fontSize.base }}>•</Text>
                        <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.base }}>
                          {note}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Muted>{t.noInstructions}</Muted>
                )}
                {employee.share_token ? (
                  <Button
                    label={fmt(d.weekPage.sendLink, { name: employee.name })}
                    kind="secondary"
                    onPress={() => void shareEmployeeLink(employee.share_token!, d.common.linkCopied)}
                  />
                ) : null}
              </View>
            ) : null}

            {/* Past weeks */}
            <View style={{ gap: 4 }}>
              <SectionHeader title={d.plan.pastWeeks} />
              {pastPlans.length === 0 ? <Muted>{t.pastEmpty}</Muted> : null}
              {visiblePast.map((plan) => {
                const mains = mainsOf(plan.id);
                const covers = mains
                  .map((e) => (e.recipe_id ? recipesById.get(e.recipe_id)?.cover_image_path : null))
                  .filter((c): c is string => !!c)
                  .slice(0, 4);
                const meals = cellsOf(plan.id).length;
                const tally = tallyOf(plan.id)
                  .slice(0, 3)
                  .map((c) => `${categoryName(c.key)} ${c.n}`);
                const dishes = entriesOf(plan.id).filter((e) => e.assigned_cook === 'employee').length;
                const tasks = notesOf(plan).length;
                const employeeLine =
                  employee && (dishes > 0 || tasks > 0)
                    ? `${employee.name}: ${[
                        dishes > 0 ? (dishes === 1 ? t.dishOne : fmt(t.dishMany, { n: dishes })) : null,
                        tasks > 0 ? (tasks === 1 ? t.taskOne : fmt(t.taskMany, { n: tasks })) : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}`
                    : null;
                return (
                  <Pressable
                    key={plan.id}
                    accessibilityRole="button"
                    accessibilityLabel={pastRowLabel(plan.week_start)}
                    onPress={() => setPastPlanId(plan.id)}
                    style={rowStyle}
                  >
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: radius.card * 1.25,
                        overflow: 'hidden',
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        alignContent: 'space-between',
                      }}
                    >
                      {covers.length <= 1 ? (
                        <RecipeImage path={covers[0] ?? null} style={{ width: 64, height: 64 }} iconSize={18} />
                      ) : (
                        [0, 1, 2, 3].map((n) => (
                          <RecipeImage
                            key={n}
                            path={covers[n] ?? null}
                            style={{ width: '48.5%', height: '48.5%' }}
                            iconSize={10}
                          />
                        ))
                      )}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      {rowTitle(pastRowLabel(plan.week_start))}
                      <Muted numberOfLines={1}>{[mealsLabel(meals), ...tally].join(' · ')}</Muted>
                      {employeeLine ? <Muted numberOfLines={1}>{employeeLine}</Muted> : null}
                    </View>
                    {chevron}
                  </Pressable>
                );
              })}
              {!showAllPast && pastPlans.length > PAST_WEEKS_SHOWN ? (
                <LinkButton label={t.showOlder} onPress={() => setShowAllPast(true)} />
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      <PastWeekSheet
        visible={!!pastPlan}
        title={pastPlan ? fmt(d.plan.weekOf, { date: shortDate(pastPlan.week_start) }) : ''}
        subtitle={
          pastPlan
            ? `${pastPlan.status === 'approved' ? d.weekPage.approved : d.weekPage.draft} · ${mealsLabel(
                cellsOf(pastPlan.id).length
              )}`
            : ''
        }
        tally={pastPlan ? tallyOf(pastPlan.id).map((c) => `${categoryName(c.key)} ${c.n}`) : []}
        days={pastDays}
        notes={notesOf(pastPlan ?? undefined)}
        busy={busy}
        onOpenRecipe={(id) => {
          setPastPlanId(null);
          afterSheet(() => openRecipe(id));
        }}
        onCopy={() => pastPlan && copyPast(pastPlan)}
        onOpenWeek={() => {
          if (!pastPlan) return;
          const week = pastPlan.week_start;
          setPastPlanId(null);
          afterSheet(() => openWeek(week));
        }}
        onDelete={() => pastPlan && deletePast(pastPlan)}
        onClose={() => setPastPlanId(null)}
      />

      {employee ? (
        <InstructionsSheet
          visible={notesOpen}
          title={fmt(t.instructionsTitle, { name: employee.name })}
          subtitle={fmt(d.plan.weekOf, { date: shortDate(currentWeek) })}
          notes={currentNotes}
          carryOver={carryOver}
          onSave={(next) => void saveNotes(next)}
          onClose={() => setNotesOpen(false)}
        />
      ) : null}

      <IdeaSheet
        visible={ideaSheetOpen}
        initialWeek={addWeeks(currentWeek, 1)}
        onClose={() => setIdeaSheetOpen(false)}
        onSaved={() => void load()}
      />
    </SafeAreaView>
  );
}
