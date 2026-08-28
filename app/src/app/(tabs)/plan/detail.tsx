import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GuestStepper } from '@/components/guest-stepper';
import { PersonChip } from '@/components/person-chip';
import { MetaLine, RecipeImage, RecipeRow, type RecipeListItem } from '@/components/recipe-cards';
import {
  Body,
  Button,
  CategoryDot,
  Eyebrow,
  Field,
  Hairline,
  LinkButton,
  Loading,
  Muted,
  Title,
} from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { autoFillWeek, type AutoCandidate } from '@/lib/auto-plan';
import { matchCanonical, normalizeRaw } from '@/lib/canonical';
import { resolveProteinCategory, type ProteinCategory } from '@/lib/category';
import { normalizeDietProfile } from '@/lib/diet';
import { computeRecipeFodmap, recipeFodmapTier } from '@/lib/fodmap';
import { invalidateLists } from '@/lib/list-refresh';
import { confirmDestructive, notify } from '@/lib/confirm';
import { backOr } from '@/lib/nav';
import { fmt, useI18n } from '@/lib/i18n';
import { useImageUrl } from '@/lib/media';
import {
  DAY_LABELS,
  addWeeks,
  dayDate,
  plannedEvents,
  slotCoverage,
  slotEntries,
  upsertEntryPayload,
  weekStart,
  type CookType,
  type MealSlot,
  type PlanEntry,
} from '@/lib/plan';
import { quotaProgress } from '@/lib/quotas';
import { entryServings } from '@/lib/servings';
import { supabase } from '@/lib/supabase';
import { localizedTitle } from '@/lib/translations';
import {
  floatingActionOffset,
  fonts,
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  tabBarClearance,
  useTheme,
} from '@/lib/theme';
import { useCanonicalIndex } from '@/lib/use-canonical';
import type { IngredientRow as IngredientData } from '@/lib/worker';

interface Person {
  id: string;
  name: string;
  is_employee: boolean;
  diet_profile: unknown;
  avatar_color?: string | null;
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
  /** Planner classification; null is treated as 'main'. */
  meal_type?: 'main' | 'breakfast' | 'dessert' | 'side' | null;
}

interface MealPlanRow {
  id: string;
  week_start: string;
  status: 'draft' | 'approved';
}

/** Outlined quota chip: 8px category dot + "Fish 1/2" Franklin 500 13. */
function QuotaChip({
  category,
  planned,
  target,
}: {
  category: ProteinCategory;
  planned: number;
  target: number;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const pillLabels: Record<string, string> = {
    fish: d.plan.categoryFish,
    meat: d.plan.categoryMeat,
    vegetarian: d.plan.categoryVeg,
    legume: d.plan.categoryLegume,
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <CategoryDot category={category} />
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.meta,
          fontFamily: fonts.uiMedium,
          fontVariant: ['tabular-nums'],
        }}
      >
        {pillLabels[category] ?? category} {planned}/{target}
      </Text>
    </View>
  );
}

function EntryThumb({ path }: { path: string | null }) {
  const { colors } = useTheme();
  const url = useImageUrl(path);
  return (
    <View
      style={{
        width: 64,
        height: 48,
        borderRadius: radius.thumb,
        backgroundColor: colors.cardPressed,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: 64, height: 48 }} contentFit="cover" />
      ) : (
        <Ionicons name="restaurant-outline" size={18} color={colors.textMuted} />
      )}
    </View>
  );
}

