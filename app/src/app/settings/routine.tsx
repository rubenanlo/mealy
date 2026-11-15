import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Eyebrow, Field, Muted, Title } from '@/components/ui';
import { WeekSheet } from '@/components/week/sheet';
import { isSalad } from '@/lib/ai-week';
import { useHousehold } from '@/lib/auth';
import { notify } from '@/lib/confirm';
import { fmt, useI18n } from '@/lib/i18n';
import { backOr } from '@/lib/nav';
import {
  ALL_DAYS,
  SALAD_MATCH,
  durationLabel,
  favouriteCount,
  newRoutineId,
  parseRoutine,
  type PlanRoutine,
  type RoutineFavourite,
  type RoutineRecipe,
  type RoutineRule,
} from '@/lib/plan-routine';
import { buildSearchIndex, scoreRecipes } from '@/lib/search-text';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';
import { localizedTitle } from '@/lib/translations';
import { aiRoutineRule } from '@/lib/worker';

interface PersonRow {
  id: string;
  name: string;
  is_employee: boolean;
}

interface RecipeRow extends RoutineRecipe {
  searchTitles: string[];
}

/**
 * Our weekly routine (migration 0039): what the ✦ AI planner follows every
 * week, plus the household's own rules as cards. Every change saves at once.
 */
