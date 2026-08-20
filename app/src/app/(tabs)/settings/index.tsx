import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Field, Muted, Title } from '@/components/ui';
import { useAuth, useHousehold } from '@/lib/auth';
import { normalizeDietProfile, QUOTA_CATEGORIES, type DietProfile } from '@/lib/diet';
import { supabase } from '@/lib/supabase';
import { fontSize, minTapTarget, useTheme, type ThemeOverride } from '@/lib/theme';

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
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  /** For max bounds: stepping past 7 yields null (no limit, shown ∞). */
  allowNull?: boolean;
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
  const buttonStyle = {
    width: minTapTarget,
    height: minTapTarget,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.bg,
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Pressable accessibilityRole="button" onPress={dec} style={buttonStyle}>
        <Text style={{ color: colors.accent, fontSize: fontSize.large }}>−</Text>
      </Pressable>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.base,
          fontWeight: '700',
          minWidth: 26,
          textAlign: 'center',
        }}
      >
        {value === null ? '∞' : value}
      </Text>
      <Pressable accessibilityRole="button" onPress={inc} style={buttonStyle}>
        <Text style={{ color: colors.accent, fontSize: fontSize.large }}>＋</Text>
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
      <ScrollView contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 48 }}>
        <Title>Réglages</Title>

        {/* Foyer */}
        <View style={{ gap: 12 }}>
          <Body style={{ fontWeight: '700', fontSize: fontSize.large }}>Foyer</Body>
          <Card style={{ gap: 4 }}>
            {persons.map((person) => (
              <Pressable
                key={person.id}
                accessibilityRole="button"
                onPress={() => router.push(`/settings/person/${person.id}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  minHeight: minTapTarget,
                  gap: 10,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Body style={{ flex: 1 }}>{person.name}</Body>
                {person.is_employee ? (
                  <View
                    style={{
                      backgroundColor: colors.accent,
                      borderRadius: 8,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>
                      employée
                    </Text>
                  </View>
                ) : null}
                <Text style={{ color: colors.textMuted, fontSize: fontSize.large }}>›</Text>
              </Pressable>
            ))}
            {persons.length === 0 ? <Muted>Aucune personne pour le moment.</Muted> : null}
          </Card>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field
              value={newPersonName}
              onChangeText={setNewPersonName}
              placeholder="Nom de la personne"
              style={{ flex: 1 }}
            />
            <Button label="Ajouter" onPress={() => void addPerson()} />
          </View>
        </View>

        {/* Planification */}
        <View style={{ gap: 12 }}>
          <Body style={{ fontWeight: '700', fontSize: fontSize.large }}>Planification</Body>
          <Muted>Quotas de protéines par personne et par semaine (min – max).</Muted>
          {persons
            .filter((p) => !p.is_employee)
            .map((person) => {
              const profile = normalizeDietProfile(person.diet_profile);
              return (
                <Card key={person.id} style={{ gap: 10 }}>
                  <Body style={{ fontWeight: '700' }}>{person.name}</Body>
                  {QUOTA_CATEGORIES.map(({ category, labelFr }) => {
                    const target = profile.proteinQuotas.targets.find(
                      (t) => t.category === category
                    )!;
                    return (
                      <View
                        key={category}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                      >
                        <Body style={{ flex: 1 }}>{labelFr}</Body>
                        <Stepper
                          value={target.min}
                          onChange={(v) => void updateQuota(person, category, 'min', v)}
                        />
                        <Muted>–</Muted>
                        <Stepper
                          value={target.max}
                          allowNull
                          onChange={(v) => void updateQuota(person, category, 'max', v)}
                        />
                      </View>
                    );
                  })}
                </Card>
              );
            })}
        </View>

        {/* Autres exigences */}
        <View style={{ gap: 12 }}>
          <Body style={{ fontWeight: '700', fontSize: fontSize.large }}>Autres exigences</Body>
          <Muted>
            Texte libre pour tout le foyer, pris en compte tel quel lors de la planification.
          </Muted>
          <Field
            value={householdNotes}
            onChangeText={setHouseholdNotes}
            placeholder="Ex. : pas de porc, dîner léger le dimanche…"
            multiline
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
          <Button
            label={notesSaved ? 'Enregistré ✓' : 'Enregistrer'}
            kind="secondary"
            onPress={() => void saveHouseholdNotes()}
          />
        </View>

        {/* Apparence */}
        <View style={{ gap: 12 }}>
          <Body style={{ fontWeight: '700', fontSize: fontSize.large }}>Apparence</Body>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(
              [
                ['system', 'Système'],
                ['light', 'Clair'],
                ['dark', 'Sombre'],
              ] as [ThemeOverride, string][]
            ).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                onPress={() => setOverride(value)}
                style={{
                  flex: 1,
                  minHeight: minTapTarget,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: override === value ? colors.accent : colors.card,
                }}
              >
                <Text
                  style={{
                    color: override === value ? '#FFFFFF' : colors.text,
                    fontSize: fontSize.base,
                    fontWeight: '600',
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Button label="Se déconnecter" kind="danger" onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}
