import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { useAuth, useHousehold } from '@/lib/auth';
import { normalizeDietProfile, QUOTA_CATEGORIES, type DietProfile } from '@/lib/diet';
import { supabase } from '@/lib/supabase';
import {
  controlHeight,
  fonts,
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  useTheme,
  type ThemeOverride,
} from '@/lib/theme';

interface PersonRow {
  id: string;
  name: string;
  is_employee: boolean;
  diet_profile: unknown;
  other_requirements: string;
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
    width: 40,
    height: 40,
    borderRadius: 20,
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
        hitSlop={6}
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
          minWidth: 26,
          textAlign: 'center',
        }}
      >
        {value === null ? '∞' : value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        onPress={inc}
        hitSlop={6}
        style={({ pressed }) => buttonStyle(pressed)}
      >
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

export default function SettingsScreen() {
  const { colors, override, setOverride } = useTheme();
  const router = useRouter();
  const { householdId } = useHousehold();
  const { signOut } = useAuth();

  const [persons, setPersons] = useState<PersonRow[]>([]);
  const [newPersonName, setNewPersonName] = useState('');
  const [householdNotes, setHouseholdNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);

  const load = useCallback(async () => {
    const [{ data: personRows }, { data: hh }] = await Promise.all([
      supabase
        .from('persons')
        .select('id, name, is_employee, diet_profile, other_requirements')
        .eq('household_id', householdId)
        .order('created_at'),
      supabase.from('households').select('other_requirements').eq('id', householdId).single(),
    ]);
    setPersons((personRows as PersonRow[]) ?? []);
    if (hh) setHouseholdNotes(hh.other_requirements ?? '');
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const addPerson = async () => {
    const name = newPersonName.trim();
    if (!name) return;
    await supabase.from('persons').insert({ household_id: householdId, name });
    setNewPersonName('');
    await load();
  };

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

  const saveHouseholdNotes = async () => {
    // Stored verbatim; structured-proposal parsing is Phase 3 (spec §2).
    await supabase
      .from('households')
      .update({ other_requirements: householdNotes })
      .eq('id', householdId);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 24, paddingBottom: 48 }}>
        <Title>Settings</Title>

        {/* Household */}
        <View style={{ gap: 10 }}>
          <Eyebrow>Household</Eyebrow>
          <View>
            {persons.map((person, index) => (
              <View key={person.id}>
                {index > 0 ? <Hairline /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${person.name}`}
                  onPress={() => router.push(`/settings/person/${person.id}`)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    minHeight: controlHeight + 4,
                    gap: 10,
                    backgroundColor: pressed ? colors.cardPressed : 'transparent',
                  })}
                >
                  <Body style={{ flex: 1 }}>{person.name}</Body>
                  {person.is_employee ? <Muted>employee</Muted> : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
            {persons.length === 0 ? (
              <Muted style={{ paddingVertical: 12 }}>No people yet. Add the household below.</Muted>
            ) : null}
            <Hairline />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field
              value={newPersonName}
              onChangeText={setNewPersonName}
              placeholder="Person's name"
              style={{ flex: 1 }}
              onSubmitEditing={() => void addPerson()}
            />
            <Button label="Add" kind="secondary" onPress={() => void addPerson()} />
          </View>
        </View>

        {/* Meal planning */}
        <View style={{ gap: 10 }}>
          <Eyebrow>Meal planning</Eyebrow>
          <Muted>Protein quotas per person, per week (min – max).</Muted>
          {persons
            .filter((p) => !p.is_employee)
            .map((person) => {
              const profile = normalizeDietProfile(person.diet_profile);
              return (
                <View key={person.id} style={{ gap: 8, paddingTop: 6 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: fontSize.cardTitle,
                      fontFamily: fonts.displaySemi,
                    }}
                  >
                    {person.name}
                  </Text>
                  {QUOTA_CATEGORIES.map(({ category, label }, index) => {
                    const target = profile.proteinQuotas.targets.find(
                      (t) => t.category === category
                    )!;
                    return (
                      <View key={category}>
                        {index > 0 ? <Hairline /> : null}
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 8,
                            paddingVertical: 6,
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
                      </View>
                    );
                  })}
                  <Hairline />
                </View>
              );
            })}
        </View>

        {/* Other requirements */}
        <View style={{ gap: 10 }}>
          <Eyebrow>Other requirements</Eyebrow>
          <Muted>Free text for the whole household, used as-is when planning.</Muted>
          <Field
            value={householdNotes}
            onChangeText={setHouseholdNotes}
            placeholder="e.g. no pork, light dinner on Sundays…"
            multiline
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
          <Button
            label={notesSaved ? 'Saved' : 'Save'}
            kind="secondary"
            onPress={() => void saveHouseholdNotes()}
          />
        </View>

        {/* Appearance */}
        <View style={{ gap: 10 }}>
          <Eyebrow>Appearance</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(
              [
                ['system', 'System'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ] as [ThemeOverride, string][]
            ).map(([value, label]) => {
              const selected = override === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setOverride(value)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: minTapTarget,
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
                      fontSize: fontSize.base,
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

        <Button label="Sign out" kind="danger" onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}
