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
import { useRouter } from 'expo-router';

import { ChangeMealPanel, PlannerPanel, type PanelIdea, type PanelPick, type PanelRecipe } from '@/components/change-meal-panel';
import { initials } from '@/components/person-chip';
import { Button, CategoryDot, Muted } from '@/components/ui';
import {
  FAVOURITE_KIND,
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
  suggestForCell,
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
  type RoutineScoring,
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
import {
  PREV_SUNDAY,
  durationLabel,
  favouriteSets,
  leftoverLinks,
  portionsFor,
  routineLines,
  rulesToCheck,
  scoringRules,
  type PlanRoutine,
  type RoutineRecipe,
} from '@/lib/plan-routine';
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
  /** The household's weekly routine (migration 0039). */
  routine?: PlanRoutine;
  /** Last week's Sunday dinner: Monday's leftovers come from it. */
  prevSundayDinner?: { id: string; recipeId: string | null; customTitle: string | null } | null;
}

type RoutinePart = 'quick' | 'favourites' | 'leftovers' | 'weekend' | `rule:${string}`;

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

const ENTRY_COLUMNS = 'id, day, slot, recipe_id, custom_title, position, assigned_cook, instructions, cook_part, leftover_of';

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
  const rt = d.routine;
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
  /** Routine parts switched off for this week only. */
  const [weekOff, setWeekOff] = useState<Set<RoutinePart>>(new Set());
  /** Nights the leftovers person eats with the others this week. */
  const [chainOff, setChainOff] = useState<Set<number>>(new Set());
  const [changeFor, setChangeFor] = useState<EmptyCell | null>(null);
  const [chainAsk, setChainAsk] = useState<{ target: EmptyCell; pick: PanelPick; day: number; oldTitle: string } | null>(null);
  const [chainChoice, setChainChoice] = useState<'new' | 'off'>('new');
  const [usedIdeaIds, setUsedIdeaIds] = useState<Set<string>>(new Set());
  const [laterIdeas, setLaterIdeas] = useState<PlanIdea[] | null>(null);
  const router = useRouter();

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
    setWeekOff(new Set());
    setChainOff(new Set());
    setChangeFor(null);
    setChainAsk(null);
    setUsedIdeaIds(new Set());
    setLaterIdeas(null);
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

  // ---- The household routine (migration 0039), minus what's off this week ----
  const routine = ctx?.routine ?? null;
  const effective = useMemo<PlanRoutine | null>(
    () =>
      routine
        ? {
            ...routine,
            quick: { ...routine.quick, on: routine.quick.on && !weekOff.has('quick') },
            favourites: weekOff.has('favourites') ? [] : routine.favourites,
            favouritesMin: weekOff.has('favourites') ? 0 : routine.favouritesMin,
            leftovers: { ...routine.leftovers, on: routine.leftovers.on && !weekOff.has('leftovers') },
            weekendLunch: { ...routine.weekendLunch, on: routine.weekendLunch.on && !weekOff.has('weekend') },
            rules: routine.rules.filter((r) => !weekOff.has(`rule:${r.id}`)),
          }
        : null,
    [routine, weekOff]
  );
  const leftoverPerson = effective?.leftovers.on
    ? (eaters.find((p) => p.id === effective.leftovers.personId) ?? null)
    : null;
  const leftoverId = leftoverPerson?.id ?? null;
  /** The leftovers person eats at home that night and the dinner isn't planned by hand. */
  const leftoverHome = (day: number) =>
    !!leftoverId && !away.get(cellKey(day, 'dinner'))?.has(leftoverId) && !lockedKeys.has(cellKey(day, 'dinner'));
  const othersHome = (day: number, slot: MealSlot) =>
    eaters.filter((p) => p.id !== leftoverId && !away.get(cellKey(day, slot))?.has(p.id)).length;
  const preLinkDays = useMemo(() => {
    if (!effective) return new Set<number>();
    const links = leftoverLinks({
      routine: effective,
      days: futureDays,
      personHome: leftoverHome,
      hasDinner: (fd) =>
        fd === PREV_SUNDAY
          ? !!ctx?.prevSundayDinner
          : lockedKeys.has(cellKey(fd, 'dinner')) ||
            (futureDays.includes(fd) && !isGoingOut(away.get(cellKey(fd, 'dinner')), eaterIds)),
      off: chainOff,
    });
    return new Set(links.map((l) => l.day));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective, futureDays, away, lockedKeys, chainOff, ctx, eaterIds, leftoverId]);

  /** Meals the AI fills: future, nothing planned yet, and someone eats at home. */
  const openCells = useMemo(() => {
    const cells: EmptyCell[] = [];
    for (const day of futureDays) {
      for (const slot of SLOTS) {
        const key = cellKey(day, slot);
        if (lockedKeys.has(key) || isGoingOut(away.get(key), eaterIds)) continue;
        // Only the leftovers person is home and they eat last night's dinner.
        if (slot === 'dinner' && preLinkDays.has(day) && othersHome(day, slot) === 0) continue;
        cells.push({ day, slot });
      }
    }
    return cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [futureDays, lockedKeys, away, eaterIds, preLinkDays, leftoverId]);

  const recipeRoutine = useMemo<RoutineRecipe[]>(
    () =>
      recipes.map((r) => ({
        id: r.id,
        title: r.title,
        isSalad: isSalad(r),
        ingredients: (r.ingredients ?? []).map((i) => i.name).filter(Boolean),
        category: resolveProteinCategory(r.tags, r.ingredients, index),
      })),
    [recipes, index]
  );
  const favs = useMemo(
    () =>
      effective
        ? favouriteSets(effective, recipeRoutine)
        : { favouriteIds: new Set<string>(), dayBeforeIds: new Set<string>() },
    [effective, recipeRoutine]
  );
  const scoring = useMemo<RoutineScoring | undefined>(
    () =>
      effective
        ? {
            quickMax: effective.quick.on ? effective.quick.maxMinutes : null,
            weekendMax: effective.weekendLunch.on ? effective.weekendLunch.maxMinutes : null,
            favouriteIds: favs.favouriteIds,
            dayBeforeIds: favs.dayBeforeIds,
            favouritesMin: effective.favouritesMin,
            rules: scoringRules(effective, recipeRoutine),
          }
        : undefined,
    [effective, favs, recipeRoutine]
  );
  const kindsFor = (id: string, salad: boolean) => [
    ...(salad ? ['salad'] : []),
    ...(favs.favouriteIds.has(id) ? [FAVOURITE_KIND] : []),
  ];

  const candidates = useMemo<AutoCandidate[]>(
    () =>
      (ctx?.candidates ?? []).map((c) => {
        const r = recipeById.get(c.id);
        return { ...c, kinds: kindsFor(c.id, !!r && isSalad(r)) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, recipeById, favs]
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
            kinds: e.recipe_id ? kindsFor(e.recipe_id, !!r && isSalad(r)) : [],
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, recipeById, index, favs]
  );

  /** The dinner a leftovers night comes from: this plan, a hand-planned entry, or last Sunday. */
  const dinnerSource = (fd: number): { id: string | null; recipeId: string | null; customTitle: string | null } | null => {
    if (fd === PREV_SUNDAY) return ctx?.prevSundayDinner ?? null;
    const meal = meals.find((m) => m.day === fd && m.slot === 'dinner');
    if (meal && (meal.recipeId || meal.customTitle)) return { id: null, recipeId: meal.recipeId, customTitle: meal.customTitle };
    const entry = entries
      .filter((e) => e.day === fd && e.slot === 'dinner' && !e.leftover_of)
      .sort((a, b) => a.position - b.position)[0];
    return entry ? { id: entry.id, recipeId: entry.recipe_id, customTitle: entry.custom_title } : null;
  };
  const links = effective
    ? leftoverLinks({
        routine: effective,
        days: futureDays,
        personHome: leftoverHome,
        hasDinner: (fd) => !!dinnerSource(fd),
        off: chainOff,
      })
    : [];
  const linkOn = new Map(links.map((l) => [l.day, l]));

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
    routine: scoring,
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
    setChat([]);
    setStep(3);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    // Rules the planner can't follow by itself: Mealy AI checks the plan.
    const toCheck = effective ? rulesToCheck(effective) : [];
    if (toCheck.length > 0) {
      const request = `${rt.rulesCheckRequest}\n${toCheck.map((rule) => `- ${rule.text || rule.title}`).join('\n')}`;
      void runChange(request, { baseMeals: result.meals, userText: null, history: [], lead: [{ role: 'assistant', text: rt.checkingRules }] });
    }
  };

  const tryDifferent = () => {
    makePlan(meals.map((m) => m.recipeId).filter((id): id is string => !!id));
    setSides(new Map());
  };

  // ---- Change one meal (ideas, search, routine picks) ------------------------
  const openChange = (cell: EmptyCell) => {
    setChangeFor(cell);
    if (laterIdeas === null) {
      void supabase
        .from('plan_ideas')
        .select('*')
        .eq('household_id', householdId)
        .gt('week_start', weekIso)
        .order('week_start')
        .limit(30)
        .then(({ data }) => setLaterIdeas((data as PlanIdea[]) ?? []));
    }
  };

  const commitPick = (target: EmptyCell, pick: PanelPick) => {
    setMeals((prev) => {
      const rest = prev.filter((m) => !(m.day === target.day && m.slot === target.slot));
      const next = [...rest, { day: target.day, slot: target.slot, recipeId: pick.recipeId, customTitle: pick.recipeId ? null : pick.customTitle }];
      return next.sort((a, b) => a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1));
    });
    const ideaId = pick.ideaId;
    if (ideaId) setUsedIdeaIds((prev) => new Set(prev).add(ideaId));
  };

  const pickMeal = (pick: PanelPick) => {
    const target = changeFor;
    if (!target) return;
    setChangeFor(null);
    // This dinner also feeds the leftovers person the next night: ask what they eat.
    const feeds = target.slot === 'dinner' && leftoverPerson ? links.find((l) => l.fromDay === target.day) : undefined;
    const current = meals.find((m) => m.day === target.day && m.slot === target.slot);
    if (feeds && current) {
      setChainChoice('new');
      setChainAsk({ target, pick, day: feeds.day, oldTitle: titleOf(current.recipeId, current.customTitle) });
      return;
    }
    commitPick(target, pick);
  };

  const answerChain = () => {
    if (!chainAsk) return;
    commitPick(chainAsk.target, chainAsk.pick);
    if (chainChoice === 'off') setChainOff((prev) => new Set(prev).add(chainAsk.day));
    setChainAsk(null);
  };

  const leaveEmpty = () => {
    const target = changeFor;
    if (!target) return;
    setMeals((prev) => prev.filter((m) => !(m.day === target.day && m.slot === target.slot)));
    setChangeFor(null);
  };

  const eatOut = () => {
    const target = changeFor;
    if (!target) return;
    setAway((m) => toggleGoingOut(m, cellKey(target.day, target.slot), eaterIds));
    setMeals((prev) => prev.filter((m) => !(m.day === target.day && m.slot === target.slot)));
    setChangeFor(null);
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
    setChangeText('');
    await runChange(request, { userText: request });
  };

  const runChange = async (
    request: string,
    opts: { baseMeals?: ProposedMeal[]; userText: string | null; history?: AiChatTurn[]; lead?: AiChatTurn[] }
  ) => {
    setAiBusy(true);
    const base = opts.baseMeals ?? meals;
    const prior = opts.history ?? chat;
    const history = [...(opts.lead ?? []), ...prior, ...(opts.userText ? [{ role: 'user' as const, text: opts.userText }] : [])];
    setChat(history);
    const mealAt = new Map(base.map((m) => [cellKey(m.day, m.slot), m]));
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
      history: prior,
      rules: effective
        ? routineLines(effective, {
            leftoverPerson: leftoverPerson?.name ?? null,
            favourites: effective.favourites.map((f) => f.label),
          })
        : [],
    });
    setAiBusy(false);
    if (!reply) {
      setChat([...history, { role: 'assistant', text: t.changeFailed }]);
      return;
    }
    setChat([...history, { role: 'assistant', text: reply.message }]);
    if (reply.changes.length === 0) return;
    let nextMeals = [...base];
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
      let personIds = effectivePersonIds([], eaterIds, away.get(key) ?? new Set());
      // On a leftovers night, the new dinner is for the others only.
      if (meal.slot === 'dinner' && leftoverId && linkOn.has(meal.day)) {
        personIds = (personIds.length > 0 ? personIds : eaterIds).filter((id) => id !== leftoverId);
        if (personIds.length === 0) return [];
      }
      const base = { mealPlanId: planId, day: meal.day, slot: meal.slot, personIds };
      const main = {
        ...upsertEntryPayload({
          ...base,
          recipeId: meal.recipeId ?? undefined,
          customTitle: meal.recipeId ? undefined : (meal.customTitle ?? undefined),
          position: 0,
          instructions: meal.recipeId && favs.dayBeforeIds.has(meal.recipeId) ? rt.prepNote : undefined,
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
    let inserted: { id: string; day: number; slot: MealSlot; position: number }[] = [];
    if (payloads.length > 0) {
      const ins = await supabase.from('plan_entries').insert(payloads).select('id, day, slot, position');
      if (ins.error) throw new Error(ins.error.message);
      inserted = (ins.data ?? []) as typeof inserted;
    }
    // Leftovers nights: the person's own row, pointing at the dinner it comes from.
    if (leftoverId) {
      const leftoverRows = links.flatMap((link) => {
        const source = dinnerSource(link.fromDay);
        if (!source) return [];
        const sourceId =
          source.id ?? inserted.find((e) => e.day === link.fromDay && e.slot === 'dinner' && e.position === 0)?.id ?? null;
        if (!sourceId) return [];
        return [
          {
            ...upsertEntryPayload({
              mealPlanId: planId,
              day: link.day,
              slot: 'dinner',
              personIds: [leftoverId],
              recipeId: source.recipeId ?? undefined,
              customTitle: source.recipeId ? undefined : (source.customTitle ?? undefined),
              position: 50,
            }),
            auto_picked: true,
            leftover_of: sourceId,
          },
        ];
      });
      if (leftoverRows.length > 0) {
        const ins = await supabase.from('plan_entries').insert(leftoverRows);
        if (ins.error) throw new Error(ins.error.message);
      }
    }
    const placed = new Set(meals.map((m) => m.recipeId).filter(Boolean));
    const usedIdeas = ideas.filter((i) => (i.recipe_id && placed.has(i.recipe_id)) || usedIdeaIds.has(i.id));
    const usedIds = [...new Set([...usedIdeas.map((i) => i.id), ...usedIdeaIds])];
    if (usedIds.length > 0) {
      await supabase.from('plan_ideas').delete().in('id', usedIds);
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
      leftover_of: string | null;
    }[])
      .filter((e) => !e.leftover_of)
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

  const dur = (n: number) => durationLabel(n, rt);
  const routineParts: { key: RoutinePart; label: string }[] = routine
    ? [
        ...(routine.quick.on ? [{ key: 'quick' as const, label: fmt(rt.lineQuick, { time: dur(routine.quick.maxMinutes) }) }] : []),
        ...(routine.favourites.length > 0
          ? [
              {
                key: 'favourites' as const,
                label: fmt(routine.favouritesMin > 0 ? rt.lineFavMin : rt.lineFav, {
                  n: routine.favouritesMin,
                  list: routine.favourites.map((f) => f.label).join(', '),
                }),
              },
            ]
          : []),
        ...(routine.leftovers.on && eaters.some((p) => p.id === routine.leftovers.personId)
          ? [
              {
                key: 'leftovers' as const,
                label: fmt(rt.lineLeft, { name: eaters.find((p) => p.id === routine.leftovers.personId)?.name ?? '' }),
              },
            ]
          : []),
        ...(routine.weekendLunch.on ? [{ key: 'weekend' as const, label: rt.lineWeekend }] : []),
        ...routine.rules
          .filter((rule) => rule.on)
          .map((rule) => ({ key: `rule:${rule.id}` as RoutinePart, label: fmt(rt.lineRule, { rule: rule.title }) })),
      ]
    : [];
  const editRoutine = () => {
    props.onClose();
    router.push('/settings/routine');
  };
  const routineCard = !ctx ? null : routineParts.length === 0 ? (
    <Pressable
      accessibilityRole="button"
      onPress={editRoutine}
      style={({ pressed }) => ({ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: 12, padding: 12, gap: 2, backgroundColor: pressed ? colors.cardPressed : 'transparent' })}
    >
      <Text style={{ color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{rt.setUpRoutine}</Text>
      <Muted>{rt.setUpHint}</Muted>
    </Pressable>
  ) : (
    <>
      <Bubble>{rt.routineIntro}</Bubble>
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 }}>
        {routineParts.map((part) => {
          const on = !weekOff.has(part.key);
          return (
            <Pressable
              key={part.key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() =>
                setWeekOff((prev) => {
                  const next = new Set(prev);
                  if (next.has(part.key)) next.delete(part.key);
                  else next.add(part.key);
                  return next;
                })
              }
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 6 }}
            >
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.text : colors.textMuted} />
              <Text style={{ flex: 1, color: on ? colors.text : colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.small }}>{part.label}</Text>
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="link" onPress={editRoutine} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' }}>
          <Text style={{ color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{rt.editRoutine}</Text>
        </Pressable>
      </View>
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
      {routineCard}
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

  /** Make-ahead dishes: tonight's prep for tomorrow, or "the evening before" on the first day. */
  const prepLines = (day: number) => {
    const lines: string[] = [];
    for (const meal of meals) {
      if (!meal.recipeId || !favs.dayBeforeIds.has(meal.recipeId)) continue;
      const title = titleOf(meal.recipeId, null);
      if (meal.day === day + 1 && futureDays.includes(day)) lines.push(fmt(rt.prepTonight, { title }));
      else if (meal.day === day && !futureDays.includes(day - 1)) lines.push(fmt(rt.prepEvening, { title }));
    }
    if (lines.length === 0) return null;
    return lines.map((line) => (
      <View key={line} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.bgGrouped, marginTop: 4 }}>
        <Ionicons name="time-outline" size={16} color={colors.saffron} />
        <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.meta }}>{line}</Text>
      </View>
    ));
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
              const link = slot === 'dinner' ? linkOn.get(day) : undefined;
              const mainEaters = link ? home.filter((p) => p.id !== leftoverId) : home;
              if (!out && mainEaters.length > 0 && mainEaters.length < eaters.length) {
                const who = mainEaters.map((p) => initials(p.name)).join(', ');
                sub = sub ? `${who} · ${sub}` : who;
              }
              const feeds = slot === 'dinner' && links.some((l) => l.fromDay === day);
              if (meal && feeds) {
                const cook = fmt(rt.cookFor, { n: portionsFor(mainEaters.length, day, links) });
                sub = sub ? `${sub} · ${cook}` : cook;
              }
              const cat = categoryOf(recipeId);
              const editable = locked.length === 0 && !out && !(link && mainEaters.length === 0);
              const cand = meal?.recipeId ? candidateById.get(meal.recipeId) : undefined;
              const tags: { label: string; tone: 'fav' | 'prep' | 'weekend' | 'plain' }[] = [];
              if (meal?.recipeId && cand) {
                const weekday = day <= 4;
                if (weekday && favs.favouriteIds.has(meal.recipeId)) tags.push({ label: rt.tagFavourite, tone: 'fav' });
                if (favs.dayBeforeIds.has(meal.recipeId)) tags.push({ label: rt.tagDayBefore, tone: 'prep' });
                if (!weekday && slot === 'lunch' && effective?.weekendLunch.on && cand.totalMinutes !== null && cand.totalMinutes >= 45)
                  tags.push({ label: rt.tagWeekend, tone: 'weekend' });
                if (cand.totalMinutes !== null) tags.push({ label: dur(cand.totalMinutes), tone: 'plain' });
                if (cand.weeksSincePlanned === null) tags.push({ label: rt.tagNew, tone: 'plain' });
              }
              const leftoverSource = link ? dinnerSource(link.fromDay) : null;
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
                    {editable ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fmt(t.swapA11y, { title })}
                        onPress={() => openChange({ day, slot })}
                        style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.cardPressed : colors.bg })}
                      >
                        <Ionicons name="swap-horizontal" size={16} color={colors.text} />
                      </Pressable>
                    ) : null}
                  </View>
                  {tags.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingLeft: 76 }}>
                      {tags.map((tag) => (
                        <View
                          key={tag.label}
                          style={{
                            paddingHorizontal: 7,
                            paddingVertical: 2,
                            borderRadius: 6,
                            backgroundColor:
                              tag.tone === 'prep' ? colors.saffron : tag.tone === 'weekend' ? colors.accent : colors.bgGrouped,
                          }}
                        >
                          <Text
                            style={{
                              color: tag.tone === 'prep' || tag.tone === 'weekend' ? colors.bg : tag.tone === 'fav' ? colors.spineVeg : colors.textMuted,
                              fontFamily: fonts.uiSemi,
                              fontSize: 11,
                            }}
                          >
                            {tag.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {leftoverPerson && leftoverSource ? (
                    <View style={{ marginLeft: 76, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.bgGrouped }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: colors.bg, fontFamily: fonts.uiSemi, fontSize: 10 }}>{initials(leftoverPerson.name)}</Text>
                      </View>
                      <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.meta }}>
                        {fmt(rt.leftoverLine, {
                          name: leftoverPerson.name,
                          title: titleOf(leftoverSource.recipeId, leftoverSource.customTitle),
                          day: link && link.fromDay === PREV_SUNDAY ? rt.lastSunday : dayName(link ? link.fromDay : day),
                        })}
                      </Text>
                    </View>
                  ) : null}
                  {editable && meal ? (
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
            {prepLines(day)}
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

  // ---- Change-meal panel data ---------------------------------------------------
  const panelRecipes: PanelRecipe[] = changeFor
    ? candidates.flatMap((c) => {
        const recipe = recipeById.get(c.id);
        if (!recipe) return [];
        const meta = [
          ...(favs.favouriteIds.has(c.id) ? [rt.tagFavourite] : []),
          ...(favs.dayBeforeIds.has(c.id) ? [rt.tagDayBefore] : []),
          ...(c.totalMinutes !== null ? [dur(c.totalMinutes)] : []),
        ];
        return [{ id: c.id, title: recipe.title, ingredients: (recipe.ingredients ?? []).map((i) => i.name), meta }];
      })
    : [];
  const ideaDate = (week: string) =>
    dayDate(week, 0).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const panelIdeasWeek: PanelIdea[] = ideas
    .filter((i) => !usedIdeaIds.has(i.id))
    .map((i) => ({ ideaId: i.id, recipeId: i.recipe_id, customTitle: i.custom_title, sub: i.note?.trim() || null }));
  const panelIdeasLater: PanelIdea[] = (laterIdeas ?? [])
    .filter((i) => !usedIdeaIds.has(i.id))
    .map((i) => ({ ideaId: i.id, recipeId: i.recipe_id, customTitle: i.custom_title, sub: fmt(rt.ideaFor, { date: ideaDate(i.week_start) }) }));
  const panelSuggestions = changeFor && ctx ? suggestForCell(proposalInput(), meals, changeFor, 4) : [];
  const changeMeal = changeFor ? meals.find((m) => m.day === changeFor.day && m.slot === changeFor.slot) : undefined;

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
        {changeFor ? (
          <ChangeMealPanel
            title={fmt(rt.changeTitle, { meal: mealName(changeFor.day, changeFor.slot) })}
            currentTitle={changeMeal ? titleOf(changeMeal.recipeId, changeMeal.customTitle) : null}
            recipes={panelRecipes}
            ideasWeek={panelIdeasWeek}
            ideasLater={panelIdeasLater}
            suggestions={panelSuggestions}
            onPick={pickMeal}
            onLeaveEmpty={leaveEmpty}
            onEatingOut={eatOut}
            onClose={() => setChangeFor(null)}
          />
        ) : null}
        {chainAsk && leftoverPerson ? (
          <PlannerPanel
            title={fmt(rt.chainQ, { name: leftoverPerson.name, title: chainAsk.oldTitle, day: dayName(chainAsk.day) })}
            onClose={() => setChainAsk(null)}
            footer={<Button label={rt.replace} onPress={answerChain} />}
          >
            {(
              [
                [
                  'new',
                  fmt(rt.chainNew, {
                    name: leftoverPerson.name,
                    title: titleOf(chainAsk.pick.recipeId, chainAsk.pick.customTitle),
                  }),
                  rt.chainNewHint,
                ],
                ['off', fmt(rt.chainOff, { name: leftoverPerson.name }), rt.chainOffHint],
              ] as const
            ).map(([value, label, hint]) => {
              const selected = chainChoice === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setChainChoice(value)}
                  style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 14, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.text : colors.border }}
                >
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.text} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.base }}>{label}</Text>
                    <Muted>{hint}</Muted>
                  </View>
                </Pressable>
              );
            })}
          </PlannerPanel>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}
