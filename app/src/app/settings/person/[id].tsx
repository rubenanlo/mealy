import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { FODMAP_MODES, normalizeDietProfile, type DietProfile, type FodmapMode } from '@/lib/diet';
import { fmt, useI18n } from '@/lib/i18n';
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
  const { d } = useI18n();
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
            accessibilityLabel={fmt(d.person.removeValue, { value })}
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
        {values.length === 0 ? <Muted>{d.person.none}</Muted> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          style={{ flex: 1 }}
          onSubmitEditing={add}
        />
        <Button label={d.common.add} kind="secondary" onPress={add} />
      </View>
    </View>
  );
}

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { d } = useI18n();
  const router = useRouter();

  const [name, setName] = useState('');
  const [isEmployee, setIsEmployee] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<DietProfile | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Display labels only — the stored mode values never change.
  const fodmapLabels: Record<FodmapMode, string> = {
    off: d.person.fodmapOff,
    elimination: d.person.fodmapElimination,
    reintroduction: d.person.fodmapReintroduction,
    personalized: d.person.fodmapPersonalized,
  };

  useEffect(() => {
    if (!id) return;
    supabase
      .from('persons')
      .select('name, is_employee, diet_profile, other_requirements, share_token')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setName(data.name);
        setIsEmployee(data.is_employee);
        setShareToken(data.share_token ?? null);
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
    Alert.alert(d.person.removeTitle, fmt(d.person.removeBody, { name }), [
      { text: d.common.cancel, style: 'cancel' },
      {
        text: d.person.remove,
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
          <Muted>{d.common.loading}</Muted>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgGrouped }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 20, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.person.backToAccount}
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
          <Body style={{ fontFamily: fonts.uiSemi }}>{d.person.account}</Body>
        </Pressable>
        <Title>{name || d.person.personFallback}</Title>

        <View style={{ gap: 10 }}>
          <Eyebrow>{d.person.name}</Eyebrow>
          <Field value={name} onChangeText={setName} placeholder={d.person.name} />
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
            <Body>{d.person.householdEmployee}</Body>
            <Switch
              value={isEmployee}
              onValueChange={(value) => {
                // Persist immediately: the web-access link below only works
                // once the flag is saved, so don't wait for the Save button.
                setIsEmployee(value);
                void supabase.from('persons').update({ is_employee: value }).eq('id', id);
              }}
              trackColor={{ true: colors.accent }}
            />
          </View>
          <Hairline />
        </View>

        {isEmployee && shareToken ? (
          <View style={{ gap: 10 }}>
            <Eyebrow>{d.person.webAccess}</Eyebrow>
            <Muted>{d.person.webAccessHint}</Muted>
            <Button
              label={d.person.shareCookingLink}
              kind="secondary"
              onPress={() => {
                // Served from workers.dev: supabase.co refuses to render HTML
                // to unauthenticated browsers (anti-phishing rewrite).
                const url = `https://mealy-menu.mealy-rubenanlo.workers.dev/?token=${shareToken}`;
                void Share.share({ message: url, url });
              }}
            />
          </View>
        ) : null}

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
        <Button label={d.person.removePerson} kind="danger" onPress={remove} />
      </ScrollView>
    </SafeAreaView>
  );
}
