import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Field, Muted, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import {
  DAY_LABELS_FR,
  SLOT_LABELS_FR,
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
import { supabase } from '@/lib/supabase';
import { fontSize, minTapTarget, useTheme } from '@/lib/theme';

interface Person {
  id: string;
  name: string;
  is_employee: boolean;
}

interface RecipeLite {
  id: string;
  title: string;
}

interface MealPlanRow {
  id: string;
  week_start: string;
  status: 'draft' | 'approved';
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function PersonChip({
  person,
  hollow,
  selected,
  onPress,
}: {
  person: Person;
  hollow?: boolean;
  selected?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const chip = (
    <View
      style={{
        minWidth: 34,
        height: 34,
        borderRadius: 17,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hollow ? 'transparent' : selected === false ? colors.card : colors.accent,
        borderWidth: hollow ? 2 : 0,
        borderColor: colors.textMuted,
      }}
    >
      <Text
        style={{
          color: hollow ? colors.textMuted : selected === false ? colors.text : '#FFFFFF',
          fontSize: 14,
          fontWeight: '700',
        }}
      >
        {initials(person.name)}
      </Text>
    </View>
  );
  if (!onPress) return chip;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ minHeight: minTapTarget, justifyContent: 'center' }}
    >
      {chip}
    </Pressable>
  );
}