export default function PlanScreen() {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const { householdId } = useHousehold();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const index = useCanonicalIndex();

  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);

  const { week: weekParam } = useLocalSearchParams<{ week?: string }>();
  const [weekIso, setWeekIso] = useState(() =>
    weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : weekStart(new Date())
  );
  const [plan, setPlan] = useState<MealPlanRow | null>(null);
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  /** Which week's data is on screen — spinner until it matches weekIso. */
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
  const [persons, setPersons] = useState<Person[]>([]);
  const [recipes, setRecipes] = useState<RecipeLite[]>([]);
  const [busy, setBusy] = useState(false);

  // Picker modal state
  const [pickerCell, setPickerCell] = useState<{ day: number; slot: MealSlot } | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickedRecipe, setPickedRecipe] = useState<RecipeLite | null>(null);
  /** Free-text meal draft ("write down a specific meal"). */
  const [customDraft, setCustomDraft] = useState('');
  const [pickedCustom, setPickedCustom] = useState<string | null>(null);
  const [pickedPersonIds, setPickedPersonIds] = useState<string[]>([]);
  const [pickedGuests, setPickedGuests] = useState(0);
  const [pickedCook, setPickedCook] = useState<CookType>('family');
  /** Set when the picker is editing an existing entry rather than adding one. */
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  const loadWeek = useCallback(
    async (week: string) => {
      const { data: planRow } = await supabase
        .from('meal_plans')
        .select('id, week_start, status')
        .eq('household_id', householdId)
        .eq('week_start', week)
        .maybeSingle();
      setPlan((planRow as MealPlanRow) ?? null);
      if (planRow) {
        const { data: entryRows } = await supabase
          .from('plan_entries')
          .select('*')
          .eq('meal_plan_id', planRow.id);
        setEntries((entryRows as PlanEntry[]) ?? []);
      } else {
        setEntries([]);
      }
      setLoadedWeek(week);
    },
    [householdId]
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [{ data: personRows }, { data: recipeRows }] = await Promise.all([
          supabase
            .from('persons')
            .select('id, name, is_employee, diet_profile, avatar_color')
            .eq('household_id', householdId)
            .order('created_at'),
          supabase
            .from('recipes')
            .select(
              'id, title, tags, needs_review, cover_image_path, ingredients, prep_minutes, cook_minutes, servings, fodmap_override, meal_type, recipe_translations(locale, title)'
            )
            .eq('household_id', householdId)
            .order('title'),
        ]);
        if (cancelled) return;
        setPersons((personRows as Person[]) ?? []);
        // Localize titles up front so the grid, picker, and editor all show the
        // active locale's title without any downstream changes.
        const rows = (
          (recipeRows as (RecipeLite & {
            recipe_translations: { locale: string; title: string }[] | null;
          })[]) ?? []
        ).map(({ recipe_translations, ...r }) => ({
          ...r,
          title: localizedTitle({ title: r.title, recipe_translations }, locale),
        }));
        setRecipes(rows);
        await loadWeek(weekIso);
      })();
      return () => {
        cancelled = true;
      };
    }, [householdId, weekIso, loadWeek, locale])
  );

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);
  const eaters = useMemo(() => persons.filter((p) => !p.is_employee), [persons]);

  /**
   * Household quota strip: per category, worst-covered eater (lowest planned)
   * against the highest personal minimum. Categories without a minimum hide.
   */
  const quotaChips = useMemo(() => {
    if (eaters.length === 0) return [];
    const quotaRecipes = recipes.map((r) => ({
      ...r,
      category: resolveProteinCategory(r.tags, r.ingredients, index),
    }));
    const perPerson = eaters.map((person) =>
      quotaProgress(
        entries,
        person.id,
        quotaRecipes,
        normalizeDietProfile(person.diet_profile).proteinQuotas.targets
      )
    );
    const categories = new Set(perPerson.flat().map((p) => p.category));
    const chips: { category: ProteinCategory; planned: number; target: number }[] = [];
    for (const category of ['fish', 'meat', 'vegetarian', 'legume'] as ProteinCategory[]) {
      if (!categories.has(category)) continue;
      const rows = perPerson
        .map((progress) => progress.find((p) => p.category === category))
        .filter((row) => row !== undefined);
      const target = Math.max(...rows.map((r) => r.min));
      if (target <= 0) continue;
      const planned = Math.min(...rows.map((r) => r.planned));
      chips.push({ category, planned, target });
    }
    return chips;
  }, [eaters, entries, recipes, index]);

  // "Choose for us" auto-fill (intermediary sheet asks about low-FODMAP).
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoLowFodmap, setAutoLowFodmap] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  /** Durable provenance: entries the auto-planner inserted (auto_picked). */
  const autoEntries = useMemo(() => entries.filter((e) => e.auto_picked), [entries]);
  const canReroll = autoEntries.length > 0;

  const emptyCells = useMemo(() => {
    const cells: { day: number; slot: MealSlot }[] = [];
    for (let day = 0; day < 7; day += 1) {
      for (const slot of ['lunch', 'dinner'] as MealSlot[]) {
        if (slotEntries(entries, day, slot).length === 0) cells.push({ day, slot });
      }
    }
    return cells;
  }, [entries]);

  const runAutoFill = async () => {
    if (autoBusy || (emptyCells.length === 0 && !canReroll)) return;
    setAutoBusy(true);
    try {
      // "Choose again": clear the auto-picked entries first so their slots
      // re-open; manual picks are never touched.
      let currentEntries = entries;
      if (canReroll) {
        const ids = autoEntries.map((e) => e.id);
        await supabase.from('plan_entries').delete().in('id', ids);
        currentEntries = entries.filter((e) => !e.auto_picked);
        invalidateLists('plan', 'groceries');
      }
      const openCells: { day: number; slot: MealSlot }[] = [];
      for (let day = 0; day < 7; day += 1) {
        for (const slot of ['lunch', 'dinner'] as MealSlot[]) {
          if (slotEntries(currentEntries, day, slot).length === 0) openCells.push({ day, slot });
        }
      }
      // Cool-down window: same rule as "Suggested for you".
      const [{ data: hh }, { data: recentRows }] = await Promise.all([
        supabase.from('households').select('suggested_rest_weeks').eq('id', householdId).single(),
        supabase
          .from('plan_entries')
          .select('recipe_id, meal_plans!inner(household_id, week_start)')
          .eq('meal_plans.household_id', householdId),
      ]);
      const cutoff = addWeeks(weekStart(new Date()), -(hh?.suggested_rest_weeks ?? 3));
      const recentIds = new Set(
        (
          (recentRows ?? []) as unknown as {
            recipe_id: string | null;
            meal_plans: { week_start: string };
          }[]
        )
          .filter((e) => e.meal_plans.week_start >= cutoff)
          .map((e) => e.recipe_id)
          .filter((id): id is string => id !== null)
      );

      // Only lunch/dinner recipes belong on the week grid (null = main).
      const mains = recipes.filter((r) => (r.meal_type ?? 'main') === 'main');
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
                computeRecipeFodmap(lines, r.servings ?? null, (line) =>
                  matchCanonical(normalizeRaw(line.raw), index)?.ingredient ?? null
                )
              )
            : 'check';
        return {
          id: r.id,
          category: resolveProteinCategory(r.tags, r.ingredients, index),
          fodmapTier: r.fodmap_override ?? computed,
          plannedRecently: recentIds.has(r.id),
        };
      });

      // Household weekly quotas: one shared meal feeds everyone, so the
      // strictest bounds across eaters apply (highest min, lowest max).
      const quotaMap = new Map<string, { min: number; max: number | null }>();
      for (const person of eaters) {
        const profile = normalizeDietProfile(person.diet_profile);
        for (const target of profile.proteinQuotas.targets) {
          const agg = quotaMap.get(target.category) ?? { min: 0, max: null };
          agg.min = Math.max(agg.min, target.min ?? 0);
          if (target.max !== null) {
            agg.max = agg.max === null ? target.max : Math.min(agg.max, target.max);
          }
          quotaMap.set(target.category, agg);
        }
      }
      const quotas = [...quotaMap.entries()].map(([category, q]) => ({ category, ...q }));

      // Meals already on this week's grid count toward the quotas.
      const categoryById = new Map(
        recipes.map((r) => [r.id, resolveProteinCategory(r.tags, r.ingredients, index)])
      );
      const existingCounts: Record<string, number> = {};
      for (const entry of currentEntries) {
        const cat = entry.recipe_id ? categoryById.get(entry.recipe_id) : null;
        if (cat) existingCounts[cat] = (existingCounts[cat] ?? 0) + 1;
      }

      const { assignments, unfilled } = autoFillWeek(openCells, candidates, {
        lowFodmapOnly: autoLowFodmap,
        quotas,
        existingCounts,
        avoidIds: autoEntries
          .map((e) => e.recipe_id)
          .filter((id): id is string => id !== null),
      });
      if (assignments.length === 0) {
        setAutoOpen(false);
        await loadWeek(weekIso);
        notify(
          d.plan.noRecipesTitle,
          autoLowFodmap ? d.plan.noLowFodmapRecipes : d.plan.addRecipesFirst
        );
        return;
      }
      const mealPlanId = await ensurePlan();
      await supabase.from('plan_entries').insert(
        assignments.map((a) => ({
          ...upsertEntryPayload({
            mealPlanId,
            day: a.day,
            slot: a.slot,
            recipeId: a.recipeId,
            personIds: [], // empty = whole household
            assignedCook: 'family',
            position: 0,
          }),
          auto_picked: true,
        }))
      );
      invalidateLists('plan', 'groceries');
      setAutoOpen(false);
      await loadWeek(weekIso);
      if (unfilled.length > 0) {
        const body =
          unfilled.length === 1
            ? autoLowFodmap
              ? d.plan.partlyFilledOneLow
              : d.plan.partlyFilledOne
            : fmt(autoLowFodmap ? d.plan.partlyFilledManyLow : d.plan.partlyFilledMany, {
                count: unfilled.length,
              });
        notify(d.plan.weekPartlyFilled, body);
      }
    } finally {
      setAutoBusy(false);
    }
  };

  const ensurePlan = async (): Promise<string> => {
    if (plan) return plan.id;
    const { data, error } = await supabase
      .from('meal_plans')
      .insert({ household_id: householdId, week_start: weekIso })
      .select('id, week_start, status')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Could not create the week');
    setPlan(data as MealPlanRow);
    return data.id as string;
  };

  const openPicker = (day: number, slot: MealSlot) => {
    setEditingEntryId(null);
    setPickerCell({ day, slot });
    setPickerSearch('');
    setPickedRecipe(null);
    setCustomDraft('');
    setPickedCustom(null);
    setPickedPersonIds([]);
    setPickedGuests(0);
    setPickedCook('family');
  };

  /** Open the picker on an existing entry, pre-filled so it can be edited. */
  const openEditor = (entry: PlanEntry) => {
    setEditingEntryId(entry.id);
    setPickerCell({ day: entry.day, slot: entry.slot });
    setPickerSearch('');
    setCustomDraft('');
    setPickedRecipe(entry.recipe_id ? (recipeById.get(entry.recipe_id) ?? null) : null);
    setPickedCustom(entry.custom_title);
    setPickedPersonIds(entry.person_ids);
    setPickedGuests(entry.guest_count);
    setPickedCook(entry.assigned_cook);
  };

  const closePicker = () => {
    setPickerCell(null);
    setEditingEntryId(null);
  };

  const pickCustom = () => {
    const title = customDraft.trim();
    if (!title) return;
    setPickedCustom(title);
    setPickedRecipe(null);
  };

  // "Add" on a typed meal: offer to turn it into a reusable recipe. "No" keeps
  // the current free-text flow; "Yes" hands off to the add-recipe screen with
  // the slot context, so the finished recipe lands back in this slot.
  const onAddCustom = () => {
    const title = customDraft.trim();
    if (!title) return;
    confirmDestructive({
      title: d.plan.addAsRecipeTitle,
      message: fmt(d.plan.addAsRecipeBody, { title }),
      confirmLabel: d.plan.yesCreateRecipe,
      cancelLabel: d.plan.noJustAdd,
      destructive: false,
      onConfirm: () => startRecipeFromMeal(title),
      onCancel: pickCustom,
    });
  };

  const startRecipeFromMeal = (title: string) => {
    if (!pickerCell) return;
    const cell = pickerCell;
    closePicker();
    router.push({
      pathname: '/capture',
      params: {
        seedTitle: title,
        assignDay: String(cell.day),
        assignSlot: cell.slot,
        assignWeek: weekIso,
      },
    });
  };

  const confirmAdd = async () => {
    if (!pickerCell || (!pickedRecipe && !pickedCustom)) return;
    setBusy(true);
    try {
      if (editingEntryId) {
        // Editing keeps the entry's slot/position; only who eats, guests, cook,
        // and (via "Pick something else") the recipe/title can change.
        await supabase
          .from('plan_entries')
          .update({
            recipe_id: pickedRecipe ? pickedRecipe.id : null,
            custom_title: pickedRecipe ? null : pickedCustom,
            person_ids: pickedPersonIds,
            guest_count: Math.max(0, pickedGuests),
            assigned_cook: pickedCook,
          })
          .eq('id', editingEntryId);
      } else {
        const mealPlanId = await ensurePlan();
        const position = slotEntries(entries, pickerCell.day, pickerCell.slot).length;
        const payload = upsertEntryPayload({
          mealPlanId,
          day: pickerCell.day,
          slot: pickerCell.slot,
          ...(pickedRecipe ? { recipeId: pickedRecipe.id } : { customTitle: pickedCustom! }),
          personIds: pickedPersonIds,
          guestCount: pickedGuests,
          assignedCook: pickedCook,
          position,
        });
        await supabase.from('plan_entries').insert(payload);
      }
      closePicker();
        invalidateLists('plan', 'groceries');
      await loadWeek(weekIso);
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = async (entryId: string) => {
    await supabase.from('plan_entries').delete().eq('id', entryId);
    await loadWeek(weekIso);
    invalidateLists('plan', 'groceries');
  };

  const approveWeek = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await supabase.from('meal_plans').update({ status: 'approved' }).eq('id', plan.id);
      const events = plannedEvents(
        entries,
        householdId,
        eaters.map((p) => p.id),
        weekIso
      );
      if (events.length > 0) await supabase.from('events').insert(events);
      await loadWeek(weekIso);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Copy this (past) week's meals into the current week, carrying over recipes,
   * eaters, guests, and cook. Replaces the current week's meals (after a
   * confirm) when it already has some.
   */
  const copyToCurrentWeek = async () => {
    const sourceEntries = entries;
    if (sourceEntries.length === 0) return;
    const currentWeekIso = weekStart(new Date());
    const { data: existing } = await supabase
      .from('meal_plans')
      .select('id')
      .eq('household_id', householdId)
      .eq('week_start', currentWeekIso)
      .maybeSingle();
    const targetPlanId = (existing?.id as string | undefined) ?? null;

    const run = async () => {
      setBusy(true);
      try {
        let planId = targetPlanId;
        if (!planId) {
          const { data: created, error } = await supabase
            .from('meal_plans')
            .insert({ household_id: householdId, week_start: currentWeekIso })
            .select('id')
            .single();
          if (error || !created) throw new Error(error?.message ?? 'Could not create the week');
          planId = created.id as string;
        } else {
          await supabase.from('plan_entries').delete().eq('meal_plan_id', planId);
        }
        const rows = sourceEntries.map((e) => ({
          meal_plan_id: planId,
          day: e.day,
          slot: e.slot,
          recipe_id: e.recipe_id,
          custom_title: e.custom_title,
          person_ids: e.person_ids,
          guest_count: e.guest_count,
          assigned_cook: e.assigned_cook,
          position: e.position,
        }));
          invalidateLists('plan', 'groceries');
        await supabase.from('plan_entries').insert(rows);
        setWeekIso(currentWeekIso);
        invalidateLists('plan', 'groceries');
      } finally {
        setBusy(false);
      }
    };

    if (targetPlanId) {
      const { count } = await supabase
        .from('plan_entries')
        .select('id', { count: 'exact', head: true })
        .eq('meal_plan_id', targetPlanId);
      if ((count ?? 0) > 0) {
        confirmDestructive({
          title: d.plan.replaceWeekTitle,
          message:
            count === 1
              ? d.plan.replaceWeekBodyOne
              : fmt(d.plan.replaceWeekBodyMany, { count: count ?? 0 }),
          confirmLabel: d.plan.replace,
          cancelLabel: d.common.cancel,
          onConfirm: () => void run(),
        });
        return;
      }
    }
    await run();
  };

  const currentWeekIso = weekStart(new Date());
  const isPastWeek = weekIso < currentWeekIso;

  const todayEyebrow = new Date().toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const weekLabel = fmt(d.plan.weekOf, {
    date: dayDate(weekIso, 0).toLocaleDateString(locale, { month: 'long', day: 'numeric' }),
  });
  const todayIndex = DAY_LABELS.findIndex(
    (_, day) => dayDate(weekIso, day).toDateString() === new Date().toDateString()
  );

  const filteredRecipes = recipes.filter((r) =>
    r.title.toLowerCase().includes(pickerSearch.trim().toLowerCase())
  );
  const showApprove = plan?.status === 'draft' && entries.length > 0;

  const navButton = (label: string, icon: 'chevron-back' | 'chevron-forward', delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => setWeekIso(addWeeks(weekIso, delta))}
      style={({ pressed }) => ({
        width: minTapTarget,
        height: minTapTarget,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: minTapTarget / 2,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <Ionicons name={icon} size={24} color={colors.text} />
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* Header: date eyebrow + title + week nav */}
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
          <Eyebrow>{todayEyebrow}</Eyebrow>
          <Title>{d.common.tabWeek}</Title>
          <Muted>
            {weekLabel}
            {plan?.status === 'approved' ? ` · ${d.plan.approved}` : ''}
          </Muted>
        </View>
        {navButton(d.plan.previousWeek, 'chevron-back', -1)}
        {navButton(d.plan.nextWeek, 'chevron-forward', 1)}
      </View>

      {/* Quota strip */}
      {quotaChips.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            paddingHorizontal: screenPadding,
            paddingBottom: 12,
          }}
        >
          {quotaChips.map((chip) => (
            <QuotaChip key={chip.category} {...chip} />
          ))}
        </View>
      ) : null}

      {emptyCells.length > 0 || canReroll ? (
        <View style={{ paddingHorizontal: screenPadding, paddingBottom: 12 }}>
          <Button
            label={canReroll ? d.plan.chooseAgain : d.plan.chooseForUs}
            kind="secondary"
            onPress={() => setAutoOpen(true)}
          />
        </View>
      ) : null}

      {isPastWeek && loadedWeek === weekIso && entries.length > 0 ? (
        <View style={{ paddingHorizontal: screenPadding, paddingBottom: 12 }}>
          <Button
            label={d.plan.copyToThisWeek}
            kind="secondary"
            onPress={() => void copyToCurrentWeek()}
            loading={busy}
          />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: screenPadding,
          // Clear the capsule bar, plus the floating approve button when shown.
          paddingBottom: insets.bottom + (showApprove ? tabBarClearance + 72 : tabBarClearance),
        }}
      >
        {loadedWeek !== weekIso ? <Loading /> : null}
        {loadedWeek === weekIso ? DAY_LABELS.map((_, day) => {
          const dayLabel = d.common.days[day];
          const isToday = day === todayIndex;
          return (
            <View key={day}>
              <Hairline />
              <View style={{ paddingVertical: 14, gap: 10 }}>
                {isToday ? <Eyebrow style={{ color: colors.saffron }}>{d.plan.today}</Eyebrow> : null}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: fontSize.dayName,
                      letterSpacing: -0.2,
                      fontFamily: fonts.displaySemi,
                    }}
                  >
                    {dayLabel}
                  </Text>
                  <Muted>
                    {dayDate(weekIso, day).toLocaleDateString(locale, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Muted>
                </View>

                {(['lunch', 'dinner'] as const).map((slot) => {
                  const cellEntries = slotEntries(entries, day, slot);
                  const coverage = slotCoverage(
                    entries,
                    day,
                    slot,
                    eaters.map((p) => p.id)
                  );
                  return (
                    <View key={slot} style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Eyebrow style={{ flex: 1 }}>{slotLabel(slot)}</Eyebrow>
                        <LinkButton
                          label={d.plan.addShort}
                          accessibilityLabel={fmt(d.plan.addDishA11y, { day: dayLabel, slot: slotLabel(slot) })}
                          onPress={() => openPicker(day, slot)}
                          textStyle={{ fontSize: fontSize.small }}
                        />
                      </View>
                      {cellEntries.map((entry) => {
                        const recipe = entry.recipe_id ? recipeById.get(entry.recipe_id) : undefined;
                        const category = resolveProteinCategory(
                          recipe?.tags ?? [],
                          recipe?.ingredients,
                          index
                        );
                        const planServings = entryServings(
                          entry.person_ids,
                          entry.guest_count,
                          eaters.length
                        );
                        return (
                          <View
                            key={entry.id}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 12,
                              minHeight: 56, // v3: glanceable tap floor for Week rows
                            }}
                          >
                            {/* Tapping a planned meal opens the editor, pre-filled. */}
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={fmt(d.plan.editMealA11y, { title: entry.custom_title ?? recipe?.title ?? d.plan.mealOne })}
                              onPress={() => openEditor(entry)}
                              style={({ pressed }) => ({
                                flex: 1,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 12,
                                borderRadius: radius.thumb,
                                backgroundColor: pressed ? colors.cardPressed : 'transparent',
                              })}
                            >
                            <EntryThumb path={recipe?.cover_image_path ?? null} />
                            <View style={{ flex: 1, gap: 3 }}>
                              <Text
                                numberOfLines={2}
                                style={{
                                  color: colors.text,
                                  fontSize: fontSize.small,
                                  fontFamily: fonts.uiMedium,
                                }}
                              >
                                {entry.custom_title ?? recipe?.title ?? d.plan.recipeFallback}
                              </Text>
                              <View
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}
                              >
                                {category ? <CategoryDot category={category} size={7} /> : null}
                                {entry.person_ids.length === 0 ? (
                                  <Muted>{d.plan.wholeHousehold}</Muted>
                                ) : (
                                  entry.person_ids.map((pid) => {
                                    const person = personById.get(pid);
                                    return person ? <PersonChip key={pid} person={person} /> : null;
                                  })
                                )}
                                {entry.guest_count > 0 ? (
                                  <Muted>
                                    {entry.guest_count === 1
                                      ? d.plan.guestsOne
                                      : fmt(d.plan.guestsMany, { count: entry.guest_count })}
                                  </Muted>
                                ) : null}
                                {recipe ? <Muted>{`· ${fmt(d.plan.serves, { n: planServings })}`}</Muted> : null}
                                {entry.assigned_cook === 'employee' ? (
                                  <View
                                    style={{
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      borderWidth: 1,
                                      borderColor: colors.border,
                                      borderRadius: 999,
                                      paddingHorizontal: 8,
                                      paddingVertical: 2,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: fontSize.eyebrow,
                                        fontFamily: fonts.uiSemi,
                                        color: colors.textMuted,
                                      }}
                                    >
                                      {d.plan.employeeCooks}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                            </View>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={d.plan.removeDish}
                              onPress={() => void removeEntry(entry.id)}
                              hitSlop={8}
                              style={({ pressed }) => ({
                                width: 32,
                                height: 32,
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: pressed ? 0.5 : 1,
                              })}
                            >
                              <Ionicons name="close" size={18} color={colors.textMuted} />
                            </Pressable>
                          </View>
                        );
                      })}
                      {coverage.uncovered.length > 0 && cellEntries.length > 0 ? (
                        <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                          {coverage.uncovered.map((pid) => {
                            const person = personById.get(pid);
                            return person ? <PersonChip key={pid} person={person} hollow /> : null;
                          })}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        }) : null}
        {loadedWeek === weekIso ? <Hairline /> : null}
      </ScrollView>

      {/* v3.1: approve floats ABOVE the capsule tab bar (draft + non-empty only) */}
      {showApprove ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: screenPadding,
            right: screenPadding,
            bottom: insets.bottom + floatingActionOffset,
            ...Platform.select({
              ios: {
                shadowColor: '#000000',
                shadowOpacity: 0.12,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 4 },
              },
              android: { elevation: 8 },
              web: { boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)' } as object,
              default: {},
            }),
          }}
        >
          <Button label={d.plan.approveWeek} onPress={() => void approveWeek()} loading={busy} />
        </View>
      ) : null}

      <Modal visible={pickerCell !== null} animationType="slide" onRequestClose={closePicker}>
        {/* Explicit insets: SafeAreaView reports 0 inside a native Modal here. */}
        <View
          style={{
            flex: 1,
            backgroundColor: colors.bg,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          }}
        >
          <View style={{ flex: 1, padding: screenPadding, gap: 14 }}>
            {pickerCell ? (
              <Title>
                {d.common.days[pickerCell.day]} — {slotLabel(pickerCell.slot)}
              </Title>
            ) : null}
            {!pickedRecipe && !pickedCustom ? (
              <>
                {/* Free-text meal: no recipe required */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Field
                    value={customDraft}
                    onChangeText={setCustomDraft}
                    placeholder={d.plan.typeMealPlaceholder}
                    style={{ flex: 1 }}
                    onSubmitEditing={onAddCustom}
                    returnKeyType="done"
                  />
                  <LinkButton
                    label={d.common.add}
                    accessibilityLabel={d.plan.addThisMeal}
                    onPress={onAddCustom}
                    style={{ opacity: customDraft.trim() ? 1 : 0.4 }}
                  />
                </View>
                <Field
                  icon="search-outline"
                  value={pickerSearch}
                  onChangeText={setPickerSearch}
                  placeholder={d.plan.searchRecipes}
                  autoCapitalize="none"
                />
                <FlatList
                  data={filteredRecipes}
                  keyExtractor={(r) => r.id}
                  ItemSeparatorComponent={Hairline}
                  renderItem={({ item }) => (
                    <RecipeRow recipe={item} onPress={() => setPickedRecipe(item)} />
                  )}
                  ListEmptyComponent={<Muted>{d.plan.noRecipesYet}</Muted>}
                />
              </>
            ) : (
              <View style={{ flex: 1, gap: 20 }}>
                {/* The picked meal, presented like everywhere else in the app. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  {pickedRecipe ? (
                    <RecipeImage
                      path={pickedRecipe.cover_image_path}
                      style={{ width: 96, height: 72, borderRadius: radius.thumb }}
                      iconSize={24}
                    />
                  ) : null}
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: colors.text,
                        fontSize: fontSize.cardTitle,
                        lineHeight: 22,
                        fontFamily: fonts.displaySemi,
                      }}
                    >
                      {pickedRecipe?.title ?? pickedCustom}
                    </Text>
                    {pickedRecipe ? (
                      <MetaLine recipe={pickedRecipe as RecipeListItem} />
                    ) : (
                      <Muted>{d.plan.customMeal}</Muted>
                    )}
                    {pickedRecipe ? (
                      <LinkButton
                        label={d.plan.viewRecipe}
                        onPress={() =>
                          router.push({
                            pathname: '/recipe/[id]',
                            params: {
                              id: pickedRecipe.id,
                              planServings: String(
                                entryServings(pickedPersonIds, pickedGuests, eaters.length)
                              ),
                            },
                          })
                        }
                        style={{ alignSelf: 'flex-start' }}
                        textStyle={{ fontSize: fontSize.small }}
                      />
                    ) : null}
                  </View>
                </View>
                <Hairline />

                <View style={{ gap: 10 }}>
                  <Eyebrow>{d.plan.whoEats}</Eyebrow>
                  <Muted>{d.plan.nobodySelectedHint}</Muted>
                  <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                  {eaters.map((person) => (
                    <PersonChip
                      key={person.id}
                      person={person}
                      selected={pickedPersonIds.length === 0 ? undefined : pickedPersonIds.includes(person.id)}
                      onPress={() =>
                        setPickedPersonIds((prev) =>
                          prev.includes(person.id)
                            ? prev.filter((p) => p !== person.id)
                            : [...prev, person.id]
                        )
                      }
                    />
                  ))}
                  </View>
                </View>

                <View style={{ gap: 10 }}>
                  <Eyebrow>{d.plan.guests}</Eyebrow>
                  <Muted>{d.plan.guestsHint}</Muted>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <GuestStepper value={pickedGuests} onChange={setPickedGuests} />
                    <Muted>{fmt(d.plan.serves, { n: entryServings(pickedPersonIds, pickedGuests, eaters.length) })}</Muted>
                  </View>
                </View>

                <View style={{ gap: 10 }}>
                  <Eyebrow>{d.plan.whoCooks}</Eyebrow>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                  {(
                    [
                      ['family', d.plan.familyCook],
                      ['employee', d.plan.employeeCook],
                    ] as const
                  ).map(([cook, label]) => {
                    const selected = pickedCook === cook;
                    return (
                      <Pressable
                        key={cook}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setPickedCook(cook)}
                        style={({ pressed }) => ({
                          flex: 1,
                          minHeight: minTapTarget,
                          borderRadius: radius.control,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: selected
                            ? colors.text
                            : pressed
                              ? colors.cardPressed
                              : 'transparent',
                          borderWidth: selected ? 0 : 1,
                          borderColor: colors.border,
                        })}
                      >
                        <Text
                          style={{
                            color: selected ? colors.bg : colors.text,
                            fontSize: fontSize.base,
                            fontFamily: fonts.uiMedium,
                          }}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                  </View>
                </View>

                <View style={{ flex: 1 }} />
                <View style={{ gap: 8 }}>
                  <LinkButton
                    label={d.plan.pickSomethingElse}
                    onPress={() => {
                      setPickedRecipe(null);
                      setPickedCustom(null);
                    }}
                    style={{ alignSelf: 'center', paddingVertical: 4 }}
                  />
                  <Button
                    label={
                      editingEntryId
                        ? d.plan.saveChanges
                        : pickerCell
                          ? fmt(d.plan.addToDay, {
                              day: d.common.days[pickerCell.day],
                              slot: slotLabel(pickerCell.slot).toLowerCase(),
                            })
                          : d.plan.addToWeek
                    }
                    onPress={() => void confirmAdd()}
                    loading={busy}
                  />
                  <Button label={d.common.close} kind="secondary" onPress={closePicker} />
                </View>
              </View>
            )}
            {!pickedRecipe && !pickedCustom ? (
              <Button label={d.common.close} kind="secondary" onPress={closePicker} />
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Choose-for-us intermediary: confirm + low-FODMAP toggle. */}
      <Modal
        visible={autoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAutoOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
          onPress={() => setAutoOpen(false)}
        />
        <View
          style={{
            backgroundColor: colors.bg,
            padding: screenPadding,
            paddingBottom: insets.bottom + 16,
            gap: 14,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
          }}
        >
          <Eyebrow>{canReroll ? d.plan.chooseAgain : d.plan.chooseForUs}</Eyebrow>
          <Muted>
            {canReroll
              ? d.plan.chooseAgainBody
              : emptyCells.length === 1
                ? d.plan.fillBodyOne
                : fmt(d.plan.fillBodyMany, { count: emptyCells.length })}
          </Muted>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 52,
            }}
          >
            <Body style={{ flex: 1 }}>{d.plan.lowFodmapToggle}</Body>
            <Switch
              value={autoLowFodmap}
              onValueChange={setAutoLowFodmap}
              trackColor={{ true: colors.accent }}
            />
          </View>
          <Button
            label={canReroll ? d.plan.pickNewSelection : d.plan.fillTheWeek}
            onPress={() => void runAutoFill()}
            loading={autoBusy}
          />
          <Button label={d.common.cancel} kind="secondary" onPress={() => setAutoOpen(false)} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}
