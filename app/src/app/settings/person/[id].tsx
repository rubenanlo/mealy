import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { FODMAP_MODES, normalizeDietProfile, type DietProfile } from '@/lib/diet';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';

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
      <Eyebrow>{label}</Eyebrow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {values.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${value}`}
            onPress={() => onChange(values.filter((v) => v !== value))}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: pressed ? colors.cardPressed : 'transparent',
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 999,
              paddingHorizontal: 12,
              minHeight: 40,
            })}
          >
            <Text style={{ color: colors.text, fontSize: fontSize.small, fontFamily: fonts.ui }}>
              {value}
            </Text>
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
        {values.length === 0 ? <Muted>None</Muted> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          style={{ flex: 1 }}
          onSubmitEditing={add}
        />
        <Button label="Add" kind="secondary" onPress={add} />
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
    Alert.alert('Remove this person?', `${name} will be removed from the household.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
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
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }}>
        <View style={{ padding: screenPadding }}>
          <Muted>Loading…</Muted>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 20, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to account"
          onPress={() => router.back()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: minTapTarget,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Body style={{ fontFamily: fonts.uiSemi }}>Account</Body>
        </Pressable>
        <Title>{name || 'Person'}</Title>

        <View style={{ gap: 10 }}>
          <Eyebrow>Name</Eyebrow>
          <Field value={name} onChangeText={setName} placeholder="Name" />
        </View>

        <View>
          <Hairline />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 52,
            }}
          >
            <Body>Household employee</Body>
            <Switch
              value={isEmployee}
              onValueChange={setIsEmployee}
              trackColor={{ true: colors.accent }}
            />
          </View>
          <Hairline />
        </View>

        <View style={{ gap: 10 }}>
          <Eyebrow>FODMAP</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {FODMAP_MODES.map(({ mode, label }) => {
              const selected = profile.fodmap.mode === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() =>
                    setProfile({ ...profile, fodmap: { ...profile.fodmap, mode } })
                  }
                  style={({ pressed }) => ({
                    minHeight: minTapTarget,
                    borderRadius: radius.control,
                    paddingHorizontal: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: selected ? 0 : 1,
                    borderColor: colors.border,
                    backgroundColor: selected
                      ? colors.text
                      : pressed
                        ? colors.cardPressed
                        : 'transparent',
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

        <TagEditor
          label="Allergens (strict exclusion)"
          placeholder="e.g. peanuts"
          values={profile.allergens}
          onChange={(allergens) => setProfile({ ...profile, allergens })}
        />

        <TagEditor
          label="Dislikes"
          placeholder="e.g. cauliflower"
          values={profile.dislikes}
          onChange={(dislikes) => setProfile({ ...profile, dislikes })}
        />

        <View style={{ gap: 10 }}>
          <Eyebrow>Other requirements</Eyebrow>
          <Field
            value={notes}
            onChangeText={setNotes}
            placeholder="Free text, used as-is when planning"
            multiline
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
        </View>

        <Button label="Save" onPress={() => void save()} loading={saving} />
        <Button label="Remove this person" kind="danger" onPress={remove} />
      </ScrollView>
    </SafeAreaView>
  );
}
