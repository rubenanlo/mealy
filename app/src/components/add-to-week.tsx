import { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestStepper } from '@/components/guest-stepper';
import { PersonChip } from '@/components/person-chip';
import { Body, Button, Eyebrow, Muted, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import {
  DAY_LABELS,
  SLOT_LABELS,
  dayDate,
  upsertEntryPayload,
  weekStart,
  type CookType,
  type MealSlot,
} from '@/lib/plan';
import { entryServings } from '@/lib/servings';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';

interface PersonLite {
  id: string;
  name: string;
  is_employee: boolean;
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
}

/** Small cross-platform confirm for the bookmark's remove action. */
export function confirmRemoveFromWeek(recipeTitle: string, onConfirm: () => void): void {
  if (Platform.OS === 'web') {
    // Alert with buttons is a no-op on react-native-web.
    if (typeof window !== 'undefined' && window.confirm(`Remove “${recipeTitle}” from this week?`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert('Remove from this week?', recipeTitle, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: onConfirm },
  ]);
}

/**
 * "Add to this week" sheet: pick a day + slot for a known recipe, then who
 * eats / who cooks. Reuses the planner's entry logic (upsertEntryPayload,
 * draft plan auto-create) in the reverse direction.
 */
export function AddToWeekSheet({
  visible,
  recipeId,
  recipeTitle,
  onClose,
  onAdded,
}: {
  visible: boolean;
  recipeId: string;
  recipeTitle: string;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const { colors } = useTheme();
  const { householdId } = useHousehold();
  const weekIso = weekStart(new Date());

  const [cell, setCell] = useState<{ day: number; slot: MealSlot } | null>(null);
  const [persons, setPersons] = useState<PersonLite[]>([]);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [guests, setGuests] = useState(0);
  const [cook, setCook] = useState<CookType>('family');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setCell(null);
    setPersonIds([]);
    setGuests(0);
    setCook('family');
    setError(null);
    let cancelled = false;
    supabase
      .from('persons')
      .select('id, name, is_employee')
      .eq('household_id', householdId)
      .order('created_at')
      .then(({ data }) => {
        if (!cancelled && data) setPersons(data as PersonLite[]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, householdId]);

  const eaters = persons.filter((p) => !p.is_employee);

  const confirm = async () => {
    if (!cell) return;
    setBusy(true);
    setError(null);
    try {
      let { data: plan } = await supabase
        .from('meal_plans')
        .select('id')
        .eq('household_id', householdId)
        .eq('week_start', weekIso)
        .maybeSingle();
      if (!plan) {
        const { data: created, error: createErr } = await supabase
          .from('meal_plans')
          .insert({ household_id: householdId, week_start: weekIso })
          .select('id')
          .single();
        if (createErr || !created) throw new Error(createErr?.message ?? 'Could not create the week');
        plan = created;
      }
      const { count } = await supabase
        .from('plan_entries')
        .select('id', { count: 'exact', head: true })
        .eq('meal_plan_id', plan.id)
        .eq('day', cell.day)
        .eq('slot', cell.slot);
      const payload = upsertEntryPayload({
        mealPlanId: plan.id as string,
        day: cell.day,
        slot: cell.slot,
        recipeId,
        personIds,
        guestCount: guests,
        assignedCook: cook,
        position: count ?? 0,
      });
      const { error: insertErr } = await supabase.from('plan_entries').insert(payload);
      if (insertErr) throw new Error(insertErr.message);
      onAdded?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the recipe. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const weekLabel = `Week of ${dayDate(weekIso, 0).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })}`;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ padding: screenPadding, gap: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 4 }}>
            <Eyebrow>{weekLabel}</Eyebrow>
            <Title>Add to this week</Title>
            <Muted>{recipeTitle}</Muted>
          </View>

          <View style={{ gap: 10 }}>
            {DAY_LABELS.map((dayLabel, day) => (
              <View key={day} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text
                  style={{
                    width: 96,
                    color: colors.text,
                    fontSize: fontSize.small,
                    fontFamily: fonts.displaySemi,
                  }}
                >
                  {dayLabel}
                </Text>
                {(['lunch', 'dinner'] as const).map((slot) => {
                  const selected = cell?.day === day && cell?.slot === slot;
                  return (
                    <Pressable
                      key={slot}
                      accessibilityRole="button"
                      accessibilityLabel={`${dayLabel} ${SLOT_LABELS[slot]}`}
                      accessibilityState={{ selected }}
                      onPress={() => setCell({ day, slot })}
                      style={({ pressed }) => ({
                        flex: 1,
                        minHeight: 44,
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
                          fontSize: fontSize.meta,
                          fontFamily: fonts.uiMedium,
                        }}
                      >
                        {SLOT_LABELS[slot]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          {eaters.length > 0 ? (
            <View style={{ gap: 10 }}>
              <Eyebrow>Who eats</Eyebrow>
              <Muted>No selection means the whole household.</Muted>
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
            <Eyebrow>Guests</Eyebrow>
            <Muted>Extra people (not in the household) eating this meal.</Muted>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <GuestStepper value={guests} onChange={setGuests} />
              <Muted>{`Serves ${entryServings(personIds, guests, eaters.length)}`}</Muted>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Eyebrow>Who cooks</Eyebrow>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(
                [
                  ['family', 'Family'],
                  ['employee', '👩‍🍳 Employee'],
                ] as const
              ).map(([value, label]) => {
                const selected = cook === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setCook(value)}
                    style={({ pressed }) => ({
                      flex: 1,
                      minHeight: 44,
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

          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          <Button label="Add to the week" onPress={() => void confirm()} loading={busy} disabled={!cell} />
          <Button label="Cancel" kind="secondary" onPress={onClose} disabled={busy} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
