import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Eyebrow, Field, Muted, Title } from '@/components/ui';
import { useAuth, useHousehold } from '@/lib/auth';
import { normalizeDietProfile, QUOTA_CATEGORIES, type DietProfile } from '@/lib/diet';
import { supabase } from '@/lib/supabase';
import {
  controlHeight,
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
    width: minTapTarget,
    height: minTapTarget,
    borderRadius: radius.control,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: pressed ? colors.cardPressed : colors.bg,
  });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        onPress={dec}
        style={({ pressed }) => buttonStyle(pressed)}
      >
        <Ionicons name="remove" size={20} color={colors.accent} />
      </Pressable>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.base,
          fontWeight: '700',
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
        style={({ pressed }) => buttonStyle(pressed)}
      >
        <Ionicons name="add" size={20} color={colors.accent} />
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
          <Card style={{ paddingVertical: 4 }}>
            {persons.map((person) => (
              <Pressable
                key={person.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${person.name}`}
                onPress={() => router.push(`/settings/person/${person.id}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  minHeight: controlHeight,
                  gap: 10,
                  marginHorizontal: -12,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  backgroundColor: pressed ? colors.cardPressed : 'transparent',
                })}
              >
                <Body style={{ flex: 1 }}>{person.name}</Body>
                {person.is_employee ? (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow, fontWeight: '600' }}>
                      employee
                    </Text>
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            ))}
            {persons.length === 0 ? (
              <Muted style={{ paddingVertical: 12 }}>No people yet. Add the household below.</Muted>
            ) : null}
          </Card>
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
                <Card key={person.id} style={{ gap: 10 }}>
                  <Body style={{ fontWeight: '700' }}>{person.name}</Body>
                  {QUOTA_CATEGORIES.map(({ category, label }) => {
                    const target = profile.proteinQuotas.targets.find(
                      (t) => t.category === category
                    )!;
                    return (
                      <View
                        key={category}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
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
                </Card>
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
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected
                      ? colors.accent
                      : pressed
                        ? colors.cardPressed
                        : colors.card,
                  })}
                >
                  <Text
                    style={{
                      color: selected ? colors.accentText : colors.text,
                      fontSize: fontSize.base,
                      fontWeight: '600',
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
