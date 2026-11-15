// The one-page week planner (design A, 2026-11-15), opened from the Meal
// plans home (plan/index) at plan/detail: week chips on top, a progress
// line, compact day rows, and sheets for adding a meal, its details, who's
// home and the review/approve hand-off.

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddToWeekSheet } from '@/components/add-to-week';
import { LiveCard } from '@/components/ai-week-live';
import { AiWeekPlanner, type PlannerContext } from '@/components/ai-week-planner';
import { IdeaSheet } from '@/components/idea-sheet';
import { Button, Eyebrow, Loading, Title } from '@/components/ui';
import { useWeekSummaries } from '@/components/week-chips';
import { AddMealSheet, type AddPick, type AddRecipe } from '@/components/week/add-meal-sheet';
import { DayRows } from '@/components/week/day-rows';
import { HomeSheet, type AwayChange } from '@/components/week/home-sheet';
import { MealSheet, type MealPatch } from '@/components/week/meal-sheet';
import { ReviewSheet, type ReviewItem } from '@/components/week/review-sheet';
import { Badge, Pill } from '@/components/week/sheet';
import { findSchoolChild, isSalad, sideSuggestions } from '@/lib/ai-week';
import { useHousehold } from '@/lib/auth';
import type { AutoCandidate } from '@/lib/auto-plan';
import { matchCanonical, normalizeRaw } from '@/lib/canonical';
import { looksLikeDessert, resolveProteinCategory, type ProteinCategory } from '@/lib/category';
import { confirmDestructive, notify } from '@/lib/confirm';
import { normalizeDietProfile } from '@/lib/diet';
import { shareEmployeeLink } from '@/lib/employee-link';
import { computeRecipeFodmap, recipeFodmapTier } from '@/lib/fodmap';
import { fmt, useI18n } from '@/lib/i18n';
import { invalidateLists } from '@/lib/list-refresh';
import { backOr } from '@/lib/nav';
import { pickOption } from '@/lib/options';
import {
  addWeeks,
  awayIds,
  dayDate,
  effectivePersonIds,
  plannedEvents,
  slotEntries,
  upsertEntryPayload,
  weekStart,
  type MealSlot,
  type PlanAbsence,
  type PlanEntry,
} from '@/lib/plan';
import { copyEntriesToWeek, weekEntryCount } from '@/lib/plan-copy';
import type { PlanIdea } from '@/lib/plan-ideas';
import { quotaProgress } from '@/lib/quotas';
import { supabase } from '@/lib/supabase';
import {
  floatingActionOffset,
  fonts,
  fontSize,
  minTapTarget,
  screenPadding,
  tabBarClearance,
  useTheme,
} from '@/lib/theme';
import { localizedTitle } from '@/lib/translations';
import { useCanonicalIndex } from '@/lib/use-canonical';
import { addSuggestions, chipWeeks, openMeals, splitSlot, weekProgress } from '@/lib/week-page';
import type { IngredientRow as IngredientData } from '@/lib/worker';

interface Person {
  id: string;
  name: string;
  is_employee: boolean;
  diet_profile: unknown;
  avatar_color?: string | null;
  share_token?: string | null;
}

interface RecipeLite {
  id: string;
  title: string;
  tags: string[];
  needs_review: boolean;
  cover_image_path: string | null;
  ingredients?: IngredientData[];
  prep_minutes: number | null;
  cook_minutes: number | null;
  servings: number | null;
  fodmap_override?: 'low' | 'moderate' | 'high' | null;
  meal_type?: 'main' | 'breakfast' | 'dessert' | 'side' | null;
  dish_type?: string | null;
}

interface MealPlanRow {
  id: string;
  week_start: string;
  status: 'draft' | 'approved';
  employee_notes: string[] | null;
}

type AddTarget =
  | { mode: 'add'; day: number; slot: MealSlot }
  | { mode: 'side'; entry: PlanEntry }
  | { mode: 'swap'; entry: PlanEntry };

const PLAN_COLUMNS = 'id, week_start, status, employee_notes';

