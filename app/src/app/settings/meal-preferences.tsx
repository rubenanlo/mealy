import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Stepper } from '@/components/preference-controls';
import {
  Body,
  Button,
  Eyebrow,
  Field,
  Muted,
  SettingsGroup,
  SettingsRow,
  Title,
} from '@/components/ui';
import { useHousehold } from '@/lib/auth';
import { normalizeDietProfile, type FodmapMode } from '@/lib/diet';
import { useI18n } from '@/lib/i18n';
import { backOr } from '@/lib/nav';
import { normalizeMealTimes, parseHHMM, type MealTimes } from '@/lib/meal-times';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

interface PersonRow {
  id: string;
  name: string;
  is_employee: boolean;
  diet_profile: unknown;
}

/**
 * Meal preferences, split in two: family-wide settings (suggestions, meal
 * times, shared requirements) and per-person preferences (quotas, FODMAP,
 * allergens, dislikes) reached through the person rows.
 */
export default function MealPreferencesScreen() {
  const { colors } = useTheme();
  const { d } = useI18n();
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

  const saveMealTimes = async () => {
    const values = [
      mealTimes.lunch.start,
      mealTimes.lunch.end,
      mealTimes.dinner.start,
      mealTimes.dinner.end,
    ];
    if (values.some((v) => parseHHMM(v) === null)) {
      setTimesError(d.mealPrefs.timesError);
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

  // Display labels only — the stored mode values never change.
  const fodmapLabels: Record<FodmapMode, string> = {
    off: d.person.fodmapOff,
    elimination: d.person.fodmapElimination,
    reintroduction: d.person.fodmapReintroduction,
    personalized: d.person.fodmapPersonalized,
  };

  const sectionHeader = (label: string) => (
    <Text
      style={{
        color: colors.text,
        fontSize: fontSize.cardTitle,
        fontFamily: fonts.displaySemi,
        marginTop: 12,
      }}
    >
      {label}
    </Text>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: 12, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.mealPrefs.backToSettings}
          onPress={() => backOr('/settings')}
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
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.mealPrefs.settings}</Body>
        </Pressable>
        <Title>{d.mealPrefs.title}</Title>

        {/* ---- Family-wide settings ---- */}
        {sectionHeader(d.mealPrefs.familySection)}

        <Eyebrow style={{ marginTop: 4 }}>{d.mealPrefs.suggestions}</Eyebrow>
        <Muted>{d.mealPrefs.suggestionsHint}</Muted>
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
            <Body style={{ flex: 1 }}>{d.mealPrefs.restWeeks}</Body>
            <Stepper
              value={restWeeks}
              label={d.mealPrefs.restWeeks}
              onChange={(v) => void updateRestWeeks(v)}
            />
          </View>
        </SettingsGroup>

        <Eyebrow style={{ marginTop: 16 }}>{d.mealPrefs.mealTimes}</Eyebrow>
        <Muted>{d.mealPrefs.mealTimesHint}</Muted>
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
              <Body style={{ flex: 1, textTransform: 'capitalize' }}>
                {slot === 'lunch' ? d.common.lunch : d.common.dinner}
              </Body>
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
          label={timesSaved ? d.mealPrefs.saved : d.mealPrefs.saveMealTimes}
          kind="secondary"
          onPress={() => void saveMealTimes()}
        />

        <Eyebrow style={{ marginTop: 16 }}>{d.mealPrefs.otherRequirements}</Eyebrow>
        <Muted>{d.mealPrefs.otherRequirementsHint}</Muted>
        <Field
          value={householdNotes}
          onChangeText={setHouseholdNotes}
          placeholder={d.mealPrefs.otherRequirementsPlaceholder}
          multiline
          style={{ minHeight: 100, textAlignVertical: 'top', backgroundColor: colors.card }}
        />
        <Button
          label={notesSaved ? d.mealPrefs.saved : d.common.save}
          kind="secondary"
          onPress={() => void saveHouseholdNotes()}
        />

        {/* ---- Per-person preferences: quotas, FODMAP, allergens, dislikes.
             Employees cook rather than eat, so they are not listed here. ---- */}
        {sectionHeader(d.mealPrefs.personSection)}
        <SettingsGroup>
          {persons.filter((p) => !p.is_employee).map((person) => {
            const profile = normalizeDietProfile(person.diet_profile);
            return (
              <SettingsRow
                key={person.id}
                label={person.name}
                value={fodmapLabels[profile.fodmap.mode]}
                onPress={() => router.push(`/settings/preferences/${person.id}`)}
              />
            );
          })}
          {persons.filter((p) => !p.is_employee).length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <Muted>{d.mealPrefs.noPeople}</Muted>
            </View>
          ) : null}
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
