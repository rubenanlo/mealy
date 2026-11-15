import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestStepper } from '@/components/guest-stepper';
import { PersonChip } from '@/components/person-chip';
import { Body, Button, Eyebrow, Field, Muted, Title } from '@/components/ui';
import { WeekChips, useWeekSummaries } from '@/components/week-chips';
import { useHousehold } from '@/lib/auth';
import { confirmDestructive } from '@/lib/confirm';
import { invalidateLists } from '@/lib/list-refresh';
import { dictionaries, fmt, useI18n, type Dict } from '@/lib/i18n';
import {
  awayIds,
  dayDate,
  effectivePersonIds,
  upsertEntryPayload,
  weekStart,
  type CookType,
  type MealSlot,
  type PlanAbsence,
} from '@/lib/plan';
import { defaultTargetWeek, ideaPayload, isPastDay, weekChoices } from '@/lib/plan-ideas';
import { entryServings } from '@/lib/servings';
import { supabase } from '@/lib/supabase';
import { localizedTitle } from '@/lib/translations';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';

interface PersonLite {
  id: string;
  name: string;
  is_employee: boolean;
  avatar_color?: string | null;
}

/** Delete every current-week entry of a recipe (bookmark un-save, v3). */
export async function removeRecipeFromCurrentWeek(
  householdId: string,
  recipeId: string
): Promise<void> {
  const { data: plan } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('household_id', householdId)
    .eq('week_start', weekStart(new Date()))
    .maybeSingle();
  if (!plan) return;
  await supabase.from('plan_entries').delete().eq('meal_plan_id', plan.id).eq('recipe_id', recipeId);
  invalidateLists('plan', 'groceries');
}

/** Small cross-platform confirm for the bookmark's remove action.
 *  Not a component, so it takes the dictionary as a parameter; call sites
 *  pass `d` from their own useI18n() (English when omitted). */
export function confirmRemoveFromWeek(
  recipeTitle: string,
  onConfirm: () => void,
  d: Dict = dictionaries.en
): void {
  confirmDestructive({
    title: d.components.removeFromWeekTitle,
    message: recipeTitle,
    confirmLabel: d.components.remove,
    cancelLabel: d.common.cancel,
    onConfirm,
  });
}

type TitledRow = {
  custom_title: string | null;
  recipes: { title: string; recipe_translations: { locale: string; title: string }[] | null } | null;
};

/** An idea being planned or moved: the sheet deletes or updates it on save. */
export interface IdeaRef {
  id: string;
  week_start: string;
  note: string | null;
}

/**
 * "Add to plan" sheet: pick a week (chips), then a day + slot for a recipe or
 * free-text meal, then who eats / who cooks. "No day yet" saves it as an idea
 * for the chosen week instead (migration 0037). Opened with `idea`, it plans
 * or moves that idea. Reuses the planner's entry logic (upsertEntryPayload,
 * draft plan auto-create, eats-away marks).
 */
