import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Field, Muted, Title } from '@/components/ui';
import { FODMAP_MODES, normalizeDietProfile, type DietProfile } from '@/lib/diet';
import { supabase } from '@/lib/supabase';
import { fontSize, minTapTarget, useTheme } from '@/lib/theme';

function TagEditor({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft('');
  };
  return (
    <View style={{ gap: 10 }}>
      <Body style={{ fontWeight: '700' }}>{label}</Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {values.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`Retirer ${value}`}
            onPress={() => onChange(values.filter((v) => v !== value))}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: colors.card,
              borderRadius: 10,
              paddingHorizontal: 12,
              minHeight: 40,
            }}
          >
            <Text style={{ color: colors.text, fontSize: fontSize.base }}>{value}</Text>
            <Text style={{ color: colors.danger, fontSize: fontSize.base }}>✕</Text>
          </Pressable>
        ))}
        {values.length === 0 ? <Muted>Aucun</Muted> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          style={{ flex: 1 }}
          onSubmitEditing={add}
        />
        <Button label="Ajouter" kind="secondary" onPress={add} />
      </View>
    </View>
  );
}

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();

  const [name, setName] = useState('');
  const [isEmployee, setIsEmployee] = useState(false);
  const [profile, setProfile] = useState<DietProfile | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('persons')
      .select('name, is_employee, diet_profile, other_requirements')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setName(data.name);
        setIsEmployee(data.is_employee);
        setProfile(normalizeDietProfile(data.diet_profile));
        setNotes(data.other_requirements ?? '');
        setLoaded(true);
      });
  }, [id]);

  const save = async () => {
    if (!id || !profile) return;
    setSaving(true);
    await supabase
      .from('persons')
      .update({
        name: name.trim() || name,
        is_employee: isEmployee,
        diet_profile: profile,
        // Stored verbatim (spec §2); structured proposals are Phase 3.
        other_requirements: notes,
      })
      .eq('id', id);
    setSaving(false);
    router.back();
  };

  const remove = () => {
    Alert.alert('Supprimer cette personne ?', `${name} sera retirée du foyer.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await supabase.from('persons').delete().eq('id', id);
            router.back();
          })();
        },
      },
    ]);
  };

  if (!loaded || !profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: 20 }}>
          <Muted>Chargement…</Muted>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={{ minHeight: minTapTarget, justifyContent: 'center' }}
        >
          <Body style={{ color: colors.accent, fontWeight: '600' }}>‹ Réglages</Body>
        </Pressable>
        <Title>{name || 'Personne'}</Title>

        <View style={{ gap: 10 }}>
          <Body style={{ fontWeight: '700' }}>Nom</Body>
          <Field value={name} onChangeText={setName} placeholder="Nom" />
        </View>

        <Card
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Body>Employée de maison</Body>
          <Switch
            value={isEmployee}
            onValueChange={setIsEmployee}
            trackColor={{ true: colors.accent }}
          />
        </Card>

        <View style={{ gap: 10 }}>
          <Body style={{ fontWeight: '700' }}>FODMAP</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {FODMAP_MODES.map(({ mode, labelFr }) => {
              const selected = profile.fodmap.mode === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  onPress={() =>
                    setProfile({ ...profile, fodmap: { ...profile.fodmap, mode } })
                  }
                  style={{
                    minHeight: minTapTarget,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? colors.accent : colors.card,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? '#FFFFFF' : colors.text,
                      fontSize: fontSize.base,
                      fontWeight: '600',
                    }}
                  >
                    {labelFr}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TagEditor
          label="Allergènes (exclusion stricte)"
          placeholder="Ex. : arachide"
          values={profile.allergens}
          onChange={(allergens) => setProfile({ ...profile, allergens })}
        />

        <TagEditor
          label="N'aime pas"
          placeholder="Ex. : chou-fleur"
          values={profile.dislikes}
          onChange={(dislikes) => setProfile({ ...profile, dislikes })}
        />

        <View style={{ gap: 10 }}>
          <Body style={{ fontWeight: '700' }}>Autres exigences</Body>
          <Field
            value={notes}
            onChangeText={setNotes}
            placeholder="Texte libre, pris en compte tel quel"
            multiline
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
        </View>

        <Button label="Enregistrer" onPress={() => void save()} loading={saving} />
        <Button label="Supprimer cette personne" kind="danger" onPress={remove} />
      </ScrollView>
    </SafeAreaView>
  );
}