export default function RoutineScreen() {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const t = d.routine;
  const { householdId } = useHousehold();

  const [routine, setRoutine] = useState<PlanRoutine | null>(null);
  const [persons, setPersons] = useState<PersonRow[]>([]);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [favSheet, setFavSheet] = useState(false);
  const [ruleText, setRuleText] = useState('');
  const [adding, setAdding] = useState(false);
  const saveSeq = useRef(0);

  const eaters = useMemo(() => persons.filter((p) => !p.is_employee), [persons]);

  const load = useCallback(async () => {
    const [{ data: hh }, { data: personRows }, { data: recipeRows }] = await Promise.all([
      supabase.from('households').select('plan_routine, other_requirements').eq('id', householdId).single(),
      supabase.from('persons').select('id, name, is_employee').eq('household_id', householdId).order('created_at'),
      supabase
        .from('recipes')
        .select('id, title, tags, dish_type, meal_type, recipe_translations(locale, title)')
        .eq('household_id', householdId)
        .order('title'),
    ]);
    setPersons((personRows as PersonRow[]) ?? []);
    setRecipes(
      (
        (recipeRows ?? []) as {
          id: string;
          title: string;
          tags: string[] | null;
          dish_type: string | null;
          meal_type: string | null;
          recipe_translations: { locale: string; title: string }[] | null;
        }[]
      )
        .filter((r) => r.meal_type !== 'side' && r.meal_type !== 'dessert' && r.meal_type !== 'breakfast')
        .map((r) => ({
          id: r.id,
          title: localizedTitle(r, locale),
          isSalad: isSalad({ title: r.title, tags: r.tags, dish_type: r.dish_type }),
          searchTitles: [r.title, ...(r.recipe_translations ?? []).map((x) => x.title)],
        }))
    );
    const parsed = parseRoutine(hh?.plan_routine);
    // The old free-text household notes become the first rule card, once.
    const notes = ((hh?.other_requirements as string | null) ?? '').trim();
    if (!parsed.notesImported) {
      const next: PlanRoutine = {
        ...parsed,
        notesImported: true,
        rules: notes
          ? [
              {
                id: newRoutineId('rule'),
                text: notes,
                title: notes.length > 60 ? `${notes.slice(0, 57)}…` : notes,
                summary: '',
                on: true,
                days: [],
                slots: [],
                avoidCategories: [],
                avoidWords: [],
                personIds: [],
              },
              ...parsed.rules,
            ]
          : parsed.rules,
      };
      setRoutine(next);
      await supabase.from('households').update({ plan_routine: next }).eq('id', householdId);
    } else {
      setRoutine(parsed);
    }
  }, [householdId, locale]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const update = (change: (r: PlanRoutine) => PlanRoutine) => {
    if (!routine) return;
    const next = change(routine);
    setRoutine(next);
    const seq = ++saveSeq.current;
    void supabase
      .from('households')
      .update({ plan_routine: next })
      .eq('id', householdId)
      .then(({ error }) => {
        if (error && seq === saveSeq.current) notify(t.title, t.saveFailed);
      });
  };

  const addRule = async () => {
    const text = ruleText.trim();
    if (!text || adding) return;
    setAdding(true);
    const card = await aiRoutineRule({
      text,
      language: locale,
      people: eaters.map((p) => ({ id: p.id, name: p.name })),
    });
    const rule: RoutineRule = {
      id: newRoutineId('rule'),
      text,
      title: card?.title || text,
      summary: card?.summary ?? '',
      on: true,
      days: card?.days ?? [],
      slots: card?.slots ?? [],
      avoidCategories: card?.avoid_categories ?? [],
      avoidWords: card?.avoid_words ?? [],
      personIds: card?.person_ids ?? [],
    };
    update((r) => ({ ...r, rules: [...r.rules, rule] }));
    setRuleText('');
    setAdding(false);
  };

  const shortDay = (day: number) => (d.common.days[day] ?? '').slice(0, 3);
  const dur = (n: number) => durationLabel(n, t);

  if (!routine) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.textMuted} />
      </SafeAreaView>
    );
  }

  const leftoverPerson = eaters.find((p) => p.id === routine.leftovers.personId) ?? null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.back}
          onPress={() => backOr('/settings/meal-preferences')}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: minTapTarget, alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Body style={{ fontFamily: fonts.uiSemi }}>{t.back}</Body>
        </Pressable>
        <View style={{ gap: 2 }}>
          <Title>{t.title}</Title>
          <Muted>{t.subtitle}</Muted>
        </View>

        <Card>
          <ToggleRow
            title={t.quickTitle}
            sub={t.quickSub}
            value={routine.quick.on}
            onChange={(on) => update((r) => ({ ...r, quick: { ...r.quick, on } }))}
          />
          {routine.quick.on ? (
            <>
              <StepRow
                label={t.atMost}
                value={dur(routine.quick.maxMinutes)}
                onLess={() => update((r) => ({ ...r, quick: { ...r.quick, maxMinutes: Math.max(10, r.quick.maxMinutes - 5) } }))}
                onMore={() => update((r) => ({ ...r, quick: { ...r.quick, maxMinutes: Math.min(120, r.quick.maxMinutes + 5) } }))}
              />
              <Muted>{t.quickNote}</Muted>
            </>
          ) : null}
        </Card>

        <Card>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>{t.favTitle}</Text>
          {routine.favourites.length === 0 ? <Muted>{t.favNone}</Muted> : null}
          {routine.favourites.map((fav) => {
            const n = favouriteCount(fav, recipes);
            return (
              <View key={fav.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{fav.label}</Text>
                  {!fav.recipeId ? <Muted>{n === 1 ? t.favCountOne : fmt(t.favCount, { n })}</Muted> : null}
                </View>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: fav.dayBefore }}
                  accessibilityLabel={fmt(t.dayBeforeA11y, { name: fav.label })}
                  onPress={() =>
                    update((r) => ({
                      ...r,
                      favourites: r.favourites.map((f) => (f.id === fav.id ? { ...f, dayBefore: !f.dayBefore } : f)),
                    }))
                  }
                  style={{
                    minHeight: 36,
                    paddingHorizontal: 10,
                    borderRadius: 18,
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: fav.dayBefore ? colors.saffron : colors.border,
                    backgroundColor: fav.dayBefore ? colors.saffron : 'transparent',
                  }}
                >
                  <Text style={{ color: fav.dayBefore ? colors.bg : colors.textMuted, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>
                    {t.dayBefore}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fmt(t.removeA11y, { name: fav.label })}
                  onPress={() => update((r) => ({ ...r, favourites: r.favourites.filter((f) => f.id !== fav.id) }))}
                  style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            );
          })}
          <Pressable
            accessibilityRole="button"
            onPress={() => setFavSheet(true)}
            style={{ alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, justifyContent: 'center' }}
          >
            <Text style={{ color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{t.favAdd}</Text>
          </Pressable>
          {routine.favourites.length > 0 ? (
            <>
              <StepRow
                label={t.favMin}
                value={String(routine.favouritesMin)}
                onLess={() => update((r) => ({ ...r, favouritesMin: Math.max(0, r.favouritesMin - 1) }))}
                onMore={() => update((r) => ({ ...r, favouritesMin: Math.min(10, r.favouritesMin + 1) }))}
              />
              <Muted>{t.favMinHint}</Muted>
            </>
          ) : null}
        </Card>

        <Card>
          <ToggleRow
            title={t.leftTitle}
            sub={leftoverPerson ? fmt(t.leftSub, { name: leftoverPerson.name }) : t.leftSubNoPerson}
            value={routine.leftovers.on}
            onChange={(on) =>
              update((r) => ({
                ...r,
                leftovers: {
                  ...r.leftovers,
                  on,
                  // Default to the first eater named Marc, else the youngest-listed eater.
                  personId: r.leftovers.personId ?? (eaters.find((p) => /^marc\b/i.test(p.name.trim())) ?? eaters[eaters.length - 1])?.id ?? null,
                },
              }))
            }
          />
          {routine.leftovers.on ? (
            <>
              <Eyebrow>{t.leftWho}</Eyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {eaters.map((p) => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    selected={routine.leftovers.personId === p.id}
                    onPress={() => update((r) => ({ ...r, leftovers: { ...r.leftovers, personId: p.id } }))}
                  />
                ))}
              </View>
              <Eyebrow>{t.leftNights}</Eyebrow>
              <DayChips
                days={routine.leftovers.days}
                label={shortDay}
                onToggle={(day) =>
                  update((r) => ({
                    ...r,
                    leftovers: {
                      ...r.leftovers,
                      days: r.leftovers.days.includes(day)
                        ? r.leftovers.days.filter((x) => x !== day)
                        : [...r.leftovers.days, day].sort(),
                    },
                  }))
                }
              />
              <Muted>{t.leftNote}</Muted>
            </>
          ) : null}
        </Card>

        <Card>
          <ToggleRow
            title={t.weekendTitle}
            sub={t.weekendSub}
            value={routine.weekendLunch.on}
            onChange={(on) => update((r) => ({ ...r, weekendLunch: { ...r.weekendLunch, on } }))}
          />
          {routine.weekendLunch.on ? (
            <StepRow
              label={t.upTo}
              value={dur(routine.weekendLunch.maxMinutes)}
              onLess={() => update((r) => ({ ...r, weekendLunch: { ...r.weekendLunch, maxMinutes: Math.max(45, r.weekendLunch.maxMinutes - 15) } }))}
              onMore={() => update((r) => ({ ...r, weekendLunch: { ...r.weekendLunch, maxMinutes: Math.min(360, r.weekendLunch.maxMinutes + 15) } }))}
            />
          ) : null}
        </Card>

        <Eyebrow style={{ marginTop: 8 }}>{t.rulesTitle}</Eyebrow>
        {routine.rules.length === 0 ? <Muted>{t.rulesNone}</Muted> : null}
        {routine.rules.map((rule) => (
          <Card key={rule.id}>
            <ToggleRow
              title={rule.title}
              sub={rule.summary || t.ruleFallbackSummary}
              value={rule.on}
              a11y={fmt(t.ruleOnA11y, { title: rule.title })}
              onChange={(on) => update((r) => ({ ...r, rules: r.rules.map((x) => (x.id === rule.id ? { ...x, on } : x)) }))}
            />
            {rule.days.length > 0 || rule.avoidCategories.length > 0 || rule.avoidWords.length > 0 ? (
              <DayChips
                days={rule.days.length > 0 ? rule.days : [...ALL_DAYS]}
                label={shortDay}
                onToggle={(day) =>
                  update((r) => ({
                    ...r,
                    rules: r.rules.map((x) => {
                      if (x.id !== rule.id) return x;
                      const current = x.days.length > 0 ? x.days : [...ALL_DAYS];
                      const days = current.includes(day) ? current.filter((v) => v !== day) : [...current, day].sort();
                      return { ...x, days: days.length === 7 ? [] : days };
                    }),
                  }))
                }
              />
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {rule.personIds.map((id) => {
                const person = eaters.find((p) => p.id === id);
                return person ? <Chip key={id} label={person.name} selected /> : null;
              })}
              {rule.days.length === 0 && rule.personIds.length === 0 ? <Muted style={{ flex: 1 }}>{t.everyDay}</Muted> : <View style={{ flex: 1 }} />}
              <Pressable
                accessibilityRole="button"
                onPress={() => update((r) => ({ ...r, rules: r.rules.filter((x) => x.id !== rule.id) }))}
                style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 }}
              >
                <Text style={{ color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{t.ruleDelete}</Text>
              </Pressable>
            </View>
          </Card>
        ))}
        <Card dashed>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>{t.addRuleTitle}</Text>
          <TextInput
            accessibilityLabel={t.addRuleTitle}
            value={ruleText}
            onChangeText={setRuleText}
            placeholder={t.addRulePlaceholder}
            placeholderTextColor={colors.textMuted}
            multiline
            editable={!adding}
            style={{ minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small, textAlignVertical: 'top' }}
          />
          <Muted>{t.addRuleHint}</Muted>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !ruleText.trim() || adding, busy: adding }}
            disabled={!ruleText.trim() || adding}
            onPress={() => void addRule()}
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: ruleText.trim() ? colors.text : colors.border }}
          >
            {adding ? <ActivityIndicator color={colors.bg} size="small" /> : null}
            <Text style={{ color: ruleText.trim() ? colors.bg : colors.textMuted, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{t.addRule}</Text>
          </Pressable>
        </Card>
      </ScrollView>

      <FavouriteSheet
        visible={favSheet}
        recipes={recipes}
        existing={routine.favourites}
        onClose={() => setFavSheet(false)}
        onAdd={(fav) => {
          update((r) => ({ ...r, favourites: [...r.favourites, fav] }));
          setFavSheet(false);
        }}
      />
    </SafeAreaView>
  );
}

