import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QuotaRow, TagEditor } from '@/components/preference-controls';
import { Body, Button, Eyebrow, Field, Muted, SettingsGroup, Title } from '@/components/ui';
import {
  FODMAP_MODES,
  normalizeDietProfile,
  QUOTA_CATEGORIES,
  type DietProfile,
  type FodmapMode,
} from '@/lib/diet';
import { useI18n } from '@/lib/i18n';
import { backOr } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';

/**
 * Per-person meal preferences: protein quotas, FODMAP mode, allergens,
 * dislikes, and personal requirements. Identity/access stays on the person's
 * account page (settings/person/[id]); this page is all food logic, reached
 * from Meal preferences → Person preferences.
 */
export default function PersonPreferencesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { d } = useI18n();
  const router = useRouter();

  const [name, setName] = useState('');
  const [isEmployee, setIsEmployee] = useState(false);
  const [profile, setProfile] = useState<DietProfile | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Display labels only — the stored mode/category values never change.
  const fodmapLabels: Record<FodmapMode, string> = {
    off: d.person.fodmapOff,
    elimination: d.person.fodmapElimination,
    reintroduction: d.person.fodmapReintroduction,
    personalized: d.person.fodmapPersonalized,
  };
  const categoryLabels: Record<string, string> = {
    fish: d.mealPrefs.categoryFish,
    meat: d.mealPrefs.categoryMeat,
    vegetarian: d.mealPrefs.categoryVegetarian,
  };

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
      });
  }, [id]);

  const setQuota = (category: string, field: 'min' | 'max', next: number | null) => {
    if (!profile) return;
    const targets = profile.proteinQuotas.targets.map((t) =>
      t.category === category ? { ...t, [field]: next } : t
    );
    setProfile({ ...profile, proteinQuotas: { period: 'week', targets } });
  };

  const save = async () => {
    if (!id || !profile) return;
    setSaving(true);
    await supabase
      .from('persons')
      .update({
        diet_profile: profile,
        // Stored verbatim (spec §2); structured proposals are Phase 3.
        other_requirements: notes,
      })
      .eq('id', id);
    setSaving(false);
    backOr('/settings/meal-preferences');
  };

  if (!profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }}>
        <View style={{ padding: screenPadding }}>
          <Muted>{d.common.loading}</Muted>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: 20, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.mealPrefs.title}
          onPress={() => backOr('/settings/meal-preferences')}
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
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.mealPrefs.title}</Body>
        </Pressable>
        <Title>{name}</Title>

        {/* Employees cook rather than eat: no weekly protein quotas for them. */}
        {isEmployee ? null : (
          <View style={{ gap: 10 }}>
            <Eyebrow>{d.mealPrefs.quotas}</Eyebrow>
            <Muted>{d.mealPrefs.quotasHint}</Muted>
            <SettingsGroup>
              {QUOTA_CATEGORIES.map(({ category, label }) => {
                const target = profile.proteinQuotas.targets.find(
                  (t) => t.category === category
                )!;
                const displayLabel = categoryLabels[category] ?? label;
                return (
                  <QuotaRow
                    key={category}
                    label={displayLabel}
                    min={target.min}
                    max={target.max}
                    onMin={(v) => setQuota(category, 'min', v)}
                    onMax={(v) => setQuota(category, 'max', v)}
                  />
                );
              })}
            </SettingsGroup>
          </View>
        )}

        <View style={{ gap: 10 }}>
          <Eyebrow>{d.person.fodmap}</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {FODMAP_MODES.map(({ mode }) => {
              const selected = profile.fodmap.mode === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setProfile({ ...profile, fodmap: { ...profile.fodmap, mode } })}
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
                    {fodmapLabels[mode]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TagEditor
          label={d.person.allergens}
          placeholder={d.person.allergensPlaceholder}
          values={profile.allergens}
          onChange={(allergens) => setProfile({ ...profile, allergens })}
        />

        <TagEditor
          label={d.person.dislikes}
          placeholder={d.person.dislikesPlaceholder}
          values={profile.dislikes}
          onChange={(dislikes) => setProfile({ ...profile, dislikes })}
        />

        <View style={{ gap: 10 }}>
          <Eyebrow>{d.person.otherRequirements}</Eyebrow>
          <Field
            value={notes}
            onChangeText={setNotes}
            placeholder={d.person.otherRequirementsPlaceholder}
            multiline
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
        </View>

        <Button label={d.common.save} onPress={() => void save()} loading={saving} />
      </ScrollView>
    </SafeAreaView>
  );
}