export default function PlanScreen() {
  const { colors } = useTheme();
  const { householdId } = useHousehold();

  const [weekIso, setWeekIso] = useState(() => weekStart(new Date()));
  const [plan, setPlan] = useState<MealPlanRow | null>(null);
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [recipes, setRecipes] = useState<RecipeLite[]>([]);
  const [busy, setBusy] = useState(false);

  // Picker modal state
  const [pickerCell, setPickerCell] = useState<{ day: number; slot: MealSlot } | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickedRecipe, setPickedRecipe] = useState<RecipeLite | null>(null);
  const [pickedPersonIds, setPickedPersonIds] = useState<string[]>([]);
  const [pickedCook, setPickedCook] = useState<CookType>('family');

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
    },
    [householdId]
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [{ data: personRows }, { data: recipeRows }] = await Promise.all([
          supabase.from('persons').select('id, name, is_employee').eq('household_id', householdId).order('created_at'),
          supabase.from('recipes').select('id, title').eq('household_id', householdId).order('title'),
        ]);
        if (cancelled) return;
        setPersons((personRows as Person[]) ?? []);
        setRecipes((recipeRows as RecipeLite[]) ?? []);
        await loadWeek(weekIso);
      })();
      return () => {
        cancelled = true;
      };
    }, [householdId, weekIso, loadWeek])
  );

  const recipeTitle = useMemo(() => {
    const map = new Map(recipes.map((r) => [r.id, r.title]));
    return (id: string) => map.get(id) ?? 'Recette';
  }, [recipes]);

  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);

  const ensurePlan = async (): Promise<string> => {
    if (plan) return plan.id;
    const { data, error } = await supabase
      .from('meal_plans')
      .insert({ household_id: householdId, week_start: weekIso })
      .select('id, week_start, status')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Échec de création de la semaine');
    setPlan(data as MealPlanRow);
    return data.id as string;
  };

  const openPicker = (day: number, slot: MealSlot) => {
    setPickerCell({ day, slot });
    setPickerSearch('');
    setPickedRecipe(null);
    setPickedPersonIds([]);
    setPickedCook('family');
  };

  const confirmAdd = async () => {
    if (!pickerCell || !pickedRecipe) return;
    setBusy(true);
    try {
      const mealPlanId = await ensurePlan();
      const position = slotEntries(entries, pickerCell.day, pickerCell.slot).length;
      const payload = upsertEntryPayload({
        mealPlanId,
        day: pickerCell.day,
        slot: pickerCell.slot,
        recipeId: pickedRecipe.id,
        personIds: pickedPersonIds,
        assignedCook: pickedCook,
        position,
      });
      await supabase.from('plan_entries').insert(payload);
      setPickerCell(null);
      await loadWeek(weekIso);
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = async (entryId: string) => {
    await supabase.from('plan_entries').delete().eq('id', entryId);
    await loadWeek(weekIso);
  };

  const approveWeek = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await supabase.from('meal_plans').update({ status: 'approved' }).eq('id', plan.id);
      const events = plannedEvents(
        entries,
        householdId,
        persons.filter((p) => !p.is_employee).map((p) => p.id),
        weekIso
      );
      if (events.length > 0) await supabase.from('events').insert(events);
      await loadWeek(weekIso);
    } finally {
      setBusy(false);
    }
  };

  const weekLabel = `Semaine du ${dayDate(weekIso, 0).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
  })}`;

  const eaters = persons.filter((p) => !p.is_employee);
  const filteredRecipes = recipes.filter((r) =>
    r.title.toLowerCase().includes(pickerSearch.trim().toLowerCase())
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Semaine précédente"
          onPress={() => setWeekIso(addWeeks(weekIso, -1))}
          style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: colors.accent, fontSize: 30 }}>◀</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Body style={{ fontWeight: '700' }}>{weekLabel}</Body>
          {plan?.status === 'approved' ? (
            <Muted style={{ color: colors.accent }}>Semaine validée ✓</Muted>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Semaine suivante"
          onPress={() => setWeekIso(addWeeks(weekIso, 1))}
          style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: colors.accent, fontSize: 30 }}>▶</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 14 }}>
        {DAY_LABELS_FR.map((dayLabel, day) => (
          <View key={day} style={{ gap: 8 }}>
            <Body style={{ fontWeight: '700', fontSize: fontSize.medium }}>
              {dayLabel}{' '}
              <Muted>
                {dayDate(weekIso, day).toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' })}
              </Muted>
            </Body>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['lunch', 'dinner'] as const).map((slot) => {
                const cellEntries = slotEntries(entries, day, slot);
                const coverage = slotCoverage(
                  entries,
                  day,
                  slot,
                  eaters.map((p) => p.id)
                );
                return (
                  <View
                    key={slot}
                    style={{
                      flex: 1,
                      backgroundColor: colors.card,
                      borderRadius: 14,
                      padding: 10,
                      gap: 8,
                      minHeight: 84,
                    }}
                  >
                    <Muted style={{ fontWeight: '700' }}>{SLOT_LABELS_FR[slot]}</Muted>
                    {cellEntries.map((entry) => (
                      <View
                        key={entry.id}
                        style={{
                          backgroundColor: colors.bg,
                          borderRadius: 10,
                          padding: 8,
                          gap: 6,
                        }}
                      >
                        <Text
                          numberOfLines={2}
                          style={{ color: colors.text, fontSize: fontSize.small, fontWeight: '600' }}
                        >
                          {entry.assigned_cook === 'employee' ? '👩‍🍳 ' : ''}
                          {recipeTitle(entry.recipe_id)}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          {entry.person_ids.length === 0 ? (
                            <Muted>Tout le foyer</Muted>
                          ) : (
                            entry.person_ids.map((pid) => {
                              const person = personById.get(pid);
                              return person ? <PersonChip key={pid} person={person} /> : null;
                            })
                          )}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Retirer ce plat"
                            onPress={() => void removeEntry(entry.id)}
                            style={{ marginLeft: 'auto', minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Text style={{ color: colors.danger, fontSize: fontSize.base }}>✕</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    {coverage.uncovered.length > 0 && cellEntries.length > 0 ? (
                      <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                        {coverage.uncovered.map((pid) => {
                          const person = personById.get(pid);
                          return person ? <PersonChip key={pid} person={person} hollow /> : null;
                        })}
                      </View>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Ajouter un plat — ${dayLabel} ${SLOT_LABELS_FR[slot]}`}
                      onPress={() => openPicker(day, slot)}
                      style={{
                        minHeight: 40,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1.5,
                        borderStyle: 'dashed',
                        borderColor: colors.textMuted,
                      }}
                    >
                      <Text style={{ color: colors.textMuted, fontSize: fontSize.base }}>＋</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <Button
          label="Valider la semaine"
          onPress={() => void approveWeek()}
          loading={busy}
          disabled={!plan || entries.length === 0 || plan.status === 'approved'}
          style={{ marginTop: 8 }}
        />
      </ScrollView>

      <Modal visible={pickerCell !== null} animationType="slide" onRequestClose={() => setPickerCell(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ flex: 1, padding: 20, gap: 14 }}>
            {pickerCell ? (
              <Title>
                {DAY_LABELS_FR[pickerCell.day]} — {SLOT_LABELS_FR[pickerCell.slot]}
              </Title>
            ) : null}
            {!pickedRecipe ? (
              <>
                <Field
                  value={pickerSearch}
                  onChangeText={setPickerSearch}
                  placeholder="Rechercher une recette"
                  autoCapitalize="none"
                />
                <FlatList
                  data={filteredRecipes}
                  keyExtractor={(r) => r.id}
                  renderItem={({ item }) => (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setPickedRecipe(item)}
                      style={({ pressed }) => ({
                        minHeight: minTapTarget,
                        justifyContent: 'center',
                        paddingHorizontal: 4,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Body>{item.title}</Body>
                    </Pressable>
                  )}
                  ListEmptyComponent={<Muted>Aucune recette. Capturez-en une d'abord.</Muted>}
                />
              </>
            ) : (
              <View style={{ gap: 16 }}>
                <Body style={{ fontWeight: '700' }}>{pickedRecipe.title}</Body>
                <Muted>Qui mange ? (personne sélectionnée = tout le foyer)</Muted>
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
                <Muted>Qui cuisine ?</Muted>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {(
                    [
                      ['family', 'Famille'],
                      ['employee', '👩‍🍳 Employée'],
                    ] as const
                  ).map(([cook, label]) => (
                    <Pressable
                      key={cook}
                      accessibilityRole="button"
                      onPress={() => setPickedCook(cook)}
                      style={{
                        flex: 1,
                        minHeight: minTapTarget,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: pickedCook === cook ? colors.accent : colors.card,
                      }}
                    >
                      <Text
                        style={{
                          color: pickedCook === cook ? '#FFFFFF' : colors.text,
                          fontSize: fontSize.base,
                          fontWeight: '600',
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Button label="Ajouter au planning" onPress={() => void confirmAdd()} loading={busy} />
                <Button label="Changer de recette" kind="secondary" onPress={() => setPickedRecipe(null)} />
              </View>
            )}
            <Button label="Fermer" kind="secondary" onPress={() => setPickerCell(null)} />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