function Card({ children, dashed = false }: { children: ReactNode; dashed?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 14,
        padding: 14,
        gap: 10,
        borderWidth: dashed ? 1 : 0,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: dashed ? colors.accent : 'transparent',
      }}
    >
      {children}
    </View>
  );
}

function ToggleRow({
  title,
  sub,
  value,
  onChange,
  a11y,
}: {
  title: string;
  sub?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  a11y?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>{title}</Text>
        {sub ? <Muted>{sub}</Muted> : null}
      </View>
      <Switch
        accessibilityLabel={a11y ?? title}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
      />
    </View>
  );
}

function StepRow({ label, value, onLess, onMore }: { label: string; value: string; onLess: () => void; onMore: () => void }) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const button = (icon: 'remove' | 'add', onPress: () => void, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Body style={{ flex: 1, color: colors.textMuted }}>{label}</Body>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 22 }}>
        {button('remove', onLess, fmt(d.routine.lessA11y, { label }))}
        <Text style={{ minWidth: 64, textAlign: 'center', color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{value}</Text>
        {button('add', onMore, fmt(d.routine.moreA11y, { label }))}
      </View>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  const style = {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: selected ? colors.text : colors.border,
    backgroundColor: selected ? colors.text : 'transparent',
  };
  const text = (
    <Text style={{ color: selected ? colors.bg : colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{label}</Text>
  );
  if (!onPress) return <View style={style}>{text}</View>;
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={style}>
      {text}
    </Pressable>
  );
}

function DayChips({ days, label, onToggle }: { days: readonly number[]; label: (day: number) => string; onToggle: (day: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {ALL_DAYS.map((day) => {
        const on = days.includes(day);
        return (
          <Pressable
            key={day}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => onToggle(day)}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: on ? colors.text : colors.border, backgroundColor: on ? colors.text : 'transparent' }}
          >
            <Text style={{ color: on ? colors.bg : colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>{label(day)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FavouriteSheet({
  visible,
  recipes,
  existing,
  onAdd,
  onClose,
}: {
  visible: boolean;
  recipes: RecipeRow[];
  existing: RoutineFavourite[];
  onAdd: (fav: RoutineFavourite) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.routine;
  const [query, setQuery] = useState('');
  const [dayBefore, setDayBefore] = useState(false);
  const index = useMemo(() => buildSearchIndex(recipes.map((r) => ({ titles: r.searchTitles, ingredients: [] }))), [recipes]);
  const scores = useMemo(() => scoreRecipes(index, query), [index, query]);
  const results = useMemo(() => {
    if (!scores) return [];
    return recipes
      .map((r, i) => ({ r, s: scores[i] ?? 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 20)
      .map((x) => x.r);
  }, [recipes, scores]);
  const typed = query.trim();
  const hasSalads = existing.some((f) => f.match === SALAD_MATCH);
  const add = (fav: Omit<RoutineFavourite, 'id' | 'dayBefore'>) => {
    onAdd({ ...fav, id: newRoutineId('fav'), dayBefore });
    setQuery('');
    setDayBefore(false);
  };
  const saladCount = favouriteCount({ id: '', label: '', recipeId: null, match: SALAD_MATCH, dayBefore: false }, recipes);
  const wordCount = typed
    ? favouriteCount({ id: '', label: '', recipeId: null, match: typed, dayBefore: false }, recipes)
    : 0;

  const row = (title: string, sub: string, onPress: () => void, key: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderRadius: radius.card, backgroundColor: pressed ? colors.cardPressed : 'transparent' })}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.base }}>{title}</Text>
        {sub ? <Muted>{sub}</Muted> : null}
      </View>
      <Ionicons name="add" size={22} color={colors.accent} />
    </Pressable>
  );

  return (
    <WeekSheet
      visible={visible}
      onClose={onClose}
      title={t.favSheetTitle}
      tall
      footer={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{t.favDayBeforeTitle}</Text>
            <Muted>{t.favDayBeforeHint}</Muted>
          </View>
          <Switch accessibilityLabel={t.favDayBeforeTitle} value={dayBefore} onValueChange={setDayBefore} trackColor={{ true: colors.accent, false: colors.border }} />
        </View>
      }
    >
      <Field icon="search-outline" value={query} onChangeText={setQuery} placeholder={t.favSearch} autoCapitalize="none" />
      <Eyebrow>{t.kindSection}</Eyebrow>
      {!hasSalads && !typed
        ? row(t.saladsKind, `${t.saladsHint} · ${saladCount === 1 ? t.favCountOne : fmt(t.favCount, { n: saladCount })}`, () => add({ label: t.saladsKind, recipeId: null, match: SALAD_MATCH }), 'salads')
        : null}
      {typed
        ? row(fmt(t.wordKind, { word: typed }), wordCount === 1 ? t.favCountOne : fmt(t.favCount, { n: wordCount }), () =>
            add({ label: typed.charAt(0).toUpperCase() + typed.slice(1), recipeId: null, match: typed }),
          'word')
        : null}
      {results.length > 0 ? <Eyebrow>{t.recipeSection}</Eyebrow> : null}
      {results.map((r) => row(r.title, '', () => add({ label: r.title, recipeId: r.id, match: null }), r.id))}
    </WeekSheet>
  );
}
