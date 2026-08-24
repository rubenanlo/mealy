import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Muted, SettingsGroup, Title } from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { normalizeDietProfile, QUOTA_CATEGORIES, type DietProfile } from '@/lib/diet';
import { normalizeMealTimes, parseHHMM, type MealTimes } from '@/lib/meal-times';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

interface PersonRow {
  id: string;
  name: string;
  is_employee: boolean;
  diet_profile: unknown;
}

function Stepper({
  value,
  onChange,
  allowNull,
  label,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  /** For max bounds: stepping past 7 yields null (no limit, shown ∞). */
  allowNull?: boolean;
  label: string;
}) {
  const { colors } = useTheme();
  const dec = () => {
    if (value === null) onChange(7);
    else if (value > 0) onChange(value - 1);
  };
  const inc = () => {
    if (value === null) return;
    if (value >= 7) onChange(allowNull ? null : 7);
    else onChange(value + 1);
  };
  const buttonStyle = (pressed: boolean) => ({
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: pressed ? colors.cardPressed : 'transparent',
  });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        onPress={dec}
        hitSlop={8}
        style={({ pressed }) => buttonStyle(pressed)}
      >
        <Ionicons name="remove" size={18} color={colors.text} />
      </Pressable>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.base,
          fontFamily: fonts.uiSemi,
          fontVariant: ['tabular-nums'],
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {value === null ? '∞' : value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        onPress={inc}
        hitSlop={8}
        style={({ pressed }) => buttonStyle(pressed)}
      >
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

export default function MealPreferencesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();

  const [persons, setPersons] = useState<PersonRow[]>([]);
  const [householdNotes, setHouseholdNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const [mealTimes, setMealTimes] = useState<MealTimes>(normalizeMealTimes(null));
  const [timesSaved, setTimesSaved] = useState(false);
  const [timesError, setTimesError] = useState<string | null>(null);
  const [restWeeks, setRestWeeks] = useState<number>(3);

  const load = useCallback(async () => {
    const [{ data: personRows }, { data: hh }] = await Promise.all([
      supabase
        .from('persons')
        .select('id, name, is_employee, diet_profile')
        .eq('household_id', householdId)
        .order('created_at'),
      supabase
        .from('households')
        .select('other_requirements, meal_times, suggested_rest_weeks')
        .eq('id', householdId)
        .single(),
    ]);
    setPersons((personRows as PersonRow[]) ?? []);
    if (hh) {
      setHouseholdNotes(hh.other_requirements ?? '');
      setMealTimes(normalizeMealTimes(hh.meal_times));
      if (typeof hh.suggested_rest_weeks === 'number') setRestWeeks(hh.suggested_rest_weeks);
    }
  }, [householdId]);

  const updateRestWeeks = async (next: number | null) => {
    const value = next ?? 0;
    setRestWeeks(value);
    await supabase
      .from('households')
      .update({ suggested_rest_weeks: value })
      .eq('id', householdId);
  };

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const updateQuota = async (
    person: PersonRow,
    category: string,
    field: 'min' | 'max',
    next: number | null
  ) => {
    const profile: DietProfile = normalizeDietProfile(person.diet_profile);
    const targets = profile.proteinQuotas.targets.map((t) =>
      t.category === category ? { ...t, [field]: next } : t
    );
    const updated = { ...profile, proteinQuotas: { period: 'week', targets } };
    setPersons((prev) =>
      prev.map((p) => (p.id === person.id ? { ...p, diet_profile: updated } : p))
    );
    await supabase.from('persons').update({ diet_profile: updated }).eq('id', person.id);
  };

  const saveMealTimes = async () => {
    const values = [
      mealTimes.lunch.start,
      mealTimes.lunch.end,
      mealTimes.dinner.start,
      mealTimes.dinner.end,
    ];
    if (values.some((v) => parseHHMM(v) === null)) {
      setTimesError('Times must be HH:MM, e.g. 13:30.');
      return;
    }
    setTimesError(null);
    await supabase.from('households').update({ meal_times: mealTimes }).eq('id', householdId);
    setTimesSaved(true);
    setTimeout(() => setTimesSaved(false), 2000);
  };

  const setTime = (slot: 'lunch' | 'dinner', field: 'start' | 'end', value: string) =>
    setMealTimes((prev) => ({ ...prev, [slot]: { ...prev[slot], [field]: value } }));

  const saveHouseholdNotes = async () => {
    // Stored verbatim; structured-proposal parsing is Phase 3 (spec §2).
    await supabase
      .from('households')
      .update({ other_requirements: householdNotes })
      .eq('id', householdId);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };

  const diners = persons.filter((p) => !p.is_employee);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
          onPress={() => router.back()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: minTapTarget,
            alignSelf: 'flex-start',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Body style={{ fontFamily: fonts.uiSemi }}>Settings</Body>
        </Pressable>
        <Title>Meal preferences</Title>
        <Muted>Protein quotas per person, per week (min – max).</Muted>

        {diners.map((person) => {
          const profile = normalizeDietProfile(person.diet_profile);
          return (
            <View key={person.id} style={{ gap: 8, marginTop: 8 }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: fontSize.cardTitle,
                  fontFamily: fonts.displaySemi,
                }}
              >
                {person.name}
              </Text>
              <SettingsGroup>
                {QUOTA_CATEGORIES.map(({ category, label }) => {
                  const target = profile.proteinQuotas.targets.find(
                    (t) => t.category === category
                  )!;
                  return (
                    <View
                      key={category}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        minHeight: 56,
                        paddingHorizontal: 16,
                      }}
                    >
                      <Body style={{ flex: 1 }}>{label}</Body>
                      <Stepper
                        value={target.min}
                        label={`minimum ${label}`}
                        onChange={(v) => void updateQuota(person, category, 'min', v)}
                      />
                      <Muted>–</Muted>
                      <Stepper
                        value={target.max}
                        allowNull
                        label={`maximum ${label}`}
                        onChange={(v) => void updateQuota(person, category, 'max', v)}
                      />
                    </View>
                  );
                })}
              </SettingsGroup>
            </View>
          );
        })}
        {diners.length === 0 ? (
          <Muted>No people yet — add your household under Manage your account.</Muted>
        ) : null}

        <Eyebrow style={{ marginTop: 16 }}>Suggestions</Eyebrow>
        <Muted>
          Weeks a recipe rests after being planned before it reappears in Suggested for you. 0
          hides only this week's picks.
        </Muted>
        <SettingsGroup>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              minHeight: 56,
              paddingHorizontal: 16,
            }}
          >
            <Body style={{ flex: 1 }}>Rest weeks</Body>
            <Stepper
              value={restWeeks}
              label="rest weeks"
              onChange={(v) => void updateRestWeeks(v)}
            />
          </View>
        </SettingsGroup>

        <Eyebrow style={{ marginTop: 16 }}>Meal times</Eyebrow>
        <Muted>
          When lunch and dinner happen. The week page uses the end time to know a meal is done.
        </Muted>
        <SettingsGroup>
          {(['lunch', 'dinner'] as const).map((slot) => (
            <View
              key={slot}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: 56,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Body style={{ flex: 1, textTransform: 'capitalize' }}>{slot}</Body>
              <Field
                value={mealTimes[slot].start}
                onChangeText={(v) => setTime(slot, 'start', v)}
                placeholder="12:00"
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                style={{ width: 76, textAlign: 'center' }}
              />
              <Muted>–</Muted>
              <Field
                value={mealTimes[slot].end}
                onChangeText={(v) => setTime(slot, 'end', v)}
                placeholder="15:00"
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                style={{ width: 76, textAlign: 'center' }}
              />
            </View>
          ))}
        </SettingsGroup>
        {timesError ? <Body style={{ color: colors.danger }}>{timesError}</Body> : null}
        <Button
          label={timesSaved ? 'Saved' : 'Save meal times'}
          kind="secondary"
          onPress={() => void saveMealTimes()}
        />

        <Eyebrow style={{ marginTop: 16 }}>Other requirements</Eyebrow>
        <Muted>Free text for the whole household, used as-is when planning.</Muted>
        <Field
          value={householdNotes}
          onChangeText={setHouseholdNotes}
          placeholder="e.g. no pork, light dinner on Sundays…"
          multiline
          style={{ minHeight: 100, textAlignVertical: 'top', backgroundColor: colors.card }}
        />
        <Button
          label={notesSaved ? 'Saved' : 'Save'}
          kind="secondary"
          onPress={() => void saveHouseholdNotes()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
