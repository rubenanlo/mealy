import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { initials } from '@/components/person-chip';
import { Button, CategoryDot, Muted } from '@/components/ui';
import {
  SLOTS,
  absencesFrom,
  awayMapFrom,
  cellKey,
  findSchoolChild,
  isGoingOut,
  isSalad,
  presetPicks,
  proposeWeek,
  sideSuggestions,
  swapMeal,
  tally,
  toggleAway,
  toggleGoingOut,
  withSchoolLunches,
  type AwayMap,
  type EmployeePreset,
  type LunchStyle,
  type MealCounts,
  type ProposalInput,
  type ProposedMeal,
  type ProposedSide,
} from '@/lib/ai-week';
import { useHousehold } from '@/lib/auth';
import type { AutoCandidate, EmptyCell, PlannedMeal, QuotaConstraint } from '@/lib/auto-plan';
import { resolveProteinCategory, type ProteinCategory } from '@/lib/category';
import { notify } from '@/lib/confirm';
import { fmt, LOCALES, useI18n } from '@/lib/i18n';
import { invalidateLists } from '@/lib/list-refresh';
import {
  dayDate,
  effectivePersonIds,
  plannedEvents,
  upsertEntryPayload,
  type MealSlot,
  type PlanAbsence,
  type PlanEntry,
} from '@/lib/plan';
import { isPastDay, type PlanIdea } from '@/lib/plan-ideas';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';
import { aiAskRecipe, aiChangePlan, type AiChatTurn, type IngredientRow } from '@/lib/worker';
import { useCanonicalIndex } from '@/lib/use-canonical';

export interface PlannerPerson {
  id: string;
  name: string;
  is_employee: boolean;
  avatar_color?: string | null;
}

export interface PlannerRecipe {
  id: string;
  title: string;
  tags: string[];
  ingredients?: IngredientRow[];
  meal_type?: string | null;
  dish_type?: string | null;
}

/** What the week screen already computes for "Choose for us": candidates, quotas, history. */
export interface PlannerContext {
  candidates: AutoCandidate[];
  quotas: QuotaConstraint[];
  restWeeks: number;
}

type Step = 1 | 2 | 3 | 4;

interface EmployeeRow {
  id: string;
  day: number;
  slot: MealSlot;
  title: string;
  recipeId: string | null;
  position: number;
  assigned_cook: 'family' | 'employee';
  instructions: string | null;
  cook_part: boolean;
}

const ENTRY_COLUMNS = 'id, day, slot, recipe_id, custom_title, position, assigned_cook, instructions, cook_part';

const sparkle = (color: string, size = 18) => <Ionicons name="sparkles-outline" size={size} color={color} />;

