import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Eyebrow, FadeRise, Field, Muted, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { deriveCategory, spineColor, type ProteinCategory } from '@/lib/category';
import { normalizeDietProfile } from '@/lib/diet';
import {
  DAY_LABELS,
  SLOT_LABELS,
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
import { supabase } from '@/lib/supabase';
import {
  fonts,
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  useTheme,
} from '@/lib/theme';

interface Person {
  id: string;
  name: string;
  is_employee: boolean;
  diet_profile: unknown;
}

interface RecipeLite {
  id: string;
  title: string;
  tags: string[];
}

interface MealPlanRow {
  id: string;
  week_start: string;
  status: 'draft' | 'approved';
}

const CATEGORY_PILL_LABELS: Record<string, string> = {
  fish: 'Fish',
  meat: 'Meat',
  vegetarian: 'Veg',
  legume: 'Legume',
};

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
        minWidth: 32,
        height: 32,
        borderRadius: 16,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hollow ? 'transparent' : selected === false ? colors.cardPressed : colors.accent,
        borderWidth: hollow ? 2 : 0,
        borderColor: colors.textMuted,
      }}
    >
      <Text
        style={{
          color: hollow ? colors.textMuted : selected === false ? colors.text : colors.accentText,
          fontSize: 13,
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
      accessibilityLabel={person.name}
      accessibilityState={{ selected: selected !== false }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: minTapTarget,
        justifyContent: 'center',
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      {chip}
    </Pressable>
  );
}

/** Quota pill "Fish 1/2" in the category's spine color. */
function QuotaPill({
  category,
  planned,
  target,
}: {
  category: ProteinCategory;
  planned: number;
  target: number;
}) {
  const { colors } = useTheme();
  const color = spineColor(category, colors);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: color,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color, fontSize: fontSize.eyebrow, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {CATEGORY_PILL_LABELS[category] ?? category} {planned}/{target}
      </Text>
    </View>
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
          supabase
            .from('persons')
            .select('id, name, is_employee, diet_profile')
            .eq('household_id', householdId)
            .order('created_at'),
          supabase.from('recipes').select('id, title, tags').eq('household_id', householdId).order('title'),
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

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);
  const eaters = useMemo(() => persons.filter((p) => !p.is_employee), [persons]);

  /**
   * Household quota strip: per category, worst-covered eater (lowest planned)
   * against the highest personal minimum. Categories without a minimum hide.
   */
  const quotaPills = useMemo(() => {
    if (eaters.length === 0) return [];
    const perPerson = eaters.map((person) =>
      quotaProgress(
        entries,
        person.id,
        recipes,
        normalizeDietProfile(person.diet_profile).proteinQuotas.targets
      )
    );
    const categories = new Set(perPerson.flat().map((p) => p.category));
    const pills: { category: ProteinCategory; planned: number; target: number }[] = [];
    for (const category of ['fish', 'meat', 'vegetarian', 'legume'] as ProteinCategory[]) {
      if (!categories.has(category)) continue;
      const rows = perPerson
        .map((progress) => progress.find((p) => p.category === category))
        .filter((row) => row !== undefined);
      const target = Math.max(...rows.map((r) => r.min));
      if (target <= 0) continue;
      const planned = Math.min(...rows.map((r) => r.planned));
      pills.push({ category, planned, target });
    }
    return pills;
  }, [eaters, entries, recipes]);

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
        eaters.map((p) => p.id),
        weekIso
      );
      if (events.length > 0) await supabase.from('events').insert(events);
      await loadWeek(weekIso);
    } finally {
      setBusy(false);
    }
  };

  const todayEyebrow = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const weekLabel = `Week of ${dayDate(weekIso, 0).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })}`;
  const todayIndex = DAY_LABELS.findIndex(
    (_, day) => dayDate(weekIso, day).toDateString() === new Date().toDateString()
  );

  const filteredRecipes = recipes.filter((r) =>
    r.title.toLowerCase().includes(pickerSearch.trim().toLowerCase())
  );
  const showApprove = plan?.status === 'draft' && entries.length > 0;

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
        <View style={{ flex: 1, gap: 2 }}>
          <Eyebrow>{todayEyebrow}</Eyebrow>
          <Title>Week</Title>
          <Muted>
            {weekLabel}
            {plan?.status === 'approved' ? ' · approved' : ''}
          </Muted>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          onPress={() => setWeekIso(addWeeks(weekIso, -1))}
          style={({ pressed }) => ({
            width: minTapTarget,
            height: minTapTarget,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: minTapTarget / 2,
            backgroundColor: pressed ? colors.cardPressed : 'transparent',
          })}
        >
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next week"
          onPress={() => setWeekIso(addWeeks(weekIso, 1))}
          style={({ pressed }) => ({
            width: minTapTarget,
            height: minTapTarget,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: minTapTarget / 2,
            backgroundColor: pressed ? colors.cardPressed : 'transparent',
          })}
        >
          <Ionicons name="chevron-forward" size={26} color={colors.accent} />
        </Pressable>
      </View>

      {/* Quota strip */}
      {quotaPills.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            paddingHorizontal: screenPadding,
            paddingBottom: 10,
          }}
        >
          {quotaPills.map((pill) => (
            <QuotaPill key={pill.category} {...pill} />
          ))}
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: 24, gap: 12 }}>
        {DAY_LABELS.map((dayLabel, day) => {
          const isToday = day === todayIndex;
          return (
            <FadeRise key={day} index={day}>
              <Card style={{ gap: 10, padding: 12, borderColor: isToday ? colors.accent : colors.border }}>
                {isToday ? <Eyebrow style={{ color: colors.saffron }}>Today</Eyebrow> : null}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ color: colors.text, fontSize: fontSize.medium, fontFamily: fonts.display }}>
                    {dayLabel}
                  </Text>
                  <Muted>
                    {dayDate(weekIso, day).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Muted>
                </View>
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
                      <View key={slot} style={{ flex: 1, gap: 8 }}>
                        <Eyebrow>{SLOT_LABELS[slot]}</Eyebrow>
                        {cellEntries.map((entry) => {
                          const recipe = recipeById.get(entry.recipe_id);
                          const spine = spineColor(deriveCategory(recipe?.tags ?? []), colors);
                          return (
                            <View
                              key={entry.id}
                              style={{
                                backgroundColor: colors.bg,
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: colors.border,
                                padding: 8,
                                paddingLeft: 12,
                                gap: 6,
                                overflow: 'hidden',
                              }}
                            >
                              {spine !== 'transparent' ? (
                                <View
                                  style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 8,
                                    bottom: 8,
                                    width: 4,
                                    borderTopRightRadius: 2,
                                    borderBottomRightRadius: 2,
                                    backgroundColor: spine,
                                  }}
                                />
                              ) : null}
                              <Text
                                numberOfLines={2}
                                style={{ color: colors.text, fontSize: fontSize.small, fontWeight: '600' }}
                              >
                                {entry.assigned_cook === 'employee' ? '👩‍🍳 ' : ''}
                                {recipe?.title ?? 'Recipe'}
                              </Text>
                              <View
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}
                              >
                                {entry.person_ids.length === 0 ? (
                                  <Muted style={{ fontSize: fontSize.eyebrow }}>Whole household</Muted>
                                ) : (
                                  entry.person_ids.map((pid) => {
                                    const person = personById.get(pid);
                                    return person ? <PersonChip key={pid} person={person} /> : null;
                                  })
                                )}
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="Remove this dish"
                                  onPress={() => void removeEntry(entry.id)}
                                  style={({ pressed }) => ({
                                    marginLeft: 'auto',
                                    minWidth: 32,
                                    minHeight: 32,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: pressed ? 0.6 : 1,
                                  })}
                                >
                                  <Ionicons name="close" size={18} color={colors.textMuted} />
                                </Pressable>
                              </View>
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
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Add a dish — ${dayLabel} ${SLOT_LABELS[slot]}`}
                          onPress={() => openPicker(day, slot)}
                          style={({ pressed }) => ({
                            minHeight: 44,
                            borderRadius: 10,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 1.5,
                            borderStyle: 'dashed',
                            borderColor: pressed ? colors.accent : colors.textMuted,
                            backgroundColor: pressed ? colors.cardPressed : 'transparent',
                          })}
                        >
                          <Text style={{ color: colors.textMuted, fontSize: fontSize.small, fontWeight: '600' }}>
                            Add
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              </Card>
            </FadeRise>
          );
        })}
      </ScrollView>

      {/* Sticky approve bar: draft + non-empty only */}
      {showApprove ? (
        <View
          style={{
            paddingHorizontal: screenPadding,
            paddingTop: 10,
            paddingBottom: 10,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.bg,
          }}
        >
          <Button label="Approve week" onPress={() => void approveWeek()} loading={busy} />
        </View>
      ) : null}

      <Modal visible={pickerCell !== null} animationType="slide" onRequestClose={() => setPickerCell(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ flex: 1, padding: screenPadding, gap: 14 }}>
            {pickerCell ? (
              <Title>
                {DAY_LABELS[pickerCell.day]} — {SLOT_LABELS[pickerCell.slot]}
              </Title>
            ) : null}
            {!pickedRecipe ? (
              <>
                <Field
                  value={pickerSearch}
                  onChangeText={setPickerSearch}
                  placeholder="Search recipes"
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
                        paddingHorizontal: 12,
                        borderRadius: radius.control,
                        backgroundColor: pressed ? colors.cardPressed : 'transparent',
                      })}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {(() => {
                          const spine = spineColor(deriveCategory(item.tags), colors);
                          return spine !== 'transparent' ? (
                            <View style={{ width: 4, height: 20, borderRadius: 2, backgroundColor: spine }} />
                          ) : (
                            <View style={{ width: 4 }} />
                          );
                        })()}
                        <Body>{item.title}</Body>
                      </View>
                    </Pressable>
                  )}
                  ListEmptyComponent={<Muted>No recipes yet. Capture one first.</Muted>}
                />
              </>
            ) : (
              <View style={{ gap: 16 }}>
                <Body style={{ fontWeight: '700' }}>{pickedRecipe.title}</Body>
                <Muted>Who eats? No selection means the whole household.</Muted>
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
                <Muted>Who cooks?</Muted>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {(
                    [
                      ['family', 'Family'],
                      ['employee', '👩‍🍳 Employee'],
                    ] as const
                  ).map(([cook, label]) => (
                    <Pressable
                      key={cook}
                      accessibilityRole="button"
                      accessibilityState={{ selected: pickedCook === cook }}
                      onPress={() => setPickedCook(cook)}
                      style={({ pressed }) => ({
                        flex: 1,
                        minHeight: minTapTarget,
                        borderRadius: radius.control,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: pickedCook === cook ? colors.accent : colors.border,
                        backgroundColor:
                          pickedCook === cook ? colors.accent : pressed ? colors.cardPressed : colors.card,
                      })}
                    >
                      <Text
                        style={{
                          color: pickedCook === cook ? colors.accentText : colors.text,
                          fontSize: fontSize.base,
                          fontWeight: '600',
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Button label="Add to the week" onPress={() => void confirmAdd()} loading={busy} />
                <Button label="Pick another recipe" kind="secondary" onPress={() => setPickedRecipe(null)} />
              </View>
            )}
            <Button label="Close" kind="secondary" onPress={() => setPickerCell(null)} />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
