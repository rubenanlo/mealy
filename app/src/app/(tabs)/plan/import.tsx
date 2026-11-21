// "Import a plan": paste a week plan sent as a message (or add screenshots
// of it), check what Mealy read day by day, fix any meal, then save it as a
// draft. Dish matches are remembered for the next import (migration 0041).
// Pure logic lives in lib/plan-import.ts.

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PersonChip } from '@/components/person-chip';
import { RecipeImage } from '@/components/recipe-cards';
import { Button, Eyebrow, Field, Muted } from '@/components/ui';
import { Pill, WeekSheet } from '@/components/week/sheet';
import { findSchoolChild, isSalad, SCHOOL_LUNCH_DAYS } from '@/lib/ai-week';
import { useHousehold } from '@/lib/auth';
import { notify } from '@/lib/confirm';
import { fmt, useI18n } from '@/lib/i18n';
import { backOr } from '@/lib/nav';
import type { MealSlot } from '@/lib/plan';
import {
  buildDrafts,
  buildIdeaDrafts,
  checkReason,
  chooseOption,
  dishPeople,
  draftWeeks,
  foldPhrase,
  ideaRows,
  ideaWeekChoices,
  isoDate,
  keepOnly,
  matchRows,
  movePerson,
  setExtraDish,
  parseIsoDate,
  planRows,
  splitByPerson,
  startChoices,
  type DraftDish,
  type DraftIdea,
  type DraftMeal,
  type ImportedIdea,
  type ImportedMeal,
  type RememberedMatch,
} from '@/lib/plan-import';
import { scoreRecipes, buildSearchIndex } from '@/lib/search-text';
import { supabase } from '@/lib/supabase';
import { floatingActionOffset, fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';
import { localizedTitle } from '@/lib/translations';
import { aiImportPlan, aiPlanText, type MediaAsset } from '@/lib/worker';

interface Person {
  id: string;
  name: string;
  is_employee: boolean;
  avatar_color?: string | null;
}

interface RecipeLite {
  id: string;
  title: string;
  original: string;
  cover_image_path: string | null;
  salad: boolean;
  totalMinutes: number | null;
}

interface RecipeRow {
  id: string;
  title: string;
  cover_image_path: string | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  tags: string[] | null;
  dish_type: string | null;
  recipe_translations: { locale: string; title: string }[] | null;
}

/** Recipe indexes best match first, by search score (scoreRecipes returns one score per recipe). */
function rankRecipes(scores: readonly number[] | null, limit: number): number[] {
  if (!scores) return [];
  return scores
    .map((score, i) => ({ score, i }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.i);
}

type Phase = 'input' | 'reading' | 'preview';
type Tone = 'recipe' | 'quick' | 'out' | 'employee' | 'away' | 'check';

const MAX_SHOTS = 8;
/** The footer sits just above the floating tab bar (8 gap + 64 bar). */
const TAB_BAR_CLEARANCE = floatingActionOffset - 12;

export default function ImportPlanScreen() {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const t = d.planImport;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { householdId } = useHousehold();

  const [tab, setTab] = useState<'paste' | 'shots'>('paste');
  const [text, setText] = useState('');
  const [shots, setShots] = useState<MediaAsset[]>([]);
  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState<string | null>(null);
  const [meals, setMeals] = useState<ImportedMeal[]>([]);
  const [start, setStart] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftMeal[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [recipes, setRecipes] = useState<RecipeLite[]>([]);
  const [memory, setMemory] = useState<RememberedMatch[]>([]);
  const [existing, setExisting] = useState(0);
  const [editKey, setEditKey] = useState<string | null>(null);
  /** The second, third… dish of a split meal being fixed (extras index). */
  const [editExtra, setEditExtra] = useState<{ key: string; index: number } | null>(null);
  const [rawIdeas, setRawIdeas] = useState<ImportedIdea[]>([]);
  const [ideas, setIdeas] = useState<DraftIdea[]>([]);
  /** Which of the two offered weeks the ideas go to, or none. */
  const [ideaChoice, setIdeaChoice] = useState<0 | 1 | 'none'>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: personRows }, { data: recipeRows }, { data: matchRowsData }] = await Promise.all([
        supabase.from('persons').select('id, name, is_employee, avatar_color').eq('household_id', householdId).order('created_at'),
        supabase
          .from('recipes')
          .select('id, title, cover_image_path, prep_minutes, cook_minutes, tags, dish_type, recipe_translations(locale, title)')
          .eq('household_id', householdId)
          .order('title'),
        // Table from migration 0041; until it exists this just returns an error and nothing is remembered.
        supabase.from('plan_import_matches').select('phrase, recipe_id, custom_title').eq('household_id', householdId),
      ]);
      if (cancelled) return;
      setPersons((personRows as Person[]) ?? []);
      setRecipes(
        ((recipeRows ?? []) as RecipeRow[]).map((r) => ({
          id: r.id,
          original: r.title,
          title: localizedTitle(r, locale),
          cover_image_path: r.cover_image_path,
          salad: isSalad(r),
          totalMinutes: r.prep_minutes == null && r.cook_minutes == null ? null : (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0),
        }))
      );
      setMemory((matchRowsData as RememberedMatch[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId, locale]);

  const eaters = useMemo(() => persons.filter((p) => !p.is_employee), [persons]);
  const eaterIds = useMemo(() => eaters.map((p) => p.id), [eaters]);
  const employee = persons.find((p) => p.is_employee) ?? null;
  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const nameOf = (id: string) => persons.find((p) => p.id === id)?.name ?? '';

  const rebuild = (nextMeals: ImportedMeal[], startIso: string) => {
    const schoolChild = findSchoolChild(persons);
    setDrafts(
      buildDrafts(nextMeals, {
        start: parseIsoDate(startIso),
        memory: new Map(memory.map((m) => [m.phrase, m])),
        recipeIds: new Set(recipes.map((r) => r.id)),
        persons,
        schoolChildId: schoolChild?.id ?? null,
        schoolDays: SCHOOL_LUNCH_DAYS,
      })
    );
  };

  const firstMeal = useMemo(
    () => [...meals].sort((a, b) => a.day_index - b.day_index)[0] ?? null,
    [meals]
  );
  const choices = useMemo(() => (firstMeal ? startChoices(firstMeal.weekday, new Date()) : []), [firstMeal]);

  const read = async () => {
    setError(null);
    setPhase('reading');
    let source = text;
    if (tab === 'shots') {
      const transcribed = await aiPlanText(shots);
      if (!transcribed) {
        setError(t.readFailed);
        setPhase('input');
        return;
      }
      source = transcribed;
      setText(transcribed);
    }
    const reply = await aiImportPlan({
      text: source.slice(0, 6000),
      language: locale,
      people: persons.map((p) => ({ id: p.id, name: p.name, employee: p.is_employee })),
      recipes: recipes.map((r) => ({ id: r.id, title: r.original === r.title ? r.title : `${r.original} / ${r.title}` })),
      remembered: memory.map((m) => ({ phrase: m.phrase, recipe_id: m.recipe_id, title: m.custom_title })),
    });
    if (!reply) {
      setError(t.readFailed);
      setPhase('input');
      return;
    }
    if (reply.meals.length === 0 && reply.ideas.length === 0) {
      setError(t.nothingFound);
      setPhase('input');
      return;
    }
    const first = [...reply.meals].sort((a, b) => a.day_index - b.day_index)[0];
    const startIso = first ? startChoices(first.weekday, new Date())[0] : isoDate(new Date());
    setMeals(reply.meals);
    setStart(startIso);
    rebuild(reply.meals, startIso);
    setRawIdeas(reply.ideas);
    setIdeaChoice(0);
    setIdeas(
      buildIdeaDrafts(
        reply.ideas,
        new Map(memory.map((m) => [m.phrase, m])),
        new Set(recipes.map((r) => r.id))
      )
    );
    setPhase('preview');
  };

  const pickStart = (iso: string) => {
    setStart(iso);
    rebuild(meals, iso);
  };

  // How many meals already planned in the cells the import fills (they get replaced).
  useEffect(() => {
    if (phase !== 'preview' || drafts.length === 0) return;
    let cancelled = false;
    const weeks = planRows(drafts, eaterIds);
    (async () => {
      const { data } = await supabase
        .from('meal_plans')
        .select('week_start, plan_entries(day, slot)')
        .eq('household_id', householdId)
        .in('week_start', draftWeeks(drafts));
      if (cancelled) return;
      let n = 0;
      for (const plan of (data ?? []) as { week_start: string; plan_entries: { day: number; slot: MealSlot }[] }[]) {
        const cells = weeks.find((w) => w.week === plan.week_start)?.cells ?? [];
        const filled = new Set(cells.map((c) => `${c.day}-${c.slot}`));
        const mains = new Set(plan.plan_entries.map((e) => `${e.day}-${e.slot}`));
        n += [...mains].filter((k) => filled.has(k)).length;
      }
      setExisting(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, drafts, eaterIds, householdId]);

  const ideaWeeks = useMemo(
    () => (start ? ideaWeekChoices(rawIdeas, drafts, parseIsoDate(start)) : null),
    [rawIdeas, drafts, start]
  );
  const ideaWeek = ideaWeeks && ideaChoice !== 'none' ? ideaWeeks[ideaChoice] : null;
  const ideasOn = ideaWeek ? ideas.filter((i) => i.on).length : 0;
  const updateIdea = (next: DraftIdea) => setIdeas((all) => all.map((x) => (x.key === next.key ? next : x)));

  const update = (next: DraftMeal) => setDrafts((all) => all.map((x) => (x.key === next.key ? next : x)));

  const recipeIdFor = (title: string) => {
    const want = foldPhrase(title);
    return recipes.find((r) => foldPhrase(r.title) === want || foldPhrase(r.original) === want)?.id ?? null;
  };

  const save = async () => {
    setSaving(true);
    try {
      const weeks = planRows(drafts, eaterIds);
      let ideaCount = 0;
      if (ideaWeek && ideasOn > 0) {
        const { data: had } = await supabase
          .from('plan_ideas')
          .select('recipe_id, custom_title')
          .eq('household_id', householdId)
          .eq('week_start', ideaWeek);
        const rows = ideaRows(ideas, ideaWeek, (had as { recipe_id: string | null; custom_title: string | null }[] | null) ?? []);
        if (rows.length > 0) {
          const { error: ideaError } = await supabase
            .from('plan_ideas')
            .insert(rows.map((r) => ({ ...r, household_id: householdId })));
          if (ideaError) throw ideaError;
        }
        ideaCount = rows.length;
      }
      for (const week of weeks) {
        const { data: found } = await supabase
          .from('meal_plans')
          .select('id')
          .eq('household_id', householdId)
          .eq('week_start', week.week)
          .maybeSingle();
        let planId = (found?.id as string | undefined) ?? null;
        if (!planId) {
          const { data: created, error: createError } = await supabase
            .from('meal_plans')
            .insert({ household_id: householdId, week_start: week.week })
            .select('id')
            .single();
          if (createError) throw createError;
          planId = created.id as string;
        }
        for (const cell of week.cells) {
          await supabase.from('plan_entries').delete().eq('meal_plan_id', planId).eq('day', cell.day).eq('slot', cell.slot);
          await supabase.from('plan_absences').delete().eq('meal_plan_id', planId).eq('day', cell.day).eq('slot', cell.slot);
        }
        if (week.entries.length > 0) {
          const { error: insertError } = await supabase
            .from('plan_entries')
            .insert(week.entries.map((e) => ({ ...e, meal_plan_id: planId })));
          if (insertError) throw insertError;
        }
        if (week.absences.length > 0) {
          await supabase.from('plan_absences').upsert(
            week.absences.map((a) => ({ ...a, meal_plan_id: planId })),
            { onConflict: 'meal_plan_id,day,slot,person_id', ignoreDuplicates: true }
          );
        }
      }
      const matches = matchRows(drafts, ideaWeek ? ideas : []);
      if (matches.length > 0) {
        // Best effort: without migration 0041 this fails quietly and nothing is remembered.
        await supabase
          .from('plan_import_matches')
          .upsert(
            matches.map((m) => ({ ...m, household_id: householdId, updated_at: new Date().toISOString() })),
            { onConflict: 'household_id,phrase' }
          );
      }
      const count = weeks.reduce((n, w) => n + w.cells.length, 0);
      notify(ideaCount > 0 ? fmt(t.savedWithIdeas, { n: count, m: ideaCount }) : fmt(t.saved, { n: count }));
      router.replace({
        pathname: '/plan/detail',
        params: { week: weeks[0]?.week ?? (ideaCount > 0 ? ideaWeek : null) ?? draftWeeks(drafts)[0] },
      });
    } catch {
      notify(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const clip = await Clipboard.getStringAsync();
      if (clip.trim()) {
        setText(clip);
        setError(null);
      } else setError(t.clipboardEmpty);
    } catch {
      setError(t.clipboardEmpty);
    }
  };

  const pickShots = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    setShots((prev) =>
      [
        ...prev,
        ...picked.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg', fileName: a.fileName ?? null })),
      ].slice(0, MAX_SHOTS)
    );
  };

  // ---- Bits of UI ----------------------------------------------------------

  const toneColor = (tone: Tone) =>
    ({
      recipe: colors.spineVeg,
      quick: colors.textMuted,
      out: colors.spineFish,
      employee: colors.spineMeat,
      away: colors.textMuted,
      check: colors.saffron,
    })[tone];

  const tag = (label: string, tone: Tone, key: string) => (
    <View
      key={key}
      style={{
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: colors.bgGrouped,
      }}
    >
      <Text style={{ color: toneColor(tone), fontFamily: fonts.uiSemi, fontSize: fontSize.eyebrow }}>{label}</Text>
    </View>
  );

  const dishTitle = (dish: { recipeId: string | null; title: string }) =>
    (dish.recipeId ? recipeById.get(dish.recipeId)?.title : null) ?? dish.title;

  const dayLabel = (iso: string) =>
    parseIsoDate(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric' });
  const shortDate = (iso: string) =>
    parseIsoDate(iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);

  const counted = drafts.filter((x) => x.kind !== 'empty');
  const checks = drafts.filter((x) => checkReason(x) !== null).length;

  // ---- Input ---------------------------------------------------------------

  const inputView = (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 120, gap: 16 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={{ flexDirection: 'row', gap: 4, backgroundColor: colors.bgGrouped, borderRadius: 12, padding: 4 }}>
        {(['paste', 'shots'] as const).map((key) => {
          const selected = tab === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setTab(key)}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? colors.bg : 'transparent',
              }}
            >
              <Text style={{ color: selected ? colors.text : colors.textMuted, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
                {key === 'paste' ? t.pasteTab : t.shotsTab}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'paste' ? (
        <View style={{ gap: 8 }}>
          <Muted>{t.pasteHint}</Muted>
          <Pressable
            accessibilityRole="button"
            onPress={() => void pasteFromClipboard()}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: minTapTarget,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.text,
              backgroundColor: pressed ? colors.cardPressed : 'transparent',
            })}
          >
            <Ionicons name="clipboard-outline" size={18} color={colors.text} />
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
              {text.trim() ? t.pasteAgain : t.pasteButton}
            </Text>
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder={t.pastePlaceholder}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t.pasteTab}
            textAlignVertical="top"
            style={{
              minHeight: 280,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              padding: 14,
              color: colors.text,
              fontFamily: fonts.ui,
              fontSize: fontSize.small,
              lineHeight: 22,
            }}
          />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Muted>{t.shotsHint}</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {shots.map((shot, i) => (
              <View
                key={`${shot.uri}-${i}`}
                style={{ width: 100, height: 200, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}
              >
                <Image source={{ uri: shot.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                <View
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: colors.text,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.bg, fontFamily: fonts.uiSemi, fontSize: fontSize.eyebrow }}>{i + 1}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fmt(t.removeShotA11y, { n: i + 1 })}
                  onPress={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 36,
                    height: 36,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="close-circle" size={24} color={colors.text} />
                </Pressable>
              </View>
            ))}
            {shots.length < MAX_SHOTS ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.addShot}
                onPress={() => void pickShots()}
                style={({ pressed }) => ({
                  width: 100,
                  height: 200,
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderStyle: 'dashed',
                  borderColor: colors.textMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: pressed ? colors.cardPressed : 'transparent',
                })}
              >
                <Ionicons name="add" size={26} color={colors.text} />
                <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.meta }}>{t.addShot}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {error ? <Text style={{ color: colors.danger, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{error}</Text> : null}
    </ScrollView>
  );

  const canRead = tab === 'paste' ? text.trim().length > 0 : shots.length > 0;
  const readLabel =
    tab === 'paste' ? t.read : shots.length === 1 ? t.readShotsOne : fmt(t.readShots, { n: shots.length || 0 });

  // ---- Preview -------------------------------------------------------------

  const answerButton = (label: string, onPress: () => void, key: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.text,
        justifyContent: 'center',
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{label}</Text>
    </Pressable>
  );

  const coverOf = (dish: DraftDish | null) =>
    dish?.recipeId ? (recipeById.get(dish.recipeId)?.cover_image_path ?? null) : null;
  const matchTag = (dish: DraftDish, key: string) =>
    dish.recipeId
      ? tag(dish.fromMemory ? t.remembered : t.inRecipes, 'recipe', key)
      : tag(dish.fromMemory ? t.remembered : t.quick, 'quick', key);
  const employeeTag = (draft: DraftMeal) =>
    employee && draft.employeePart
      ? tag(fmt(t.employeePart, { name: employee.name, part: draft.employeePart }), 'employee', 'emp')
      : employee && draft.employeeWhole
        ? tag(fmt(t.employeeWhole, { name: employee.name }), 'employee', 'emp')
        : null;
  const pencil = (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="pencil-outline" size={15} color={colors.text} />
    </View>
  );

  /** One dish of a split meal, as a week-page card: photo, title, faces (tap to move someone here). */
  const dishCard = (draft: DraftMeal, dish: DraftDish, index: number, people: string[][], label: string | null) => {
    const mine = people[index];
    const home = eaters.filter((p) => !draft.awayIds.includes(p.id));
    return (
      <View
        key={`${draft.key}-${index}`}
        style={{ flex: 1, minWidth: 140, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fmt(t.editA11y, { slot: slotLabel(draft.slot), day: dayLabel(draft.date) })}
          onPress={() => (index === 0 ? setEditKey(draft.key) : setEditExtra({ key: draft.key, index: index - 1 }))}
        >
          <RecipeImage path={coverOf(dish)} style={{ width: '100%', height: 72 }} iconSize={20} />
          <View style={{ position: 'absolute', top: 6, right: 6 }}>{pencil}</View>
          <Text
            numberOfLines={2}
            style={{ paddingHorizontal: 10, paddingTop: 8, color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small, lineHeight: 19 }}
          >
            {dishTitle(dish)}
          </Text>
        </Pressable>
        <View style={{ padding: 10, paddingTop: 6, gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginLeft: -6 }}>
            {home.map((p) => (
              <PersonChip
                key={p.id}
                person={p}
                hollow={!mine.includes(p.id)}
                onPress={() => update(movePerson(draft, p.id, index))}
              />
            ))}
          </View>
          {mine.length === 0 ? (
            <Text style={{ color: toneColor('check'), fontFamily: fonts.uiSemi, fontSize: fontSize.eyebrow }}>
              {label ? fmt(t.whoLabel, { label }) : t.whoEatsThis}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {matchTag(dish, 'match')}
            {index === 0 ? employeeTag(draft) : null}
          </View>
        </View>
      </View>
    );
  };

  const mealCard = (draft: DraftMeal) => {
    const reason = checkReason(draft);
    const split = draft.kind === 'dish' && draft.main && draft.extras.length > 0 && reason !== 'split';
    const people = dishPeople(draft, eaterIds);
    const tags: React.ReactNode[] = [];
    let title: string;
    if (draft.kind === 'out') {
      title = t.eatingOut;
      tags.push(tag(t.everyoneOut, 'out', 'out'));
    } else if (draft.kind === 'empty' || !draft.main) {
      title = draft.missing ? t.missingTitle : t.leaveEmpty;
    } else {
      title = reason === 'split' ? [draft.main, ...draft.extras.map((x) => x.dish)].map(dishTitle).join(' / ') : dishTitle(draft.main);
      if (draft.options.length > 0) tags.push(tag(t.undecided, 'check', 'undecided'));
      if (reason !== 'split') {
        tags.push(matchTag(draft.main, 'match'));
        const emp = employeeTag(draft);
        if (emp) tags.push(emp);
      }
    }
    if (draft.kind !== 'out') {
      for (const id of draft.awayIds) tags.push(tag(fmt(t.away, { name: nameOf(id) }), 'away', `away-${id}`));
    }
    const subLines: string[] = [];
    if (draft.kind === 'dish') {
      for (const side of draft.sides) subLines.push(fmt(t.side, { title: dishTitle(side) }));
      if (draft.note) subLines.push(draft.note);
    }
    const quote = draft.source ? (
      <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.eyebrow, fontStyle: 'italic' }}>
        “{draft.source}”
      </Text>
    ) : null;
    const slotText = (
      <Text
        style={{
          width: 62,
          color: colors.textMuted,
          fontFamily: fonts.uiSemi,
          fontSize: fontSize.eyebrow,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          paddingTop: split ? 6 : 16,
        }}
      >
        {slotLabel(draft.slot)}
      </Text>
    );

    if (split && draft.main) {
      return (
        <View key={draft.key} style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
          {slotText}
          <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {dishCard(draft, draft.main, 0, people, null)}
              {draft.extras.map((x, i) => dishCard(draft, x.dish, i + 1, people, x.label))}
            </View>
            {subLines.length > 0 ? <Muted>{subLines.join('\n')}</Muted> : null}
            {draft.awayIds.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {draft.awayIds.map((id) => tag(fmt(t.away, { name: nameOf(id) }), 'away', `away-${id}`))}
              </View>
            ) : null}
            {quote}
          </View>
        </View>
      );
    }

    return (
      <View
        key={draft.key}
        style={{
          flexDirection: 'row',
          gap: 8,
          marginHorizontal: 4,
          paddingHorizontal: 8,
          paddingVertical: 10,
          borderRadius: 14,
          backgroundColor: reason ? colors.bgGrouped : 'transparent',
        }}
      >
        {slotText}
        <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={fmt(t.editA11y, { slot: slotLabel(draft.slot), day: dayLabel(draft.date) })}
            onPress={() => setEditKey(draft.key)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}
          >
            {draft.kind === 'dish' && draft.main && reason !== 'split' ? (
              <RecipeImage path={coverOf(draft.main)} style={{ width: 48, height: 48, borderRadius: radius.thumb }} iconSize={18} />
            ) : null}
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.base, lineHeight: 21 }}>{title}</Text>
              {subLines.length > 0 ? <Muted>{subLines.join('\n')}</Muted> : null}
            </View>
            {pencil}
          </Pressable>
          {tags.length > 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{tags}</View> : null}

          {reason === 'split' && draft.main ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{t.splitAsk}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {answerButton(t.splitByPerson, () => update(splitByPerson(draft)), 'split')}
                {[draft.main, ...draft.extras.map((x) => x.dish)].map((dish, i) =>
                  answerButton(fmt(t.onlyDish, { title: dishTitle(dish) }), () => update(keepOnly(draft, i)), `only-${i}`)
                )}
              </View>
            </View>
          ) : null}
          {reason === 'undecided' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {draft.options.map((option, i) =>
                answerButton(option, () => update(chooseOption(draft, option, recipeIdFor)), `opt-${i}`)
              )}
            </View>
          ) : null}
          {reason === 'missing' ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{t.missingAsk}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {answerButton(t.leaveEmpty, () => update({ ...draft, missing: false }), 'leave')}
                {answerButton(t.addMeal, () => setEditKey(draft.key), 'add')}
              </View>
            </View>
          ) : null}
          {quote}
        </View>
      </View>
    );
  };

  const firstWeek = drafts[0]?.week;
  const weekShort = (iso: string) => parseIsoDate(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const ideasNext = rawIdeas.some((i) => i.when === 'next_week');
  const allOn = ideas.every((i) => i.on);
  const ideaRecipes = ideas.filter((i) => i.dish.recipeId).length;

  const checkBox = (on: boolean) => (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? colors.text : 'transparent',
        borderWidth: on ? 0 : 2,
        borderColor: colors.textMuted,
      }}
    >
      {on ? <Ionicons name="checkmark" size={15} color={colors.bg} /> : null}
    </View>
  );

  const ideasSection =
    ideas.length > 0 && ideaWeeks ? (
      <View style={{ marginTop: 18, marginHorizontal: -8, backgroundColor: colors.bgGrouped, paddingHorizontal: 20, paddingVertical: 18, gap: 14 }}>
        <View style={{ gap: 4 }}>
          {ideas[0].heading ? <Eyebrow>{`“${ideas[0].heading}”`.toUpperCase()}</Eyebrow> : null}
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: fontSize.dayName }}>
            {ideasNext
              ? ideas.length === 1
                ? t.ideasTitleOne
                : fmt(t.ideasTitle, { n: ideas.length })
              : ideas.length === 1
                ? t.ideasTitleLaterOne
                : fmt(t.ideasTitleLater, { n: ideas.length })}
          </Text>
          <Muted>{t.ideasSub}</Muted>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>{t.saveTo}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pill
              label={
                ideasNext ? fmt(t.ideaNextWeek, { date: weekShort(ideaWeeks[0]) }) : fmt(t.ideaWeek, { date: weekShort(ideaWeeks[0]) })
              }
              selected={ideaChoice === 0}
              onPress={() => setIdeaChoice(0)}
            />
            <Pill
              label={fmt(t.ideaWeekAfter, { date: weekShort(ideaWeeks[1]) })}
              selected={ideaChoice === 1}
              onPress={() => setIdeaChoice(1)}
            />
            <Pill label={t.dontImport} selected={ideaChoice === 'none'} onPress={() => setIdeaChoice('none')} />
          </View>
        </View>

        {ideaChoice !== 'none' ? (
          <>
            <View style={{ backgroundColor: colors.bg, borderRadius: 16, overflow: 'hidden' }}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allOn }}
                onPress={() => setIdeas((all) => all.map((x) => ({ ...x, on: !allOn })))}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 48,
                  paddingHorizontal: 14,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                }}
              >
                {checkBox(allOn)}
                <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
                  {fmt(t.allIdeas, { n: ideas.length })}
                </Text>
                {ideaRecipes > 0 ? <Muted>{fmt(t.inYourRecipes, { n: ideaRecipes })}</Muted> : null}
              </Pressable>
              {ideas.map((idea, i) => (
                <View
                  key={idea.key}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    borderBottomWidth: i === ideas.length - 1 ? 0 : 1,
                    borderColor: colors.border,
                  }}
                >
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: idea.on }}
                    accessibilityLabel={dishTitle(idea.dish)}
                    onPress={() => updateIdea({ ...idea, on: !idea.on })}
                    style={{ paddingLeft: 14, paddingRight: 6, paddingVertical: 11, minHeight: minTapTarget }}
                  >
                    {checkBox(idea.on)}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fmt(t.editIdeaA11y, { title: dishTitle(idea.dish) })}
                    onPress={() => setEditKey(idea.key)}
                    style={({ pressed }) => ({
                      flex: 1,
                      minWidth: 0,
                      gap: 4,
                      paddingVertical: 11,
                      paddingLeft: 6,
                      paddingRight: 14,
                      backgroundColor: pressed ? colors.cardPressed : 'transparent',
                      opacity: idea.on ? 1 : 0.5,
                    })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.base, lineHeight: 20 }}>
                        {dishTitle(idea.dish)}
                      </Text>
                      {idea.dish.fromMemory
                        ? tag(t.remembered, 'recipe', 'm')
                        : idea.dish.recipeId
                          ? tag(t.inRecipes, 'recipe', 'r')
                          : tag(t.quick, 'quick', 'q')}
                    </View>
                    {idea.source ? (
                      <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.eyebrow, fontStyle: 'italic' }}>
                        “{idea.source}”
                      </Text>
                    ) : null}
                  </Pressable>
                </View>
              ))}
            </View>
            <Muted>{t.ideasHint}</Muted>
          </>
        ) : null}
      </View>
    ) : null;

  const previewView = (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 160, gap: 4 }}>
      <View style={{ paddingHorizontal: 12, gap: 10, paddingBottom: 6 }}>
        <Muted>
          {fmt(t.fromRange, {
            from: drafts[0] ? shortDate(drafts[0].date) : '',
            to: drafts.at(-1) ? shortDate(drafts.at(-1)!.date) : '',
            n: counted.length,
          })}
        </Muted>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {tag(fmt(t.ready, { n: drafts.length - checks }), 'recipe', 'ready')}
          {checks > 0 ? tag(fmt(t.toCheck, { n: checks }), 'check', 'check') : null}
        </View>
        {choices.length > 0 ? (
          <View style={{ gap: 6 }}>
            <Eyebrow>{t.startsOn.toUpperCase()}</Eyebrow>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {choices.map((iso) => (
                <Pill key={iso} label={shortDate(iso)} selected={iso === start} onPress={() => pickStart(iso)} />
              ))}
            </View>
            {firstMeal ? <Muted>{fmt(t.startsHint, { word: firstMeal.day_word })}</Muted> : null}
          </View>
        ) : null}
      </View>

      {[...new Set(drafts.map((x) => x.date))].map((date) => {
        const dayDrafts = drafts.filter((x) => x.date === date);
        const week = dayDrafts[0].week;
        const firstOfWeek = drafts.find((x) => x.week === week)?.date === date;
        return (
          <View key={date} style={{ gap: 2, paddingTop: 12 }}>
            {firstOfWeek && week !== firstWeek ? (
              <View style={{ marginHorizontal: 12, marginBottom: 10, paddingTop: 14, borderTopWidth: 1, borderColor: colors.border }}>
                <Eyebrow>
                  {fmt(t.nextWeek, {
                    range: `${shortDate(week)} – ${shortDate(
                      (() => {
                        const end = parseIsoDate(week);
                        end.setDate(end.getDate() + 6);
                        return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
                      })()
                    )}`,
                  }).toUpperCase()}
                </Eyebrow>
              </View>
            ) : null}
            <Text
              style={{
                paddingHorizontal: 12,
                paddingBottom: 2,
                color: colors.text,
                fontFamily: fonts.display,
                fontSize: fontSize.dayName,
                textTransform: 'capitalize',
              }}
            >
              {dayLabel(date)}
            </Text>
            {dayDrafts.map(mealCard)}
          </View>
        );
      })}
      {ideasSection}
      <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
        <Muted>{t.rememberNote}</Muted>
      </View>
    </ScrollView>
  );

  const editing = drafts.find((x) => x.key === editKey) ?? null;
  const editingIdea = ideas.find((x) => x.key === editKey) ?? null;
  const extraOwner = editExtra ? (drafts.find((x) => x.key === editExtra.key) ?? null) : null;
  const editingExtra = extraOwner && editExtra ? (extraOwner.extras[editExtra.index] ?? null) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: screenPadding, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.common.back}
          onPress={() => (phase === 'preview' ? setPhase('input') : backOr('/plan'))}
          style={{ width: 36, height: minTapTarget, justifyContent: 'center', marginLeft: -8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text
          accessibilityRole="header"
          style={{ flex: 1, color: colors.text, fontFamily: fonts.display, fontSize: fontSize.heroTitle }}
        >
          {phase === 'preview' ? t.checkTitle : t.title}
        </Text>
      </View>

      {phase === 'reading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <ActivityIndicator color={colors.text} />
          <Muted>{t.reading}</Muted>
        </View>
      ) : phase === 'preview' ? (
        previewView
      ) : (
        inputView
      )}

      {phase !== 'reading' ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            // Above the floating tab bar, which this tab screen keeps showing.
            bottom: insets.bottom + TAB_BAR_CLEARANCE,
            backgroundColor: colors.bg,
            borderTopWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: screenPadding,
            paddingTop: 12,
            paddingBottom: 10,
            gap: 6,
          }}
        >
          {phase === 'preview' ? (
            <>
              <Button
                label={
                  ideasOn > 0
                    ? counted.length === 1
                      ? fmt(t.saveWithIdeasOne, { m: ideasOn })
                      : fmt(t.saveWithIdeas, { n: counted.length, m: ideasOn })
                    : counted.length === 1
                      ? t.saveOne
                      : fmt(t.save, { n: counted.length })
                }
                onPress={() => void save()}
                loading={saving}
                disabled={counted.length === 0 && ideasOn === 0}
              />
              <Text style={{ textAlign: 'center', color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.eyebrow }}>
                {existing > 0
                  ? fmt(t.replaces, { n: existing })
                  : checks > 0
                    ? t.saveHint
                    : ideaWeek && ideasOn > 0
                      ? fmt(t.ideasTo, { date: weekShort(ideaWeek) })
                      : ''}
              </Text>
            </>
          ) : (
            <Button label={readLabel} onPress={() => void read()} disabled={!canRead || persons.length === 0} />
          )}
        </View>
      ) : null}

      {editing ? (
        <FixMealSheet
          key={editing.key}
          draft={editing}
          title={`${dayLabel(editing.date)} · ${slotLabel(editing.slot)}`}
          recipes={recipes}
          eaters={eaters}
          employee={employee}
          onClose={() => setEditKey(null)}
          onDone={(next) => {
            update(next);
            setEditKey(null);
          }}
        />
      ) : null}
      {extraOwner && editExtra && editingExtra ? (
        <FixMealSheet
          key={`${extraOwner.key}-extra-${editExtra.index}`}
          ideaOnly
          draft={{ ...ideaAsDraft({ key: extraOwner.key, heading: '', source: extraOwner.source, dish: editingExtra.dish, on: true }) }}
          title={`${dayLabel(extraOwner.date)} · ${slotLabel(extraOwner.slot)}`}
          recipes={recipes}
          eaters={eaters}
          employee={null}
          onClose={() => setEditExtra(null)}
          onDone={(next) => {
            update(setExtraDish(extraOwner, editExtra.index, next.main));
            setEditExtra(null);
          }}
        />
      ) : null}
      {editingIdea ? (
        <FixMealSheet
          key={editingIdea.key}
          ideaOnly
          draft={ideaAsDraft(editingIdea)}
          title={dishTitle(editingIdea.dish)}
          recipes={recipes}
          eaters={eaters}
          employee={null}
          onClose={() => setEditKey(null)}
          onDone={(next) => {
            updateIdea({ ...editingIdea, on: Boolean(next.main), dish: next.main ?? editingIdea.dish });
            setEditKey(null);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

// ---- Fix one meal --------------------------------------------------------------

/** An idea dressed as a meal so the same sheet can fix its recipe or name. */
function ideaAsDraft(idea: DraftIdea): DraftMeal {
  return {
    key: idea.key,
    date: '',
    week: '',
    day: 0,
    slot: 'lunch',
    source: idea.source,
    kind: 'dish',
    main: idea.dish,
    sides: [],
    extras: [],
    awayIds: [],
    employeePart: null,
    employeeWhole: false,
    options: [],
    note: null,
    missing: false,
  };
}

type Choice = 'recipe' | 'quick' | 'out' | 'empty';

function FixMealSheet({
  ideaOnly = false,
  draft,
  title,
  recipes,
  eaters,
  employee,
  onClose,
  onDone,
}: {
  /** Fixing an idea: only recipe or name, no who/out/employee. */
  ideaOnly?: boolean;
  draft: DraftMeal;
  title: string;
  recipes: RecipeLite[];
  eaters: Person[];
  employee: Person | null;
  onClose: () => void;
  onDone: (next: DraftMeal) => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.planImport;

  const initial: Choice =
    draft.kind === 'out' ? 'out' : draft.kind === 'empty' || !draft.main ? (draft.missing ? 'quick' : 'empty') : draft.main.recipeId ? 'recipe' : 'quick';
  const [choice, setChoice] = useState<Choice>(initial);
  const [recipeId, setRecipeId] = useState<string | null>(draft.main?.recipeId ?? null);
  // Start the search from the dish so the matched recipe (or close ones) shows straight away.
  const [query, setQuery] = useState(
    (draft.main?.recipeId ? recipes.find((r) => r.id === draft.main?.recipeId)?.title : null) ?? draft.main?.title ?? ''
  );
  const [quickTitle, setQuickTitle] = useState(draft.main && !draft.main.recipeId ? draft.main.title : '');
  const [away, setAway] = useState<string[]>(draft.awayIds);
  const [cook, setCook] = useState<'none' | 'whole' | 'part'>(
    draft.employeePart ? 'part' : draft.employeeWhole ? 'whole' : 'none'
  );
  const [part, setPart] = useState(draft.employeePart ?? '');
  const [extras, setExtras] = useState(draft.extras);

  const index = useMemo(
    () => buildSearchIndex(recipes.map((r) => ({ titles: [r.title, r.original], ingredients: [] }))),
    [recipes]
  );
  const results = useMemo(
    () => (query.trim() ? rankRecipes(scoreRecipes(index, query), 20).map((i) => recipes[i]) : []),
    [index, query, recipes]
  );
  const chosen = recipes.find((r) => r.id === recipeId) ?? null;

  const done = () => {
    const phrase = draft.main?.phrase ?? '';
    const base = { ...draft, options: [], missing: false, awayIds: away };
    if (choice === 'out') return onDone({ ...base, kind: 'out', main: null, sides: [], extras: [] });
    if (choice === 'empty') return onDone({ ...base, kind: 'empty', main: null });
    const main =
      choice === 'recipe' && chosen
        ? { phrase, title: chosen.title, recipeId: chosen.id, fromMemory: false }
        : { phrase, title: (quickTitle || query || draft.main?.title || '').trim(), recipeId: null, fromMemory: false };
    if (!main.title) return onDone({ ...base, kind: 'empty', main: null });
    onDone({
      ...base,
      kind: 'dish',
      main,
      extras,
      employeePart: cook === 'part' ? part.trim() || null : null,
      employeeWhole: cook === 'whole',
    });
  };

  const radio = (key: Choice, label: string, sub?: string) => {
    const selected = choice === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={() => setChoice(key)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 52,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 14,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? colors.text : colors.border,
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: selected ? 6 : 2,
            borderColor: selected ? colors.text : colors.textMuted,
          }}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{label}</Text>
          {sub ? <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.meta }}>{sub}</Text> : null}
        </View>
      </Pressable>
    );
  };

  const input = (value: string, onChange: (s: string) => void, placeholder: string) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      accessibilityLabel={placeholder}
      style={{
        minHeight: 44,
        borderRadius: radius.control,
        backgroundColor: colors.bgGrouped,
        paddingHorizontal: 12,
        color: colors.text,
        fontFamily: fonts.ui,
        fontSize: fontSize.small,
      }}
    />
  );

  const face = (p: Person, on: boolean, onPress: () => void) => (
    <Pressable
      key={p.id}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={p.name}
      onPress={onPress}
      style={{
        minHeight: 40,
        paddingHorizontal: 14,
        borderRadius: 999,
        justifyContent: 'center',
        backgroundColor: on ? colors.text : colors.bgGrouped,
      }}
    >
      <Text style={{ color: on ? colors.bg : colors.textMuted, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{p.name}</Text>
    </Pressable>
  );

  const label = (text: string) => (
    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>{text}</Text>
  );

  return (
    <WeekSheet visible onClose={onClose} title={title} tall footer={<Button label={t.done} onPress={done} />}>
      {draft.source ? (
        <View style={{ backgroundColor: colors.bgGrouped, borderRadius: 12, padding: 10 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.meta, fontStyle: 'italic' }}>
            {fmt(t.wrote, { text: draft.source })}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        {radio('recipe', t.recipe, chosen?.title)}
        {choice === 'recipe' ? (
          <View style={{ gap: 6 }}>
            <Field
              icon="search-outline"
              value={query}
              onChangeText={setQuery}
              placeholder={d.weekPage.searchPlaceholder}
              accessibilityLabel={t.searchRecipes}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.trim() ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setQuickTitle(query.trim());
                  setChoice('quick');
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: 48,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="create-outline" size={20} color={colors.accent} />
                <Text style={{ flex: 1, color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
                  {fmt(d.weekPage.addTyped, { title: query.trim() })}
                </Text>
              </Pressable>
            ) : null}
            {results.length > 0 ? <Eyebrow>{d.weekPage.resultsSection}</Eyebrow> : query.trim() ? <Muted>{d.weekPage.noMatches}</Muted> : null}
            {results.map((r) => {
              const picked = r.id === recipeId;
              const meta = [r.salad ? d.weekPage.salad : null, r.totalMinutes ? fmt(d.weekPage.minutes, { n: r.totalMinutes }) : null]
                .filter(Boolean)
                .join(' · ');
              return (
                <Pressable
                  key={r.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: picked }}
                  accessibilityLabel={r.title}
                  onPress={() => setRecipeId(r.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 56,
                    borderRadius: radius.card,
                    backgroundColor: pressed ? colors.cardPressed : 'transparent',
                  })}
                >
                  <RecipeImage path={r.cover_image_path} style={{ width: 48, height: 48, borderRadius: radius.thumb }} iconSize={18} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.base }}>
                      {r.title}
                    </Text>
                    {meta ? <Muted numberOfLines={1}>{meta}</Muted> : null}
                  </View>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      borderWidth: picked ? 0 : 1,
                      borderColor: colors.border,
                      backgroundColor: picked ? colors.text : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name={picked ? 'checkmark' : 'add'} size={22} color={picked ? colors.bg : colors.accent} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {radio('quick', t.quickMeal, choice === 'quick' ? undefined : quickTitle || undefined)}
        {choice === 'quick' ? input(quickTitle, setQuickTitle, t.quickName) : null}
        {ideaOnly ? null : radio('out', t.out)}
        {ideaOnly ? null : radio('empty', t.empty)}
      </View>

      {!ideaOnly && (choice === 'recipe' || choice === 'quick') ? (
        <>
          <View style={{ gap: 8 }}>
            {label(t.whoEats)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {eaters.map((p) =>
                face(p, !away.includes(p.id), () =>
                  setAway((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                )
              )}
            </View>
          </View>

          {extras.map((extra, i) => (
            <View key={`extra-${i}`} style={{ gap: 8 }}>
              {label(fmt(t.extraFor, { title: extra.dish.title }))}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {eaters.map((p) =>
                  face(p, extra.personIds.includes(p.id), () =>
                    setExtras((prev) =>
                      prev.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              personIds: x.personIds.includes(p.id)
                                ? x.personIds.filter((id) => id !== p.id)
                                : [...x.personIds, p.id],
                            }
                          : x
                      )
                    )
                  )
                )}
              </View>
            </View>
          ))}

          {employee ? (
            <View style={{ gap: 8 }}>
              {label(fmt(t.employeeDoes, { name: employee.name }))}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Pill label={t.nothing} selected={cook === 'none'} onPress={() => setCook('none')} />
                <Pill label={t.whole} selected={cook === 'whole'} onPress={() => setCook('whole')} />
                <Pill label={t.part} selected={cook === 'part'} onPress={() => setCook('part')} />
              </View>
              {cook === 'part' ? input(part, setPart, t.partPlaceholder) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </WeekSheet>
  );
}