export function WeekPage({ showBack = false }: { showBack?: boolean }) {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const t = d.weekPage;
  const { householdId } = useHousehold();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const index = useCanonicalIndex();
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);

  const currentWeek = weekStart(new Date());
  const { week: weekParam } = useLocalSearchParams<{ week?: string }>();
  const [weekIso, setWeekIso] = useState(() =>
    weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : currentWeek
  );
  useEffect(() => {
    if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) setWeekIso(weekParam);
  }, [weekParam]);

  const [plan, setPlan] = useState<MealPlanRow | null>(null);
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [absences, setAbsences] = useState<PlanAbsence[]>([]);
  const [ideas, setIdeas] = useState<PlanIdea[]>([]);
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
  const [persons, setPersons] = useState<Person[]>([]);
  const [recipes, setRecipes] = useState<RecipeLite[]>([]);
  /** Latest past week_start each recipe was planned (freshness for suggestions). */
  const [lastPlanned, setLastPlanned] = useState<Map<string, string>>(new Map());
  /** Future weeks that already hold meals or ideas (extra chips). */
  const [laterWeeks, setLaterWeeks] = useState<string[]>([]);
  const [olderWeeks, setOlderWeeks] = useState<string[]>([]);
  const [summaryKey, setSummaryKey] = useState(0);
  const [busy, setBusy] = useState(false);

  // Sheets
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [homeOpen, setHomeOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [ideaSheetOpen, setIdeaSheetOpen] = useState(false);
  const [ideaToPlan, setIdeaToPlan] = useState<PlanIdea | null>(null);
  const [liveSummary, setLiveSummary] = useState<{ meals: number; employee: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; entryId: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadWeek = useCallback(
    async (week: string) => {
      const [{ data: planRow }, { data: ideaRows }] = await Promise.all([
        supabase
          .from('meal_plans')
          .select(PLAN_COLUMNS)
          .eq('household_id', householdId)
          .eq('week_start', week)
          .maybeSingle(),
        supabase
          .from('plan_ideas')
          .select('*')
          .eq('household_id', householdId)
          .eq('week_start', week)
          .order('created_at'),
      ]);
      setIdeas((ideaRows as PlanIdea[]) ?? []);
      setPlan((planRow as MealPlanRow) ?? null);
      if (planRow) {
        const [{ data: entryRows }, { data: absenceRows }] = await Promise.all([
          supabase.from('plan_entries').select('*').eq('meal_plan_id', planRow.id),
          supabase.from('plan_absences').select('day, slot, person_id').eq('meal_plan_id', planRow.id),
        ]);
        setEntries((entryRows as PlanEntry[]) ?? []);
        setAbsences((absenceRows as PlanAbsence[]) ?? []);
      } else {
        setEntries([]);
        setAbsences([]);
      }
      setLoadedWeek(week);
      setSummaryKey((k) => k + 1);
    },
    [householdId]
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [{ data: personRows }, { data: recipeRows }, { data: historyRows }, { data: planRows }, { data: ideaWeeks }] =
          await Promise.all([
            supabase
              .from('persons')
              .select('id, name, is_employee, diet_profile, avatar_color, share_token')
              .eq('household_id', householdId)
              .order('created_at'),
            supabase
              .from('recipes')
              .select(
                'id, title, tags, needs_review, cover_image_path, ingredients, prep_minutes, cook_minutes, servings, fodmap_override, meal_type, dish_type, recipe_translations(locale, title)'
              )
              .eq('household_id', householdId)
              .order('title'),
            supabase
              .from('plan_entries')
              .select('recipe_id, meal_plans!inner(household_id, week_start)')
              .eq('meal_plans.household_id', householdId),
            supabase.from('meal_plans').select('week_start').eq('household_id', householdId),
            supabase
              .from('plan_ideas')
              .select('week_start')
              .eq('household_id', householdId)
              .gte('week_start', currentWeek),
          ]);
        if (cancelled) return;
        setPersons((personRows as Person[]) ?? []);
        setRecipes(
          (
            (recipeRows as (RecipeLite & { recipe_translations: { locale: string; title: string }[] | null })[]) ?? []
          ).map(({ recipe_translations, ...r }) => ({
            ...r,
            title: localizedTitle({ title: r.title, recipe_translations }, locale),
          }))
        );
        const last = new Map<string, string>();
        for (const row of (historyRows ?? []) as unknown as {
          recipe_id: string | null;
          meal_plans: { week_start: string };
        }[]) {
          const week = row.meal_plans.week_start;
          if (!row.recipe_id || week >= currentWeek) continue;
          const prev = last.get(row.recipe_id);
          if (!prev || week > prev) last.set(row.recipe_id, week);
        }
        setLastPlanned(last);
        const planWeeks = ((planRows ?? []) as { week_start: string }[]).map((p) => p.week_start);
        setLaterWeeks([
          ...new Set([
            ...planWeeks.filter((w) => w > currentWeek),
            ...((ideaWeeks ?? []) as { week_start: string }[]).map((i) => i.week_start),
          ]),
        ]);
        setOlderWeeks(planWeeks.filter((w) => w < addWeeks(currentWeek, -1)).sort().reverse());
        await loadWeek(weekIso);
      })();
      return () => {
        cancelled = true;
      };
    }, [householdId, weekIso, loadWeek, locale, currentWeek])
  );

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const eaters = useMemo(() => persons.filter((p) => !p.is_employee), [persons]);
  const eaterIds = useMemo(() => eaters.map((p) => p.id), [eaters]);
  const employee = persons.find((p) => p.is_employee) ?? null;
  const schoolChild = useMemo(() => findSchoolChild(persons), [persons]);
  const isPastWeek = weekIso < currentWeek;
  const loaded = loadedWeek === weekIso;
  const todayIndex = Array.from({ length: 7 }, (_, day) => day).findIndex(
    (day) => dayDate(weekIso, day).toDateString() === new Date().toDateString()
  );

  const titleOf = (e: Pick<PlanEntry, 'custom_title' | 'recipe_id'>) =>
    e.custom_title ?? (e.recipe_id ? recipeById.get(e.recipe_id)?.title : undefined) ?? d.plan.recipeFallback;
  const ideaTitle = (idea: PlanIdea) =>
    idea.custom_title ?? (idea.recipe_id ? recipeById.get(idea.recipe_id)?.title : undefined) ?? d.plan.recipeFallback;
  const categoryOf = useCallback(
    (r: RecipeLite) => resolveProteinCategory(r.tags, r.ingredients, index),
    [index]
  );

  // ---------- chips ----------
  const chips = useMemo(() => chipWeeks(currentWeek, laterWeeks), [currentWeek, laterWeeks]);
  const summaries = useWeekSummaries(householdId, chips, true, summaryKey);
  const shortDate = (week: string) =>
    dayDate(week, 0).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const chipLabel = (week: string) =>
    week === currentWeek
      ? d.plan.thisWeek
      : week === addWeeks(currentWeek, 1)
        ? d.plan.nextWeek
        : week === addWeeks(currentWeek, -1)
          ? t.lastWeek
          : shortDate(week);
  const chipSub = (week: string) => {
    const s = summaries.get(week);
    if (s && s.meals > 0) return fmt(t.chipMeals, { n: s.meals });
    if (s && s.ideas > 0) return fmt(t.chipIdeas, { n: s.ideas });
    if (week === currentWeek || week === addWeeks(currentWeek, 1)) {
      return `${shortDate(week)} – ${dayDate(week, 6).toLocaleDateString(locale, { day: 'numeric' })}`;
    }
    return t.chipEmpty;
  };

  // ---------- progress & balance ----------
  const progress = useMemo(() => weekProgress(entries, absences, eaterIds), [entries, absences, eaterIds]);
  const open = useMemo(
    () => (isPastWeek ? [] : openMeals(entries, absences, eaterIds, weekIso)),
    [entries, absences, eaterIds, weekIso, isPastWeek]
  );

  const quotaChips = useMemo(() => {
    if (eaters.length === 0) return [];
    const quotaRecipes = recipes.map((r) => ({ ...r, category: categoryOf(r) }));
    const perPerson = eaters.map((person) =>
      quotaProgress(entries, person.id, quotaRecipes, normalizeDietProfile(person.diet_profile).proteinQuotas.targets)
    );
    const categories = new Set(perPerson.flat().map((p) => p.category));
    const out: { category: ProteinCategory; planned: number; target: number }[] = [];
    for (const category of ['meat', 'fish', 'vegetarian', 'legume'] as ProteinCategory[]) {
      if (!categories.has(category)) continue;
      const rows = perPerson
        .map((p) => p.find((row) => row.category === category))
        .filter((row) => row !== undefined);
      const target = Math.max(...rows.map((r) => r.min));
      if (target <= 0) continue;
      out.push({ category, planned: Math.min(...rows.map((r) => r.planned)), target });
    }
    return out;
  }, [eaters, entries, recipes, categoryOf]);

  const categoryName = (category: string) =>
    category === 'fish'
      ? d.plan.categoryFish
      : category === 'meat'
        ? d.plan.categoryMeat
        : category === 'vegetarian'
          ? d.plan.categoryVeg
          : category === 'legume'
            ? d.plan.categoryLegume
            : t.salad;

  const mains = useMemo(
    () => recipes.filter((r) => (r.meal_type ?? 'main') === 'main' && !looksLikeDessert(r.dish_type, r.tags)),
    [recipes]
  );
  const weeksSince = useCallback(
    (id: string) => {
      const last = lastPlanned.get(id);
      return last === undefined
        ? null
        : Math.max(0, Math.round((Date.parse(currentWeek) - Date.parse(last)) / 604_800_000));
    },
    [lastPlanned, currentWeek]
  );
  const toAddRecipe = useCallback(
    (r: RecipeLite): AddRecipe => ({
      id: r.id,
      title: r.title,
      cover_image_path: r.cover_image_path,
      category: categoryOf(r),
      isSalad: isSalad(r),
      weeksSince: weeksSince(r.id),
      totalMinutes:
        r.prep_minutes == null && r.cook_minutes == null ? null : (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0),
    }),
    [categoryOf, weeksSince]
  );
  const addRecipes = useMemo(() => mains.map(toAddRecipe), [mains, toAddRecipe]);
  const allAddRecipes = useMemo(() => recipes.map(toAddRecipe), [recipes, toAddRecipe]);

  const mainEntries = useMemo(() => entries.filter((e) => splitSlot(entries, e.day, e.slot).main?.id === e.id), [entries]);
  const saladCount = mainEntries.filter((e) => e.recipe_id && recipeById.get(e.recipe_id) && isSalad(recipeById.get(e.recipe_id)!)).length;
  const missing = useMemo(() => {
    const short = quotaChips.filter((q) => q.planned < q.target).map((q) => q.category as string);
    return short.length > 0 ? short : saladCount === 0 ? ['salad'] : [];
  }, [quotaChips, saladCount]);

  const ideaIdByRecipe = useMemo(
    () => new Map(ideas.filter((i) => i.recipe_id).map((i) => [i.recipe_id!, i.id])),
    [ideas]
  );
  const suggestions = useMemo(() => {
    if (addTarget?.mode === 'side') {
      return { ideas: [], gaps: sideSuggestions(recipes, '', 6).map((r) => r.id), recent: [] };
    }
    return addSuggestions({
      recipes: addRecipes,
      ideaRecipeIds: ideas.map((i) => i.recipe_id).filter((id): id is string => !!id),
      plannedRecipeIds: new Set(entries.map((e) => e.recipe_id).filter((id): id is string => !!id)),
      missing,
    });
  }, [addTarget, recipes, addRecipes, ideas, entries, missing]);

  const tally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of mainEntries) {
      const r = e.recipe_id ? recipeById.get(e.recipe_id) : undefined;
      if (!r) continue;
      const key = isSalad(r) ? 'salad' : categoryOf(r);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return ['meat', 'fish', 'vegetarian', 'legume', 'salad']
      .filter((k) => counts.has(k))
      .map((k) => `${categoryName(k)} ${counts.get(k)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainEntries, recipeById, categoryOf, d]);

  // ---------- writes ----------
  const reload = async () => {
    await loadWeek(weekIso);
    invalidateLists('plan', 'groceries');
  };

  const ensurePlan = async (): Promise<string> => {
    if (plan) return plan.id;
    const { data, error } = await supabase
      .from('meal_plans')
      .insert({ household_id: householdId, week_start: weekIso })
      .select(PLAN_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Could not create the week');
    setPlan(data as MealPlanRow);
    return (data as MealPlanRow).id;
  };

  /**
   * Open the next sheet once the current one has finished closing: iOS can't
   * present a modal while another is still animating out.
   */
  const afterSheet = (fn: () => void) => {
    if (Platform.OS === 'ios') setTimeout(fn, 450);
    else fn();
  };

  const showToast = (text: string, entryId: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, entryId });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };

  const onPick = async (pick: AddPick) => {
    const target = addTarget;
    if (!target) return;
    setAddTarget(null);
    const choice = 'recipeId' in pick ? { recipe_id: pick.recipeId, custom_title: null } : { recipe_id: null, custom_title: pick.customTitle };
    const pickedTitle = 'recipeId' in pick ? (recipeById.get(pick.recipeId)?.title ?? '') : pick.customTitle;
    try {
      if (target.mode === 'swap') {
        await supabase.from('plan_entries').update(choice).eq('id', target.entry.id);
        afterSheet(() => setOpenEntryId(target.entry.id));
      } else if (target.mode === 'side') {
        const rows = slotEntries(entries, target.entry.day, target.entry.slot);
        const position = Math.max(...rows.map((r) => r.position), 0) + 1;
        await supabase.from('plan_entries').insert(
          upsertEntryPayload({
            mealPlanId: target.entry.meal_plan_id,
            day: target.entry.day,
            slot: target.entry.slot,
            ...('recipeId' in pick ? { recipeId: pick.recipeId } : { customTitle: pick.customTitle }),
            personIds: target.entry.person_ids,
            guestCount: target.entry.guest_count,
            assignedCook: 'family',
            position,
          })
        );
        afterSheet(() => setOpenEntryId(target.entry.id));
      } else {
        const mealPlanId = await ensurePlan();
        const position = slotEntries(entries, target.day, target.slot).length;
        const personIds = effectivePersonIds([], eaterIds, awayIds(absences, target.day, target.slot));
        const { data } = await supabase
          .from('plan_entries')
          .insert(
            upsertEntryPayload({
              mealPlanId,
              day: target.day,
              slot: target.slot,
              ...('recipeId' in pick ? { recipeId: pick.recipeId } : { customTitle: pick.customTitle }),
              personIds,
              guestCount: 0,
              assignedCook: 'family',
              position,
            })
          )
          .select('id')
          .single();
        if (data) showToast(fmt(t.added, { title: pickedTitle }), (data as { id: string }).id);
      }
      if (pick.ideaId) await supabase.from('plan_ideas').delete().eq('id', pick.ideaId);
    } catch {
      notify(d.common.genericError, '');
    }
    await reload();
  };

  const openEntry = entries.find((e) => e.id === openEntryId) ?? null;
  const openSides = openEntry ? splitSlot(entries, openEntry.day, openEntry.slot).sides : [];

  const saveEntry = async (patch: MealPatch) => {
    const entry = openEntry;
    setOpenEntryId(null);
    if (!entry) return;
    const unchanged =
      JSON.stringify(entry.person_ids) === JSON.stringify(patch.person_ids) &&
      entry.guest_count === patch.guest_count &&
      entry.assigned_cook === patch.assigned_cook &&
      !!entry.cook_part === patch.cook_part &&
      (entry.instructions ?? null) === patch.instructions;
    if (unchanged) return;
    await supabase.from('plan_entries').update(patch).eq('id', entry.id);
    // Sides feed the same people.
    if (openSides.length > 0) {
      await supabase
        .from('plan_entries')
        .update({ person_ids: patch.person_ids, guest_count: patch.guest_count })
        .in(
          'id',
          openSides.map((s) => s.id)
        );
    }
    await reload();
  };

  const removeMeal = async () => {
    const entry = openEntry;
    setOpenEntryId(null);
    if (!entry) return;
    await supabase
      .from('plan_entries')
      .delete()
      .in('id', [entry.id, ...openSides.map((s) => s.id)]);
    await reload();
  };

  const removeSide = async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await supabase.from('plan_entries').delete().eq('id', id);
    invalidateLists('plan', 'groceries');
  };

  const applyAway = async (changes: AwayChange[]) => {
    if (changes.length === 0) return;
    const key = (a: { day: number; slot: MealSlot; personId?: string; person_id?: string }) =>
      `${a.day}-${a.slot}-${a.personId ?? a.person_id}`;
    const before = absences;
    let next = [...absences];
    for (const c of changes) {
      next = next.filter((a) => key(a) !== key(c));
      if (c.away) next.push({ day: c.day, slot: c.slot, person_id: c.personId });
    }
    setAbsences(next);
    try {
      const mealPlanId = await ensurePlan();
      const adds = changes.filter((c) => c.away);
      const removes = changes.filter((c) => !c.away);
      const results = await Promise.all([
        adds.length > 0
          ? supabase.from('plan_absences').upsert(
              adds.map((c) => ({ meal_plan_id: mealPlanId, day: c.day, slot: c.slot, person_id: c.personId })),
              { onConflict: 'meal_plan_id,day,slot,person_id', ignoreDuplicates: true }
            )
          : Promise.resolve({ error: null }),
        ...removes.map((c) =>
          supabase
            .from('plan_absences')
            .delete()
            .eq('meal_plan_id', mealPlanId)
            .eq('day', c.day)
            .eq('slot', c.slot)
            .eq('person_id', c.personId)
        ),
      ]);
      if (results.some((r) => r.error)) setAbsences(before);
    } catch {
      setAbsences(before);
    }
  };

  const saveTasks = async (next: string[]) => {
    const id = await ensurePlan();
    setPlan((p) => (p ? { ...p, employee_notes: next } : p));
    await supabase.from('meal_plans').update({ employee_notes: next }).eq('id', id);
  };

  const sendLink = () => {
    if (employee?.share_token) void shareEmployeeLink(employee.share_token, d.common.linkCopied);
  };

  const approve = async (send: boolean) => {
    if (!plan) return;
    setBusy(true);
    try {
      if (plan.status === 'draft') {
        await supabase.from('meal_plans').update({ status: 'approved' }).eq('id', plan.id);
        const events = plannedEvents(entries, householdId, eaterIds, weekIso);
        if (events.length > 0) await supabase.from('events').insert(events);
      }
      setReviewOpen(false);
      await loadWeek(weekIso);
      if (send) sendLink();
    } finally {
      setBusy(false);
    }
  };

  const copyToCurrentWeek = async () => {
    const source = entries;
    if (source.length === 0) return;
    const { planId, count } = await weekEntryCount(householdId, currentWeek);
    const run = async () => {
      setBusy(true);
      try {
        if (!(await copyEntriesToWeek(householdId, source, currentWeek, planId))) return;
        invalidateLists('plan', 'groceries');
        setWeekIso(currentWeek);
      } finally {
        setBusy(false);
      }
    };
    if (count > 0) {
      confirmDestructive({
        title: d.plan.replaceWeekTitle,
        message: count === 1 ? d.plan.replaceWeekBodyOne : fmt(d.plan.replaceWeekBodyMany, { count }),
        confirmLabel: d.plan.replace,
        cancelLabel: d.common.cancel,
        onConfirm: () => void run(),
      });
      return;
    }
    await run();
  };

  const deleteWeek = () => {
    if (!plan) return;
    confirmDestructive({
      title: d.plan.deletePlanTitle,
      message: fmt(d.plan.deletePlanBody, { week: fmt(d.plan.weekOf, { date: shortDate(weekIso) }) }),
      confirmLabel: d.common.delete,
      cancelLabel: d.common.cancel,
      onConfirm: () => {
        void (async () => {
          const { error } = await supabase.from('meal_plans').delete().eq('id', plan.id);
          if (error) {
            notify(d.plan.deletePlanFailTitle, d.common.genericError);
            return;
          }
          setOlderWeeks((prev) => prev.filter((w) => w !== weekIso));
          await reload();
        })();
      },
    });
  };

  const openOlder = () =>
    pickOption({
      title: t.olderTitle,
      cancelLabel: d.common.cancel,
      options: olderWeeks.slice(0, 12).map((week) => ({
        label: fmt(d.plan.weekOf, { date: shortDate(week) }),
        onPress: () => setWeekIso(week),
      })),
    });

  const loadPlannerContext = async (): Promise<PlannerContext> => {
    const { data: hh } = await supabase.from('households').select('suggested_rest_weeks').eq('id', householdId).single();
    const candidates: AutoCandidate[] = mains.map((r) => {
      const lines = (r.ingredients ?? []).map((ing) => ({
        raw: ing.raw || ing.name,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
      }));
      const computed =
        index && lines.length > 0
          ? recipeFodmapTier(
              computeRecipeFodmap(lines, r.servings ?? null, (line) => matchCanonical(normalizeRaw(line.raw), index)?.ingredient ?? null)
            )
          : 'check';
      const last = lastPlanned.get(r.id);
      return {
        id: r.id,
        category: categoryOf(r),
        fodmapTier: r.fodmap_override ?? computed,
        weeksSincePlanned:
          last !== undefined && last < weekIso
            ? Math.max(0, Math.round((Date.parse(weekIso) - Date.parse(last)) / 604_800_000))
            : null,
        totalMinutes:
          r.prep_minutes == null && r.cook_minutes == null ? null : (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0),
      };
    });
    const quotaMap = new Map<string, { min: number; max: number | null }>();
    for (const person of eaters) {
      for (const target of normalizeDietProfile(person.diet_profile).proteinQuotas.targets) {
        const agg = quotaMap.get(target.category) ?? { min: 0, max: null };
        agg.min = Math.max(agg.min, target.min ?? 0);
        if (target.max !== null) agg.max = agg.max === null ? target.max : Math.min(agg.max, target.max);
        quotaMap.set(target.category, agg);
      }
    }
    return {
      candidates,
      quotas: [...quotaMap.entries()].map(([category, q]) => ({ category, ...q })),
      restWeeks: hh?.suggested_rest_weeks ?? 3,
    };
  };

  // ---------- derived UI bits ----------
  const addTitle = (() => {
    if (!addTarget) return '';
    if (addTarget.mode === 'add') return `${d.common.days[addTarget.day]} · ${slotLabel(addTarget.slot)}`;
    if (addTarget.mode === 'side') return fmt(t.sideTitle, { title: titleOf(addTarget.entry) });
    return fmt(t.swapTitle, { title: titleOf(addTarget.entry) });
  })();
  const addSubtitle = (() => {
    if (!addTarget) return undefined;
    const day = addTarget.mode === 'add' ? addTarget.day : addTarget.entry.day;
    const slot = addTarget.mode === 'add' ? addTarget.slot : addTarget.entry.slot;
    const away = awayIds(absences, day, slot);
    const names = eaters.filter((p) => away.has(p.id)).map((p) => p.name);
    return names.length > 0 ? fmt(t.someAway, { names: names.join(', ') }) : t.everyoneHome;
  })();

  const reviewItems: ReviewItem[] = entries
    .filter((e) => e.assigned_cook === 'employee')
    .sort((a, b) => a.day - b.day || (a.slot === b.slot ? a.position - b.position : a.slot === 'lunch' ? -1 : 1))
    .map((e) => ({
      id: e.id,
      heading: `${d.common.days[e.day]!.slice(0, 3)} · ${slotLabel(e.slot)}`,
      title: titleOf(e),
      coverPath: e.recipe_id ? (recipeById.get(e.recipe_id)?.cover_image_path ?? null) : null,
      part: !!e.cook_part,
      note: e.instructions ?? null,
    }));

  const approved = plan?.status === 'approved';
  const showFill = !isPastWeek && loaded && open.length > 0;
  const showReview = loaded && entries.length > 0 && !isPastWeek;
  const showBar = showFill || showReview;
  const recipeIdeas = ideas.filter((i) => i.recipe_id || i.custom_title);

  const iconButton = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: minTapTarget,
        height: minTapTarget,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: minTapTarget / 2,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: screenPadding,
          paddingBottom: insets.bottom + tabBarClearance + (showBar ? 72 : 0),
          gap: 14,
        }}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 8 }}>
          {showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={d.plan.backToWeeks}
              onPress={() => backOr('/plan')}
              style={{ width: 36, height: minTapTarget, justifyContent: 'center', marginLeft: -8 }}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Eyebrow>
              {new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
            </Eyebrow>
            <Title>{t.title}</Title>
          </View>
          {!isPastWeek ? iconButton('people-outline', t.homeA11y, () => setHomeOpen(true)) : null}
          {iconButton('bulb-outline', t.saveIdeaA11y, () => setIdeaSheetOpen(true))}
        </View>

        {/* Week chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -screenPadding }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: screenPadding }}
        >
          {olderWeeks.length > 0 ? (
            <Pill label={t.older} onPress={openOlder} />
          ) : null}
          {[...(chips.includes(weekIso) ? chips : [...chips, weekIso].sort())].map((week) => {
            const selected = week === weekIso;
            const label = chipLabel(week);
            const sub = chipSub(week);
            return (
              <Pressable
                key={week}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={fmt(d.components.weekChipA11y, { label, sub })}
                onPress={() => setWeekIso(week)}
                style={({ pressed }) => ({
                  minWidth: 92,
                  minHeight: 50,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                  backgroundColor: selected ? colors.text : pressed ? colors.cardPressed : 'transparent',
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.border,
                })}
              >
                <Text style={{ color: selected ? colors.bg : colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>
                  {label}
                </Text>
                <Text
                  style={{
                    color: selected ? colors.bg : colors.textMuted,
                    opacity: selected ? 0.8 : 1,
                    fontFamily: fonts.ui,
                    fontSize: fontSize.eyebrow,
                  }}
                >
                  {sub}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!loaded ? <Loading /> : null}

        {loaded ? (
          <>
            {/* Progress and balance */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
                  {fmt(t.progress, { planned: progress.planned, total: progress.total })}
                </Text>
                {plan ? <Badge label={approved ? t.approved : t.draft} /> : null}
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.bgGrouped, overflow: 'hidden' }}>
                <View
                  style={{
                    width: `${progress.total > 0 ? Math.round((progress.planned / progress.total) * 100) : 0}%`,
                    height: 6,
                    backgroundColor: colors.text,
                  }}
                />
              </View>
              {quotaChips.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {quotaChips.map((q) => (
                    <Badge
                      key={q.category}
                      label={`${categoryName(q.category)} ${q.planned}/${q.target}`}
                      accent={!isPastWeek && q.planned < q.target}
                    />
                  ))}
                </View>
              ) : null}
              {!isPastWeek && recipeIdeas.length > 0 ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colors.textMuted, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>
                    {recipeIdeas.length === 1 ? t.ideaOne : fmt(t.ideaMany, { n: recipeIdeas.length })}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {recipeIdeas.map((idea) => (
                      <Pill
                        key={idea.id}
                        label={ideaTitle(idea)}
                        accessibilityLabel={fmt(d.plan.planIdeaA11y, { title: ideaTitle(idea) })}
                        onPress={() => setIdeaToPlan(idea)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>

            {liveSummary ? (
              <LiveCard
                summary={liveSummary}
                employee={employee?.share_token ? employee : null}
                onGroceries={() => router.push('/groceries')}
                onDismiss={() => setLiveSummary(null)}
              />
            ) : null}

            {isPastWeek && entries.length > 0 ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  label={d.plan.copyToThisWeek}
                  kind="secondary"
                  onPress={() => void copyToCurrentWeek()}
                  loading={busy}
                  style={{ flex: 1 }}
                />
                <Button label={t.deleteWeek} kind="danger" onPress={deleteWeek} />
              </View>
            ) : null}

            <DayRows
              weekIso={weekIso}
              entries={entries}
              absences={absences}
              eaters={eaters}
              recipeById={recipeById}
              todayIndex={todayIndex}
              readOnly={isPastWeek}
              onAdd={(day, slot) => setAddTarget({ mode: 'add', day, slot })}
              onOpen={(entry) => setOpenEntryId(entry.id)}
              onHome={() => setHomeOpen(true)}
            />
          </>
        ) : null}
      </ScrollView>

      {toast ? (
        <View
          style={{
            position: 'absolute',
            left: screenPadding,
            right: screenPadding,
            bottom: insets.bottom + floatingActionOffset + (showBar ? 64 : 0),
            backgroundColor: colors.text,
            borderRadius: 12,
            paddingHorizontal: 14,
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Text numberOfLines={1} style={{ flex: 1, color: colors.bg, fontFamily: fonts.ui, fontSize: fontSize.small }}>
            {toast.text}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setOpenEntryId(toast.entryId);
              setToast(null);
            }}
            hitSlop={10}
          >
            <Text style={{ color: colors.bg, fontFamily: fonts.uiSemi, fontSize: fontSize.small, textDecorationLine: 'underline' }}>
              {t.edit}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showBar ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: screenPadding,
            right: screenPadding,
            bottom: insets.bottom + floatingActionOffset,
            flexDirection: 'row',
            gap: 10,
            ...Platform.select({
              ios: { shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
              android: { elevation: 8 },
              web: { boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)' } as object,
              default: {},
            }),
          }}
        >
          {showFill ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setAiOpen(true)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 50,
                borderRadius: 12,
                backgroundColor: colors.text,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="sparkles-outline" size={18} color={colors.bg} />
              <Text style={{ color: colors.bg, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>
                {fmt(t.fillWithAi, { n: open.length })}
              </Text>
            </Pressable>
          ) : null}
          {showReview ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setReviewOpen(true)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 50,
                borderRadius: 12,
                backgroundColor: approved ? colors.bg : colors.accent,
                borderWidth: approved ? 1 : 0,
                borderColor: colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              {approved ? <Ionicons name="checkmark-circle" size={18} color={colors.text} /> : null}
              <Text
                style={{
                  color: approved ? colors.text : colors.accentText,
                  fontFamily: fonts.uiSemi,
                  fontSize: fontSize.base,
                }}
              >
                {approved ? t.approved : t.review}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <AddMealSheet
        visible={addTarget !== null}
        title={addTitle}
        subtitle={addSubtitle}
        recipes={addTarget?.mode === 'side' ? allAddRecipes : addRecipes}
        suggestions={suggestions}
        customIdeas={
          addTarget?.mode === 'side'
            ? []
            : ideas.filter((i) => !i.recipe_id && i.custom_title).map((i) => ({ id: i.id, title: i.custom_title! }))
        }
        ideaIdByRecipe={addTarget?.mode === 'side' ? new Map() : ideaIdByRecipe}
        gapsLabel={addTarget?.mode === 'side' ? t.sides : undefined}
        onPick={(pick) => void onPick(pick)}
        onClose={() => {
          const target = addTarget;
          setAddTarget(null);
          if (target && target.mode !== 'add') afterSheet(() => setOpenEntryId(target.entry.id));
        }}
      />

      <MealSheet
        visible={openEntry !== null}
        entry={openEntry}
        sides={openSides}
        heading={openEntry ? `${d.common.days[openEntry.day]} · ${slotLabel(openEntry.slot)}` : ''}
        title={openEntry ? titleOf(openEntry) : ''}
        coverPath={openEntry?.recipe_id ? (recipeById.get(openEntry.recipe_id)?.cover_image_path ?? null) : null}
        hasRecipe={!!openEntry?.recipe_id}
        eaters={eaters}
        away={openEntry ? awayIds(absences, openEntry.day, openEntry.slot) : new Set()}
        employeeName={employee?.name ?? null}
        sideTitle={titleOf}
        onOpenRecipe={(servings) => {
          const id = openEntry?.recipe_id;
          setOpenEntryId(null);
          if (id) router.push({ pathname: '/recipe/[id]', params: { id, planServings: String(servings) } });
        }}
        onSwap={() => {
          if (!openEntry) return;
          const entry = openEntry;
          setOpenEntryId(null);
          afterSheet(() => setAddTarget({ mode: 'swap', entry }));
        }}
        onAddSide={() => {
          if (!openEntry) return;
          const entry = openEntry;
          setOpenEntryId(null);
          afterSheet(() => setAddTarget({ mode: 'side', entry }));
        }}
        onRemoveSide={(id) => void removeSide(id)}
        onSave={(patch) => void saveEntry(patch)}
        onRemove={() => void removeMeal()}
        onClose={() => setOpenEntryId(null)}
      />

      <HomeSheet
        visible={homeOpen}
        weekIso={weekIso}
        eaters={eaters}
        absences={absences}
        schoolChild={schoolChild}
        onChange={(changes) => void applyAway(changes)}
        onClose={() => {
          setHomeOpen(false);
          invalidateLists('plan', 'groceries');
        }}
      />

      <ReviewSheet
        visible={reviewOpen}
        approved={approved}
        mealsCount={mainEntries.length}
        tally={tally}
        employeeName={employee?.name ?? null}
        canSend={!!employee?.share_token}
        items={reviewItems}
        tasks={Array.isArray(plan?.employee_notes) ? plan.employee_notes : []}
        busy={busy}
        onTasksChange={(next) => void saveTasks(next)}
        onOpenItem={(id) => {
          const entry = entries.find((e) => e.id === id);
          setReviewOpen(false);
          if (entry) {
            const id = splitSlot(entries, entry.day, entry.slot).main?.id ?? entry.id;
            afterSheet(() => setOpenEntryId(id));
          }
        }}
        onApprove={(send) => void approve(send)}
        onSendLink={sendLink}
        onClose={() => setReviewOpen(false)}
      />

      <AiWeekPlanner
        visible={aiOpen}
        weekIso={weekIso}
        planStatus={plan?.status ?? null}
        entries={entries}
        absences={absences}
        ideas={ideas}
        persons={persons}
        recipes={recipes}
        loadContext={loadPlannerContext}
        ensurePlan={ensurePlan}
        onChanged={() => loadWeek(weekIso)}
        onApproved={setLiveSummary}
        onClose={() => setAiOpen(false)}
      />

      <AddToWeekSheet
        visible={ideaToPlan !== null}
        recipeId={ideaToPlan?.recipe_id ?? null}
        customTitle={ideaToPlan?.custom_title ?? null}
        recipeTitle={ideaToPlan ? ideaTitle(ideaToPlan) : ''}
        idea={ideaToPlan}
        initialWeek={weekIso}
        onClose={() => setIdeaToPlan(null)}
        onAdded={() => void reload()}
      />

      <IdeaSheet
        visible={ideaSheetOpen}
        initialWeek={addWeeks(weekIso, 1)}
        onClose={() => setIdeaSheetOpen(false)}
        onSaved={() => {
          setSummaryKey((k) => k + 1);
          void loadWeek(weekIso);
        }}
      />
    </SafeAreaView>
  );
}