export function AiWeekPlanner(props: {
  visible: boolean;
  weekIso: string;
  planStatus: 'draft' | 'approved' | null;
  entries: PlanEntry[];
  absences: PlanAbsence[];
  ideas: PlanIdea[];
  persons: PlannerPerson[];
  recipes: PlannerRecipe[];
  loadContext: () => Promise<PlannerContext>;
  ensurePlan: () => Promise<string>;
  onChanged: () => Promise<void>;
  onApproved: (summary: { meals: number; employee: number }) => void;
  onClose: () => void;
}) {
  const { visible, weekIso, entries, ideas, persons, recipes } = props;
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const t = d.aiPlan;
  const { householdId } = useHousehold();
  const insets = useSafeAreaInsets();
  const index = useCanonicalIndex();
  const scrollRef = useRef<ScrollView>(null);

  const eaters = useMemo(() => persons.filter((p) => !p.is_employee), [persons]);
  const eaterIds = useMemo(() => eaters.map((p) => p.id), [eaters]);
  const employee = useMemo(() => persons.find((p) => p.is_employee) ?? null, [persons]);
  const child = useMemo(() => findSchoolChild(persons), [persons]);
  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const totalSteps = employee ? 4 : 3;

  const [step, setStep] = useState<Step>(1);
  const [away, setAway] = useState<AwayMap>(new Map());
  const [schoolAnswer, setSchoolAnswer] = useState<'yes' | 'no' | 'some' | null>(null);
  const [outAnswer, setOutAnswer] = useState<'no' | 'yes' | null>(null);
  const [ctx, setCtx] = useState<PlannerContext | null>(null);
  const [counts, setCounts] = useState<MealCounts>({ salad: 2, meat: 3, fish: 2 });
  const [styles, setStyles] = useState<Set<LunchStyle>>(new Set());
  const [ideaPicks, setIdeaPicks] = useState<Set<string>>(new Set());
  const [meals, setMeals] = useState<ProposedMeal[]>([]);
  const [unfilled, setUnfilled] = useState<EmptyCell[]>([]);
  const [sides, setSides] = useState<Map<string, ProposedSide[]>>(new Map());
  const [sideFor, setSideFor] = useState<string | null>(null);
  const [sideQuery, setSideQuery] = useState('');
  const [changeText, setChangeText] = useState('');
  const [chat, setChat] = useState<AiChatTurn[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [parts, setParts] = useState<Map<string, boolean>>(new Map());
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [suggesting, setSuggesting] = useState<string | null>(null);

  // Fresh start every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setStep(1);
    setAway(awayMapFrom(props.absences));
    setSchoolAnswer(null);
    setOutAnswer(null);
    setStyles(new Set());
    setIdeaPicks(new Set(ideas.filter((i) => i.recipe_id).map((i) => i.id)));
    setMeals([]);
    setUnfilled([]);
    setSides(new Map());
    setSideFor(null);
    setChat([]);
    setChangeText('');
    setRows([]);
    setCtx(null);
    let cancelled = false;
    void props.loadContext().then((loaded) => {
      if (cancelled) return;
      setCtx(loaded);
      const min = (cat: string, fallback: number) => {
        const q = loaded.quotas.find((x) => x.category === cat);
        return q && q.min > 0 ? q.min : fallback;
      };
      setCounts({ salad: 2, meat: min('meat', 3), fish: min('fish', 2) });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const futureDays = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].filter((day) => !isPastDay(weekIso, day)),
    [weekIso]
  );
  const lockedKeys = useMemo(() => new Set(entries.map((e) => cellKey(e.day, e.slot))), [entries]);

  /** Meals the AI fills: future, nothing planned yet, and someone eats at home. */
  const openCells = useMemo(() => {
    const cells: EmptyCell[] = [];
    for (const day of futureDays) {
      for (const slot of SLOTS) {
        const key = cellKey(day, slot);
        if (lockedKeys.has(key) || isGoingOut(away.get(key), eaterIds)) continue;
        cells.push({ day, slot });
      }
    }
    return cells;
  }, [futureDays, lockedKeys, away, eaterIds]);

  const candidates = useMemo<AutoCandidate[]>(
    () =>
      (ctx?.candidates ?? []).map((c) => {
        const r = recipeById.get(c.id);
        return { ...c, kinds: r && isSalad(r) ? ['salad'] : [] };
      }),
    [ctx, recipeById]
  );
  const candidateById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  const categoryOf = (recipeId: string | null): ProteinCategory | null => {
    if (!recipeId) return null;
    const r = recipeById.get(recipeId);
    return r ? resolveProteinCategory(r.tags, r.ingredients, index) : null;
  };

  const existingPlanned = useMemo<PlannedMeal[]>(
    () =>
      entries
        .filter((e) => e.position === 0 || !entries.some((o) => o.day === e.day && o.slot === e.slot && o.position < e.position))
        .map((e) => {
          const r = e.recipe_id ? recipeById.get(e.recipe_id) : undefined;
          return {
            day: e.day,
            slot: e.slot,
            category: r ? resolveProteinCategory(r.tags, r.ingredients, index) : null,
            kinds: r && isSalad(r) ? ['salad'] : [],
          };
        }),
    [entries, recipeById, index]
  );

  const recipeIdeas = ideas.filter((i) => i.recipe_id);
  const preferIds = recipeIdeas
    .filter((i) => ideaPicks.has(i.id))
    .map((i) => i.recipe_id)
    .filter((id): id is string => !!id);

  const proposalInput = (avoidIds: string[] = []): ProposalInput => ({
    cells: openCells,
    candidates,
    counts,
    styles,
    away,
    quotas: ctx?.quotas ?? [],
    existing: existingPlanned,
    restWeeks: ctx?.restWeeks ?? 3,
    avoidIds,
    preferIds,
  });

  const dayName = (day: number) => d.common.days[day] ?? '';
  const slotName = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);
  const mealName = (day: number, slot: MealSlot) => `${dayName(day)} · ${slotName(slot)}`;
  const titleOf = (recipeId: string | null, customTitle: string | null) =>
    customTitle ?? (recipeId ? recipeById.get(recipeId)?.title : undefined) ?? d.plan.recipeFallback;

  const range = useMemo(() => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${dayDate(weekIso, 0).toLocaleDateString(locale, opts)} – ${dayDate(weekIso, 6).toLocaleDateString(locale, opts)}`;
  }, [weekIso, locale]);
  const stepLabel = step === 1 ? t.stepHome : step === 2 ? t.stepFood : step === 3 ? t.stepPlan : t.stepEmployee;

  // ---- Step 1: who's home ----------------------------------------------------
  const answerSchool = (answer: 'yes' | 'no' | 'some') => {
    setSchoolAnswer(answer);
    if (!child) return;
    if (answer === 'yes') setAway((m) => withSchoolLunches(m, child.id, true, futureDays));
    if (answer === 'no') setAway((m) => withSchoolLunches(m, child.id, false, futureDays));
  };

  // ---- Step 2 → 3: build the proposal -----------------------------------------
  const makePlan = (avoid: string[] = []) => {
    if (!ctx) return;
    if (openCells.length === 0) {
      notify(t.title, t.nothingToPlan);
      return;
    }
    if (candidates.length === 0) {
      notify(t.title, t.noCandidates);
      return;
    }
    const result = proposeWeek(proposalInput(avoid));
    setMeals(result.meals);
    setUnfilled(result.unfilled);
    setStep(3);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const tryDifferent = () => {
    makePlan(meals.map((m) => m.recipeId).filter((id): id is string => !!id));
    setSides(new Map());
  };

  const swap = (meal: ProposedMeal) => {
    const next = swapMeal(proposalInput(), meals, { day: meal.day, slot: meal.slot });
    if (!next) return;
    setMeals((prev) =>
      prev.map((m) =>
        m.day === meal.day && m.slot === meal.slot ? { day: m.day, slot: m.slot, recipeId: next, customTitle: null } : m
      )
    );
  };

  const addSide = (key: string, side: Omit<ProposedSide, 'key'>) => {
    setSides((prev) => {
      const next = new Map(prev);
      const list = [...(next.get(key) ?? []), { ...side, key: `${key}-${Date.now()}` }];
      next.set(key, list);
      return next;
    });
    setSideFor(null);
    setSideQuery('');
  };

  const removeSide = (key: string, sideKey: string) => {
    setSides((prev) => {
      const next = new Map(prev);
      next.set(key, (next.get(key) ?? []).filter((s) => s.key !== sideKey));
      return next;
    });
  };

  const askChange = async () => {
    const request = changeText.trim();
    if (!request || aiBusy) return;
    setAiBusy(true);
    setChangeText('');
    const history = [...chat, { role: 'user' as const, text: request }];
    setChat(history);
    const mealAt = new Map(meals.map((m) => [cellKey(m.day, m.slot), m]));
    const cells = futureDays.flatMap((day) =>
      SLOTS.map((slot) => {
        const key = cellKey(day, slot);
        const meal = mealAt.get(key);
        const locked = entries.find((e) => e.day === day && e.slot === slot);
        const recipeId = meal?.recipeId ?? locked?.recipe_id ?? null;
        const awaySet = away.get(key);
        const home = eaters.filter((p) => !awaySet?.has(p.id));
        return {
          day,
          slot,
          recipe_id: recipeId,
          title: meal || locked ? titleOf(recipeId, meal?.customTitle ?? locked?.custom_title ?? null) : null,
          category: categoryOf(recipeId),
          locked: !!locked || isGoingOut(awaySet, eaterIds),
          going_out: isGoingOut(awaySet, eaterIds),
          eaters: home.length === eaters.length ? null : home.map((p) => initials(p.name)).join(', '),
        };
      })
    );
    const reply = await aiChangePlan({
      request,
      language: locale,
      cells,
      candidates: candidates.slice(0, 400).map((c) => ({
        id: c.id,
        title: recipeById.get(c.id)?.title ?? '',
        category: c.category,
        salad: (c.kinds ?? []).includes('salad'),
        minutes: c.totalMinutes,
        weeks_since: c.weeksSincePlanned,
      })),
      history: chat,
    });
    setAiBusy(false);
    if (!reply) {
      setChat([...history, { role: 'assistant', text: t.changeFailed }]);
      return;
    }
    setChat([...history, { role: 'assistant', text: reply.message }]);
    if (reply.changes.length === 0) return;
    let nextMeals = [...meals];
    let nextAway = away;
    for (const change of reply.changes) {
      const key = cellKey(change.day, change.slot);
      nextMeals = nextMeals.filter((m) => !(m.day === change.day && m.slot === change.slot));
      if (change.action === 'set') {
        nextMeals.push({ day: change.day, slot: change.slot, recipeId: change.recipe_id, customTitle: change.custom_title });
      } else {
        nextAway = new Map(nextAway);
        nextAway.set(key, new Set(eaterIds));
      }
    }
    nextMeals.sort((a, b) => a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1));
    setMeals(nextMeals);
    setAway(nextAway);
  };

  // ---- Step 3 → 4: save the plan as a draft ----------------------------------
  const savePlan = async (): Promise<string | null> => {
    const planId = await props.ensurePlan();
    // Away marks for the days still ahead; past days keep what they had.
    const del = await supabase.from('plan_absences').delete().eq('meal_plan_id', planId).in('day', futureDays);
    if (del.error) throw new Error(del.error.message);
    const absenceRows = absencesFrom(away)
      .filter((a) => futureDays.includes(a.day))
      .map((a) => ({ meal_plan_id: planId, ...a }));
    if (absenceRows.length > 0) {
      const ins = await supabase.from('plan_absences').insert(absenceRows);
      if (ins.error) throw new Error(ins.error.message);
    }
    const payloads = meals.flatMap((meal) => {
      const key = cellKey(meal.day, meal.slot);
      const personIds = effectivePersonIds([], eaterIds, away.get(key) ?? new Set());
      const base = { mealPlanId: planId, day: meal.day, slot: meal.slot, personIds };
      const main = {
        ...upsertEntryPayload({
          ...base,
          recipeId: meal.recipeId ?? undefined,
          customTitle: meal.recipeId ? undefined : (meal.customTitle ?? undefined),
          position: 0,
        }),
        auto_picked: true,
      };
      const sideRows = (sides.get(key) ?? []).map((side, i) => ({
        ...upsertEntryPayload({
          ...base,
          recipeId: side.recipeId ?? undefined,
          customTitle: side.recipeId ? undefined : (side.customTitle ?? undefined),
          position: i + 1,
        }),
        auto_picked: true,
      }));
      return [main, ...sideRows];
    });
    if (payloads.length > 0) {
      const ins = await supabase.from('plan_entries').insert(payloads);
      if (ins.error) throw new Error(ins.error.message);
    }
    const placed = new Set(meals.map((m) => m.recipeId).filter(Boolean));
    const usedIdeas = ideas.filter((i) => i.recipe_id && placed.has(i.recipe_id));
    if (usedIdeas.length > 0) {
      await supabase.from('plan_ideas').delete().in('id', usedIdeas.map((i) => i.id));
    }
    invalidateLists('plan', 'groceries');
    await props.onChanged();
    return planId;
  };

  const loadRows = async (planId: string) => {
    const { data } = await supabase
      .from('plan_entries')
      .select(ENTRY_COLUMNS)
      .eq('meal_plan_id', planId)
      .in('day', futureDays)
      .order('day')
      .order('position');
    const list = ((data ?? []) as {
      id: string;
      day: number;
      slot: MealSlot;
      recipe_id: string | null;
      custom_title: string | null;
      position: number;
      assigned_cook: 'family' | 'employee';
      instructions: string | null;
      cook_part: boolean | null;
    }[])
      .map((e) => ({
        id: e.id,
        day: e.day,
        slot: e.slot,
        title: titleOf(e.recipe_id, e.custom_title),
        recipeId: e.recipe_id,
        position: e.position,
        assigned_cook: e.assigned_cook,
        instructions: e.instructions,
        cook_part: !!e.cook_part,
      }))
      .sort((a, b) => a.day - b.day || (a.slot === b.slot ? a.position - b.position : a.slot === 'lunch' ? -1 : 1));
    setRows(list);
    setPicks(new Set(list.filter((r) => r.assigned_cook === 'employee').map((r) => r.id)));
    setParts(new Map(list.map((r) => [r.id, r.cook_part])));
    setNotes(new Map(list.map((r) => [r.id, r.instructions ?? ''])));
  };

  const approve = async (planId: string) => {
    const updates = rows
      .map((row) => {
        const picked = picks.has(row.id);
        const note = (notes.get(row.id) ?? '').trim() || null;
        const next = {
          assigned_cook: picked ? ('employee' as const) : ('family' as const),
          instructions: picked ? note : row.instructions,
          cook_part: picked ? !!parts.get(row.id) : false,
        };
        const same =
          next.assigned_cook === row.assigned_cook &&
          next.instructions === row.instructions &&
          next.cook_part === row.cook_part;
        return same ? null : { id: row.id, ...next };
      })
      .filter((u) => u !== null);
    for (const u of updates) {
      const { id, ...patch } = u;
      const res = await supabase.from('plan_entries').update(patch).eq('id', id);
      if (res.error) throw new Error(res.error.message);
    }
    if (props.planStatus !== 'approved') {
      const res = await supabase.from('meal_plans').update({ status: 'approved' }).eq('id', planId);
      if (res.error) throw new Error(res.error.message);
      const { data: all } = await supabase
        .from('plan_entries')
        .select('recipe_id, custom_title, person_ids, day, slot')
        .eq('meal_plan_id', planId);
      const events = plannedEvents((all ?? []) as PlanEntry[], householdId, eaterIds, weekIso);
      if (events.length > 0) await supabase.from('events').insert(events);
    }
    invalidateLists('plan', 'groceries');
    await props.onChanged();
    props.onApproved({ meals: meals.length + entries.length, employee: picks.size });
    props.onClose();
  };

  const confirmPlan = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const planId = await savePlan();
      if (!planId) return;
      if (employee) {
        await loadRows(planId);
        setStep(4);
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      } else {
        await approve(planId);
      }
    } catch {
      notify(t.title, t.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const approveFromStep4 = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await approve(await props.ensurePlan());
    } catch {
      notify(t.title, t.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const suggestPrep = async (row: EmployeeRow) => {
    if (!row.recipeId || suggesting) return;
    setSuggesting(row.id);
    try {
      const { data } = await supabase
        .from('recipes')
        .select('title, language, servings, ingredients, steps')
        .eq('id', row.recipeId)
        .single();
      if (!data) return;
      const language = LOCALES.find((l) => l.code === locale)?.label ?? 'English';
      const reply = await aiAskRecipe(
        {
          title: data.title as string,
          language: (data.language as string) ?? 'fr',
          servings: (data.servings as number | null) ?? null,
          ingredients: (data.ingredients as IngredientRow[]) ?? [],
          steps: (data.steps as string[]) ?? [],
        },
        fmt(t.suggestQuestion, { language })
      );
      if (reply?.answer) {
        setNotes((m) => new Map(m).set(row.id, reply.answer.trim()));
        setParts((m) => new Map(m).set(row.id, true));
      } else {
        notify(t.title, t.changeFailed);
      }
    } finally {
      setSuggesting(null);
    }
  };

  // ---- Rendering helpers -----------------------------------------------------
  const Bubble = ({ children }: { children: ReactNode }) => (
    <View
      style={{
        alignSelf: 'flex-start',
        maxWidth: '88%',
        backgroundColor: colors.bgGrouped,
        borderRadius: 14,
        borderTopLeftRadius: 4,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: fontSize.small, fontFamily: fonts.ui, lineHeight: 21 }}>{children}</Text>
    </View>
  );

  const UserBubble = ({ text }: { text: string }) => (
    <View
      style={{
        alignSelf: 'flex-end',
        maxWidth: '85%',
        backgroundColor: colors.text,
        borderRadius: 14,
        borderTopRightRadius: 4,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: colors.bg, fontSize: fontSize.small, fontFamily: fonts.ui }}>{text}</Text>
    </View>
  );

  const Chip = ({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 16,
        borderRadius: 22,
        justifyContent: 'center',
        borderWidth: selected ? 0 : 1,
        borderColor: colors.border,
        backgroundColor: selected ? colors.text : pressed ? colors.cardPressed : colors.bg,
      })}
    >
      <Text style={{ color: selected ? colors.bg : colors.text, fontSize: fontSize.small, fontFamily: selected ? fonts.uiSemi : fonts.ui }}>
        {label}
      </Text>
    </Pressable>
  );

  const Eyebrow = ({ children }: { children: ReactNode }) => (
    <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontFamily: fonts.uiSemi, letterSpacing: 1.2, textTransform: 'uppercase' }}>
      {children}
    </Text>
  );

  // ---- Step bodies -----------------------------------------------------------
  const whoGrid = (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{t.whoEatsTitle}</Eyebrow>
        </View>
        <Muted>{t.tapToChange}</Muted>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <View style={{ width: 48 }} />
        {SLOTS.map((slot) => (
          <View key={slot} style={{ flex: 1, alignItems: 'center' }}>
            <Eyebrow>{slotName(slot)}</Eyebrow>
          </View>
        ))}
      </View>
      {[0, 1, 2, 3, 4, 5, 6].map((day) => (
        <View key={day} style={{ flexDirection: 'row', gap: 6, alignItems: 'stretch' }}>
          <Text style={{ width: 48, alignSelf: 'center', color: colors.text, fontFamily: fonts.displaySemi, fontSize: fontSize.small }}>
            {dayName(day).slice(0, 3)}
          </Text>
          {SLOTS.map((slot) => {
            const key = cellKey(day, slot);
            const past = !futureDays.includes(day);
            const locked = lockedKeys.has(key);
            const awaySet = away.get(key);
            const out = isGoingOut(awaySet, eaterIds);
            const meal = mealName(day, slot);
            if (past || locked) {
              return (
                <View
                  key={slot}
                  style={{ flex: 1, minHeight: 48, borderRadius: radius.card, backgroundColor: colors.bgGrouped, alignItems: 'center', justifyContent: 'center', opacity: 0.7 }}
                >
                  <Muted>{past ? t.past : t.planned}</Muted>
                </View>
              );
            }
            return (
              <Pressable
                key={slot}
                accessibilityRole="button"
                accessibilityLabel={fmt(t.cellOutA11y, { meal })}
                accessibilityState={{ selected: out }}
                onPress={() => setAway((m) => toggleGoingOut(m, key, eaterIds))}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 48,
                  borderRadius: radius.card,
                  borderWidth: out ? 0 : 1,
                  borderColor: colors.border,
                  backgroundColor: out ? colors.bgGrouped : pressed ? colors.cardPressed : colors.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  padding: 4,
                })}
              >
                {out ? (
                  <>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>{t.goingOut}</Text>
                    <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 }}>{t.noMeal}</Text>
                  </>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {eaters.map((p) => {
                      const home = !awaySet?.has(p.id);
                      return (
                        <Pressable
                          key={p.id}
                          accessibilityRole="switch"
                          accessibilityLabel={fmt(t.personHomeA11y, { name: p.name, meal })}
                          accessibilityState={{ checked: home }}
                          hitSlop={4}
                          onPress={() => setAway((m) => toggleAway(m, key, p.id))}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: home ? (p.avatar_color ?? colors.text) : 'transparent',
                            borderWidth: home ? 0 : 1,
                            borderColor: colors.border,
                          }}
                        >
                          <Text
                            style={{
                              color: home ? '#FFFFFF' : colors.textMuted,
                              fontFamily: fonts.uiSemi,
                              fontSize: 11,
                              textDecorationLine: home ? 'none' : 'line-through',
                            }}
                          >
                            {initials(p.name)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );

  const step1 = (
    <>
      <Bubble>{child ? fmt(t.introSchool, { name: child.name }) : t.introNoChild}</Bubble>
      {child ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label={t.schoolYes} selected={schoolAnswer === 'yes'} onPress={() => answerSchool('yes')} />
            <Chip label={t.schoolNo} selected={schoolAnswer === 'no'} onPress={() => answerSchool('no')} />
            <Chip label={t.schoolSome} selected={schoolAnswer === 'some'} onPress={() => answerSchool('some')} />
          </View>
          {schoolAnswer ? (
            <Bubble>
              {schoolAnswer === 'yes'
                ? fmt(t.schoolAck, { name: child.name })
                : schoolAnswer === 'no'
                  ? fmt(t.schoolNoAck, { name: child.name })
                  : fmt(t.schoolSomeAck, { name: child.name })}
            </Bubble>
          ) : null}
        </>
      ) : null}
      {!child || schoolAnswer ? (
        <>
          <Bubble>{t.goingOutQ}</Bubble>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label={t.goingOutNo} selected={outAnswer === 'no'} onPress={() => setOutAnswer('no')} />
            <Chip label={t.goingOutYes} selected={outAnswer === 'yes'} onPress={() => setOutAnswer('yes')} />
          </View>
          {outAnswer === 'yes' ? <Bubble>{t.goingOutHint}</Bubble> : null}
        </>
      ) : null}
      {whoGrid}
    </>
  );

  const used = counts.salad + counts.meat + counts.fish;
  const step2 = (
    <>
      <Bubble>
        {openCells.length === 1 ? t.mealsAtHomeOne : fmt(t.mealsAtHome, { n: openCells.length })}
        {recipeIdeas.length > 0
          ? ` ${recipeIdeas.length === 1 ? t.ideasIntroOne : fmt(t.ideasIntro, { n: recipeIdeas.length })}`
          : ''}
      </Bubble>
      {recipeIdeas.length > 0 ? (
        <View style={{ backgroundColor: colors.bgGrouped, borderRadius: 12, padding: 12, gap: 8 }}>
          <Eyebrow>{t.ideasTitle}</Eyebrow>
          {recipeIdeas.map((idea) => {
            const on = ideaPicks.has(idea.id);
            const cat = categoryOf(idea.recipe_id);
            return (
              <Pressable
                key={idea.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  setIdeaPicks((prev) => {
                    const next = new Set(prev);
                    if (next.has(idea.id)) next.delete(idea.id);
                    else next.add(idea.id);
                    return next;
                  })
                }
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: 12 }}
              >
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={colors.text} />
                <Text style={{ flex: 1, color: colors.text, fontSize: fontSize.small, fontFamily: fonts.ui }}>
                  {titleOf(idea.recipe_id, null)}
                </Text>
                {cat ? <CategoryDot category={cat} size={8} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Bubble>{t.countsQ}</Bubble>
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14 }}>
        {(
          [
            ['salad', t.salad, t.saladHint, colors.spineVeg],
            ['meat', t.meat, t.meatHint, colors.spineMeat],
            ['fish', t.fish, t.fishHint, colors.spineFish],
          ] as const
        ).map(([kind, label, hint, dot]) => (
          <View key={kind} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontSize: fontSize.base, fontFamily: fonts.uiSemi }}>{label}</Text>
              <Muted>{hint}</Muted>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fmt(t.fewerA11y, { kind: label })}
              disabled={counts[kind] === 0}
              onPress={() => setCounts((c) => ({ ...c, [kind]: Math.max(0, c[kind] - 1) }))}
              style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: counts[kind] === 0 ? 0.4 : 1 }}
            >
              <Ionicons name="remove" size={20} color={colors.text} />
            </Pressable>
            <Text style={{ width: 24, textAlign: 'center', color: colors.text, fontFamily: fonts.display, fontSize: 20 }}>{counts[kind]}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fmt(t.moreA11y, { kind: label })}
              disabled={used >= openCells.length}
              onPress={() => setCounts((c) => ({ ...c, [kind]: c[kind] + 1 }))}
              style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: used >= openCells.length ? 0.4 : 1 }}
            >
              <Ionicons name="add" size={20} color={colors.text} />
            </Pressable>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
          <Muted style={{ flex: 1 }}>{t.restLine}</Muted>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
            {fmt(t.restCount, { n: Math.max(0, openCells.length - used) })}
          </Text>
        </View>
      </View>
      <Bubble>{t.lunchQ}</Bubble>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(
          [
            ['light', t.styleLight],
            ['leftovers', t.styleLeftovers],
            ['salad_when_away', t.styleSaladAway],
          ] as const
        ).map(([style, label]) => (
          <Chip
            key={style}
            label={label}
            selected={styles.has(style)}
            onPress={() =>
              setStyles((prev) => {
                const next = new Set(prev);
                if (next.has(style)) next.delete(style);
                else next.add(style);
                return next;
              })
            }
          />
        ))}
      </View>
    </>
  );

  const counted = tally(meals, candidateById);
  const mealAt = new Map(meals.map((m) => [cellKey(m.day, m.slot), m]));
  const unfilledKeys = new Set(unfilled.map((c) => cellKey(c.day, c.slot)));
  const ideaRecipeIds = new Set(preferIds);

  const sidePicker = (key: string, day: number, slot: MealSlot) => {
    const suggestions = sideSuggestions(recipes, sideQuery);
    const typed = sideQuery.trim();
    return (
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 8, marginTop: 6, backgroundColor: colors.card }}>
        <Eyebrow>{fmt(t.sideTitle, { meal: mealName(day, slot) })}</Eyebrow>
        <TextInput
          accessibilityLabel={t.sideSearchLabel}
          value={sideQuery}
          onChangeText={setSideQuery}
          placeholder={t.sidePlaceholder}
          placeholderTextColor={colors.textMuted}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => (typed ? addSide(key, { recipeId: null, customTitle: typed }) : undefined)}
          style={{ minHeight: 44, borderWidth: 1, borderColor: colors.text, borderRadius: radius.control, paddingHorizontal: 12, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {typed ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => addSide(key, { recipeId: null, customTitle: typed })}
              style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}
            >
              <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small }}>{fmt(t.sideJustName, { name: typed })}</Text>
            </Pressable>
          ) : null}
          {suggestions.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              onPress={() => addSide(key, { recipeId: r.id, customTitle: null })}
              style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}
            >
              <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small }}>
                {r.title} <Text style={{ color: colors.textMuted }}>· {t.sideRecipe}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
        <Muted>{t.sideHint}</Muted>
      </View>
    );
  };

  const step3 = (
    <>
      <Bubble>{t.planIntro}</Bubble>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(
          [
            [t.tallySalad, counted.salad, colors.spineVeg],
            [t.tallyMeat, counted.meat, colors.spineMeat],
            [t.tallyFish, counted.fish, colors.spineFish],
            [t.tallyOther, counted.other, colors.saffron],
          ] as const
        ).map(([label, n, dot]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.bgGrouped }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
            <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.meta }}>{fmt(label, { n })}</Text>
          </View>
        ))}
      </View>
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12 }}>
        {futureDays.map((day, i) => (
          <View key={day} style={{ paddingVertical: 10, gap: 2, borderBottomWidth: i < futureDays.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: fontSize.base }}>{dayName(day)}</Text>
            {SLOTS.map((slot) => {
              const key = cellKey(day, slot);
              const meal = mealAt.get(key);
              const locked = entries.filter((e) => e.day === day && e.slot === slot).sort((a, b) => a.position - b.position);
              const awaySet = away.get(key);
              const out = isGoingOut(awaySet, eaterIds);
              const home = eaters.filter((p) => !awaySet?.has(p.id));
              let title: string;
              let sub: string | null = null;
              let color = colors.text;
              let recipeId: string | null = null;
              if (locked.length > 0) {
                title = locked.map((e) => titleOf(e.recipe_id, e.custom_title)).join(' + ');
                recipeId = locked[0]?.recipe_id ?? null;
                sub = t.alreadyPlanned;
                color = colors.textMuted;
              } else if (out) {
                title = t.goingOut;
                color = colors.textMuted;
              } else if (meal) {
                title = titleOf(meal.recipeId, meal.customTitle);
                recipeId = meal.recipeId;
                if (meal.leftover) sub = fmt(t.leftoverOf, { day: dayName(day - 1) });
                else if (meal.recipeId && ideaRecipeIds.has(meal.recipeId)) sub = t.fromIdeas;
              } else {
                title = unfilledKeys.has(key) ? t.nothingLeft : '—';
                color = colors.textMuted;
              }
              if (!out && home.length > 0 && home.length < eaters.length) {
                const who = home.map((p) => initials(p.name)).join(', ');
                sub = sub ? `${who} · ${sub}` : who;
              }
              const cat = categoryOf(recipeId);
              const editable = locked.length === 0 && !out && !!meal;
              return (
                <View key={slot} style={{ gap: 4, paddingVertical: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
                    <Text style={{ width: 58, color: colors.textMuted, fontFamily: fonts.uiSemi, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
                      {slotName(slot)}
                    </Text>
                    {cat ? <CategoryDot category={cat} size={8} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border }} />}
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={{ color, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{title}</Text>
                      {sub ? <Muted>{sub}</Muted> : null}
                    </View>
                    {editable && meal ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fmt(t.swapA11y, { title })}
                        onPress={() => swap(meal)}
                        style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.cardPressed : colors.bg })}
                      >
                        <Ionicons name="swap-horizontal" size={16} color={colors.text} />
                      </Pressable>
                    ) : null}
                  </View>
                  {editable ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 76 }}>
                      {(sides.get(key) ?? []).map((side) => {
                        const sideTitle = titleOf(side.recipeId, side.customTitle);
                        return (
                          <View key={side.key} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 30, paddingLeft: 10, borderRadius: 15, backgroundColor: colors.bgGrouped }}>
                            <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.meta }}>+ {sideTitle}</Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={fmt(t.removeSideA11y, { title: sideTitle })}
                              onPress={() => removeSide(key, side.key)}
                              hitSlop={6}
                              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Ionicons name="close" size={14} color={colors.textMuted} />
                            </Pressable>
                          </View>
                        );
                      })}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setSideFor(sideFor === key ? null : key);
                          setSideQuery('');
                        }}
                        style={{ minHeight: 30, paddingHorizontal: 10, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.textMuted, justifyContent: 'center' }}
                      >
                        <Text style={{ color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>{t.addSide}</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {sideFor === key ? sidePicker(key, day, slot) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {chat.map((turn, i) =>
        turn.role === 'user' ? <UserBubble key={i} text={turn.text} /> : <Bubble key={i}>{turn.text}</Bubble>
      )}
      {aiBusy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator color={colors.textMuted} />
          <Muted>{t.thinking}</Muted>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 24, paddingLeft: 16, paddingRight: 6, minHeight: 48 }}>
        <TextInput
          accessibilityLabel={t.changeLabel}
          value={changeText}
          onChangeText={setChangeText}
          placeholder={t.changePlaceholder}
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={() => void askChange()}
          returnKeyType="send"
          editable={!aiBusy}
          style={{ flex: 1, minHeight: 44, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.sendA11y}
          onPress={() => void askChange()}
          disabled={!changeText.trim() || aiBusy}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: changeText.trim() ? colors.text : colors.border }}
        >
          <Ionicons name="arrow-up" size={18} color={changeText.trim() ? colors.bg : colors.text} />
        </Pressable>
      </View>
    </>
  );

  const employeeName = employee?.name ?? '';
  const step4 = (
    <>
      <Bubble>{fmt(t.employeeIntro, { name: employeeName })}</Bubble>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(
          [
            ['weekday_lunches', t.presetWeekdayLunches],
            ['weekdays', t.presetWeekdays],
            ['none', t.presetNone],
          ] as [EmployeePreset, string][]
        ).map(([preset, label]) => (
          <Chip
            key={preset}
            label={label}
            selected={false}
            onPress={() => setPicks(presetPicks(rows.map((r) => ({ key: r.id, day: r.day, slot: r.slot })), preset))}
          />
        ))}
      </View>
      {rows.map((row) => {
        const on = picks.has(row.id);
        const part = !!parts.get(row.id);
        return (
          <View
            key={row.id}
            style={{ borderWidth: on ? 1.5 : 1, borderColor: on ? colors.text : colors.border, borderRadius: 12, padding: 12, gap: 10 }}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() =>
                setPicks((prev) => {
                  const next = new Set(prev);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                })
              }
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}
            >
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={colors.text} />
              <View style={{ flex: 1, gap: 1 }}>
                <Eyebrow>{`${mealName(row.day, row.slot)}${row.position > 0 ? ` · ${t.addSide.replace('+', '').trim()}` : ''}`}</Eyebrow>
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>{row.title}</Text>
              </View>
            </Pressable>
            {on ? (
              <>
                <View style={{ flexDirection: 'row', backgroundColor: colors.bgGrouped, borderRadius: radius.card, padding: 3 }}>
                  {(
                    [
                      [false, t.wholeDish],
                      [true, t.partOfIt],
                    ] as const
                  ).map(([value, label]) => {
                    const selected = part === value;
                    return (
                      <Pressable
                        key={label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setParts((m) => new Map(m).set(row.id, value))}
                        style={{ flex: 1, minHeight: 38, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.card : 'transparent' }}
                      >
                        <Text style={{ color: selected ? colors.text : colors.textMuted, fontFamily: selected ? fonts.uiSemi : fonts.ui, fontSize: fontSize.small }}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Eyebrow>{fmt(part ? t.partLabel : t.noteLabel, { name: employeeName })}</Eyebrow>
                  </View>
                  {row.recipeId ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void suggestPrep(row)}
                      disabled={suggesting !== null}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 }}
                    >
                      {suggesting === row.id ? <ActivityIndicator size="small" color={colors.accent} /> : sparkle(colors.accent, 14)}
                      <Text style={{ color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>{t.suggest}</Text>
                    </Pressable>
                  ) : null}
                </View>
                <TextInput
                  accessibilityLabel={fmt(part ? t.partLabel : t.noteLabel, { name: employeeName })}
                  value={notes.get(row.id) ?? ''}
                  onChangeText={(text) => setNotes((m) => new Map(m).set(row.id, text))}
                  placeholder={part ? t.partPlaceholder : t.notePlaceholder}
                  placeholderTextColor={colors.textMuted}
                  multiline
                  style={{ minHeight: 64, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small, textAlignVertical: 'top' }}
                />
                {part ? <Muted>{fmt(t.partHelp, { name: employeeName })}</Muted> : null}
              </>
            ) : null}
          </View>
        );
      })}
    </>
  );

  // ---- Footer -----------------------------------------------------------------
  let footer: ReactNode = null;
  if (step === 1) {
    footer = <Button label={t.next} onPress={() => setStep(2)} />;
  } else if (step === 2) {
    footer = <Button label={t.makePlan} onPress={() => makePlan()} loading={!ctx} />;
  } else if (step === 3) {
    footer = (
      <View style={{ gap: 10 }}>
        <Button label={employee ? t.confirmPlan : t.approveWeek} onPress={() => void confirmPlan()} loading={busy} disabled={meals.length === 0} />
        <Button label={t.tryDifferent} kind="secondary" onPress={tryDifferent} disabled={busy} />
      </View>
    );
  } else {
    footer = (
      <View style={{ gap: 8 }}>
        <Button
          label={picks.size > 0 ? fmt(t.approveWithEmployee, { n: picks.size, name: employeeName }) : t.approveWeek}
          onPress={() => void approveFromStep4()}
          loading={busy}
        />
        <Muted style={{ textAlign: 'center' }}>{fmt(t.approveHint, { name: employeeName })}</Muted>
      </View>
    );
  }

  const canGoBack = step === 2 || step === 3;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ paddingHorizontal: screenPadding, paddingTop: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {canGoBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.backA11y}
                onPress={() => setStep((s) => (s === 3 ? 2 : 1))}
                style={{ width: 36, height: minTapTarget, justifyContent: 'center' }}
              >
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </Pressable>
            ) : (
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' }}>
                {sparkle(colors.bg)}
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 22 }}>{t.title}</Text>
              <Muted>{fmt(t.stepLine, { range, n: step, total: totalSteps, label: stepLabel })}</Muted>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.closeA11y}
              onPress={props.onClose}
              style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {Array.from({ length: totalSteps }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? colors.accent : colors.border }} />
            ))}
          </View>
        </View>
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: screenPadding, gap: 14 }}
        >
          {step === 1 ? step1 : step === 2 ? step2 : step === 3 ? step3 : step4}
        </ScrollView>
        <View style={{ paddingHorizontal: screenPadding, paddingTop: 8, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: colors.border }}>
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