export function AddToWeekSheet({
  visible,
  recipeId,
  customTitle,
  recipeTitle,
  idea,
  initialWeek,
  onClose,
  onAdded,
}: {
  visible: boolean;
  /** Exactly one of recipeId / customTitle. */
  recipeId?: string | null;
  customTitle?: string | null;
  recipeTitle: string;
  idea?: IdeaRef | null;
  initialWeek?: string;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const { householdId } = useHousehold();
  const weeks = useMemo(() => weekChoices(), []);

  const [weekIso, setWeekIso] = useState(() => defaultTargetWeek());
  const [cell, setCell] = useState<{ day: number; slot: MealSlot } | null>(null);
  const [ideaMode, setIdeaMode] = useState(false);
  const [note, setNote] = useState('');
  const [persons, setPersons] = useState<PersonLite[]>([]);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [guests, setGuests] = useState(0);
  const [cook, setCook] = useState<CookType>('family');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Meal titles already in the shown week, per "day-slot". */
  const [weekMeals, setWeekMeals] = useState<Map<string, string[]>>(new Map());
  /** Titles of the ideas already parked for the shown week. */
  const [weekIdeas, setWeekIdeas] = useState<string[]>([]);

  const summaries = useWeekSummaries(householdId, weeks, visible);

  useEffect(() => {
    if (!visible) return;
    const start = idea?.week_start ?? initialWeek ?? defaultTargetWeek();
    // Weeks before the current one can't be planned from here.
    setWeekIso(start < weekStart(new Date()) ? defaultTargetWeek() : start);
    setCell(null);
    setIdeaMode(false);
    setNote(idea?.note ?? '');
    setPersonIds([]);
    setGuests(0);
    setCook('family');
    setError(null);
    let cancelled = false;
    supabase
      .from('persons')
      .select('id, name, is_employee, avatar_color')
      .eq('household_id', householdId)
      .order('created_at')
      .then(({ data }) => {
        if (!cancelled && data) setPersons(data as PersonLite[]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, householdId, idea, initialWeek]);

  // What the shown week already holds: meal names in the grid, parked ideas.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const titleOf = (row: TitledRow) =>
      row.custom_title ??
      (row.recipes ? localizedTitle(row.recipes, locale) : d.plan.recipeFallback);
    void (async () => {
      const [{ data: plan }, { data: ideaRows }] = await Promise.all([
        supabase
          .from('meal_plans')
          .select('id')
          .eq('household_id', householdId)
          .eq('week_start', weekIso)
          .maybeSingle(),
        supabase
          .from('plan_ideas')
          .select('id, custom_title, recipes(title, recipe_translations(locale, title))')
          .eq('household_id', householdId)
          .eq('week_start', weekIso)
          .order('created_at'),
      ]);
      let meals = new Map<string, string[]>();
      if (plan) {
        const { data: rows } = await supabase
          .from('plan_entries')
          .select('day, slot, position, custom_title, recipes(title, recipe_translations(locale, title))')
          .eq('meal_plan_id', plan.id)
          .order('position');
        meals = new Map();
        for (const row of (rows ?? []) as unknown as (TitledRow & { day: number; slot: MealSlot })[]) {
          const key = `${row.day}-${row.slot}`;
          meals.set(key, [...(meals.get(key) ?? []), titleOf(row)]);
        }
      }
      if (cancelled) return;
      setWeekMeals(meals);
      setWeekIdeas(
        ((ideaRows ?? []) as unknown as (TitledRow & { id: string })[])
          .filter((row) => row.id !== idea?.id)
          .map(titleOf)
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, householdId, weekIso, locale, idea, d]);

  const eaters = persons.filter((p) => !p.is_employee);

  const selectWeek = (week: string) => {
    setWeekIso(week);
    if (cell && isPastDay(week, cell.day)) setCell(null);
  };

  const ensurePlan = async (): Promise<string> => {
    const { data: plan } = await supabase
      .from('meal_plans')
      .select('id')
      .eq('household_id', householdId)
      .eq('week_start', weekIso)
      .maybeSingle();
    if (plan) return plan.id as string;
    const { data: created, error: createErr } = await supabase
      .from('meal_plans')
      .insert({ household_id: householdId, week_start: weekIso })
      .select('id')
      .single();
    if (createErr || !created) throw new Error(createErr?.message ?? d.components.createWeekError);
    return created.id as string;
  };

  const saveIdea = async () => {
    if (idea) {
      const { error: updateErr } = await supabase
        .from('plan_ideas')
        .update({ week_start: weekIso, note: note.trim() || null })
        .eq('id', idea.id);
      if (updateErr) throw new Error(updateErr.message);
      return;
    }
    const { error: insertErr } = await supabase.from('plan_ideas').insert(
      ideaPayload({ householdId, weekStart: weekIso, recipeId, customTitle, note })
    );
    if (insertErr) throw new Error(insertErr.message);
  };

  const addEntry = async (target: { day: number; slot: MealSlot }) => {
    const mealPlanId = await ensurePlan();
    const [{ count }, { data: absenceRows }] = await Promise.all([
      supabase
        .from('plan_entries')
        .select('id', { count: 'exact', head: true })
        .eq('meal_plan_id', mealPlanId)
        .eq('day', target.day)
        .eq('slot', target.slot),
      supabase
        .from('plan_absences')
        .select('day, slot, person_id')
        .eq('meal_plan_id', mealPlanId)
        .eq('day', target.day)
        .eq('slot', target.slot),
    ]);
    const payload = upsertEntryPayload({
      mealPlanId,
      day: target.day,
      slot: target.slot,
      ...(recipeId ? { recipeId } : { customTitle: customTitle ?? recipeTitle }),
      // "Whole household" minus whoever eats away for that meal.
      personIds: effectivePersonIds(
        personIds,
        eaters.map((p) => p.id),
        awayIds((absenceRows as PlanAbsence[]) ?? [], target.day, target.slot)
      ),
      guestCount: guests,
      assignedCook: cook,
      position: count ?? 0,
    });
    const { error: insertErr } = await supabase.from('plan_entries').insert(payload);
    if (insertErr) throw new Error(insertErr.message);
    // A planned idea leaves the ideas list.
    if (idea) await supabase.from('plan_ideas').delete().eq('id', idea.id);
  };

  const confirm = async () => {
    if (!cell && !ideaMode) return;
    setBusy(true);
    setError(null);
    try {
      if (ideaMode) await saveIdea();
      else if (cell) await addEntry(cell);
      invalidateLists('plan', 'groceries');
      onAdded?.();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : ideaMode
            ? d.components.saveIdeaError
            : d.components.addRecipeError
      );
    } finally {
      setBusy(false);
    }
  };

  const slotLabels: Record<MealSlot, string> = { lunch: d.common.lunch, dinner: d.common.dinner };
  const weekDateLong = dayDate(weekIso, 0).toLocaleDateString(locale, { month: 'long', day: 'numeric' });
  const weekLabel = fmt(d.components.weekOf, { date: weekDateLong });
  const ctaLabel = ideaMode
    ? fmt(d.components.saveIdeaCta, { date: weekDateLong })
    : cell
      ? fmt(d.components.addToDayCta, {
          date: dayDate(weekIso, cell.day).toLocaleDateString(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
          slot: slotLabels[cell.slot],
        })
      : d.components.addToWeekCta;

  const choiceStyle = (selected: boolean, disabled = false) =>
    ({ pressed }: { pressed: boolean }) => ({
      flex: 1,
      minHeight: 48,
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderRadius: radius.control,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      opacity: disabled ? 0.35 : 1,
      backgroundColor: selected ? colors.text : pressed ? colors.cardPressed : 'transparent',
      borderWidth: selected ? 0 : 1,
      borderColor: colors.border,
    });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ padding: screenPadding, gap: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 4 }}>
            <Eyebrow>{weekLabel}</Eyebrow>
            <Title>{d.components.addToPlan}</Title>
            <Muted>{recipeTitle}</Muted>
          </View>

          <WeekChips weeks={weeks} selected={weekIso} onSelect={selectWeek} summaries={summaries} />

          {/* "No day yet": park it as an idea for the chosen week. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: ideaMode }}
            onPress={() => {
              setIdeaMode((on) => !on);
              setCell(null);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 52,
              paddingHorizontal: 14,
              borderRadius: radius.control,
              borderWidth: ideaMode ? 0 : 1,
              borderStyle: ideaMode ? 'solid' : 'dashed',
              borderColor: colors.border,
              backgroundColor: ideaMode ? colors.text : pressed ? colors.cardPressed : 'transparent',
            })}
          >
            <Ionicons name="bulb-outline" size={20} color={ideaMode ? colors.bg : colors.text} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: ideaMode ? colors.bg : colors.text, fontSize: fontSize.small, fontFamily: fonts.uiSemi }}>
                {d.components.noDayYet}
              </Text>
              <Text style={{ color: ideaMode ? colors.bg : colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.ui }}>
                {d.components.noDayYetHint}
              </Text>
            </View>
            {ideaMode ? <Ionicons name="checkmark" size={20} color={colors.bg} /> : null}
          </Pressable>

          {ideaMode ? (
            <>
              <View style={{ gap: 8 }}>
                <Eyebrow>{d.components.ideaNote}</Eyebrow>
                <Field
                  value={note}
                  onChangeText={setNote}
                  placeholder={d.components.ideaNotePlaceholder}
                  accessibilityLabel={d.components.ideaNote}
                />
              </View>
              {weekIdeas.length > 0 ? (
                <View style={{ gap: 6 }}>
                  <Eyebrow>{d.components.alreadyParked}</Eyebrow>
                  {weekIdeas.map((title, i) => (
                    <Body key={`${title}-${i}`}>{title}</Body>
                  ))}
                </View>
              ) : null}
              <Muted>{d.components.askedLater}</Muted>
            </>
          ) : (
            <>
              <View style={{ gap: 10 }}>
                {d.common.days.map((dayLabel, day) => {
                  const past = isPastDay(weekIso, day);
                  return (
                    <View key={day} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text
                        style={{
                          width: 96,
                          color: past ? colors.textMuted : colors.text,
                          fontSize: fontSize.small,
                          fontFamily: fonts.displaySemi,
                        }}
                      >
                        {dayLabel}
                      </Text>
                      {(['lunch', 'dinner'] as const).map((slot) => {
                        const selected = cell?.day === day && cell?.slot === slot;
                        const meals = weekMeals.get(`${day}-${slot}`) ?? [];
                        return (
                          <Pressable
                            key={slot}
                            accessibilityRole="button"
                            accessibilityLabel={[`${dayLabel} ${slotLabels[slot]}`, ...meals].join(', ')}
                            accessibilityState={{ selected, disabled: past }}
                            disabled={past}
                            onPress={() => setCell({ day, slot })}
                            style={choiceStyle(selected, past)}
                          >
                            <Text
                              style={{
                                color: selected ? colors.bg : colors.text,
                                fontSize: fontSize.meta,
                                fontFamily: fonts.uiMedium,
                              }}
                            >
                              {slotLabels[slot]}
                            </Text>
                            {meals.length > 0 ? (
                              <Text
                                numberOfLines={1}
                                style={{
                                  color: selected ? colors.bg : colors.textMuted,
                                  fontSize: 11,
                                  fontFamily: fonts.ui,
                                }}
                              >
                                {meals.join(', ')}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </View>

              {eaters.length > 0 ? (
                <View style={{ gap: 10 }}>
                  <Eyebrow>{d.components.whoEats}</Eyebrow>
                  <Muted>{d.components.wholeHousehold}</Muted>
                  <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                    {eaters.map((person) => (
                      <PersonChip
                        key={person.id}
                        person={person}
                        selected={personIds.length === 0 ? undefined : personIds.includes(person.id)}
                        onPress={() =>
                          setPersonIds((prev) =>
                            prev.includes(person.id)
                              ? prev.filter((p) => p !== person.id)
                              : [...prev, person.id]
                          )
                        }
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={{ gap: 10 }}>
                <Eyebrow>{d.components.guests}</Eyebrow>
                <Muted>{d.components.guestsHint}</Muted>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <GuestStepper value={guests} onChange={setGuests} />
                  <Muted>
                    {fmt(d.components.serves, { count: entryServings(personIds, guests, eaters.length) })}
                  </Muted>
                </View>
              </View>

              <View style={{ gap: 10 }}>
                <Eyebrow>{d.components.whoCooks}</Eyebrow>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {(
                    [
                      ['family', d.components.cookFamily],
                      ['employee', d.components.cookEmployee],
                    ] as const
                  ).map(([value, label]) => {
                    const selected = cook === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setCook(value)}
                        style={choiceStyle(selected)}
                      >
                        <Text
                          style={{
                            color: selected ? colors.bg : colors.text,
                            fontSize: fontSize.meta,
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
            </>
          )}

          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          <Button label={ctaLabel} onPress={() => void confirm()} loading={busy} disabled={!cell && !ideaMode} />
          <Button label={d.common.cancel} kind="secondary" onPress={onClose} disabled={busy} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
