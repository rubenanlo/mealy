import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Muted, Title } from '@/components/ui';
import { WeekChips, useWeekSummaries } from '@/components/week-chips';
import { useHousehold } from '@/lib/auth';
import { invalidateLists } from '@/lib/list-refresh';
import { fmt, useI18n } from '@/lib/i18n';
import { dayDate, weekStart } from '@/lib/plan';
import { ideaPayload, weekChoices } from '@/lib/plan-ideas';
import { titleMatches } from '@/lib/search-text';
import { supabase } from '@/lib/supabase';
import { localizedTitle } from '@/lib/translations';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

interface RecipeOption {
  id: string;
  /** Title in the active locale. */
  title: string;
  /** Original + every translated title, for cross-language search. */
  titles: string[];
}

type Choice = { kind: 'recipe'; id: string; title: string } | { kind: 'custom'; title: string };

const MAX_RESULTS = 6;

/**
 * "Save an idea": park a library recipe or a typed meal for a later week,
 * without a day (migration 0037). Opened from the week screen and the
 * Meal plans overview.
 */
export function IdeaSheet({
  visible,
  initialWeek,
  onClose,
  onSaved,
}: {
  visible: boolean;
  initialWeek?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const { householdId } = useHousehold();
  const weeks = useMemo(() => weekChoices(), []);

  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [search, setSearch] = useState('');
  const [choice, setChoice] = useState<Choice | null>(null);
  const [weekIso, setWeekIso] = useState(weeks[1]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summaries = useWeekSummaries(householdId, weeks, visible);

  useEffect(() => {
    if (!visible) return;
    setSearch('');
    setChoice(null);
    setNote('');
    setError(null);
    setWeekIso(initialWeek && initialWeek >= weekStart(new Date()) ? initialWeek : weeks[1]);
    let cancelled = false;
    supabase
      .from('recipes')
      .select('id, title, recipe_translations(locale, title)')
      .eq('household_id', householdId)
      .order('title')
      .then(({ data }) => {
        if (cancelled || !data) return;
        setRecipes(
          (data as {
            id: string;
            title: string;
            recipe_translations: { locale: string; title: string }[] | null;
          }[]).map((r) => ({
            id: r.id,
            title: localizedTitle(r, locale),
            titles: [r.title, ...(r.recipe_translations ?? []).map((t) => t.title)],
          }))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [visible, householdId, initialWeek, locale, weeks]);

  const query = search.trim();
  const results = query
    ? recipes.filter((r) => titleMatches(r.titles, query)).slice(0, MAX_RESULTS)
    : [];

  const save = async () => {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const { error: insertErr } = await supabase.from('plan_ideas').insert(
        ideaPayload({
          householdId,
          weekStart: weekIso,
          ...(choice.kind === 'recipe' ? { recipeId: choice.id } : { customTitle: choice.title }),
          note,
        })
      );
      if (insertErr) throw new Error(insertErr.message);
      invalidateLists('plan');
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : d.components.saveIdeaError);
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, selected: boolean, onPress: () => void, muted = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: minTapTarget,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <Text
        style={{
          flex: 1,
          color: muted ? colors.textMuted : colors.text,
          fontSize: fontSize.small,
          fontFamily: selected ? fonts.uiSemi : fonts.ui,
        }}
      >
        {label}
      </Text>
      {selected ? (
        <Ionicons name="checkmark" size={20} color={colors.accent} accessibilityLabel={d.components.pickedA11y} />
      ) : null}
    </Pressable>
  );

  const weekDateLong = dayDate(weekIso, 0).toLocaleDateString(locale, { month: 'long', day: 'numeric' });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ padding: screenPadding, gap: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 4 }}>
            <Title>{d.components.saveIdeaTitle}</Title>
            <Muted>{d.components.saveIdeaSub}</Muted>
          </View>

          <View style={{ gap: 8 }}>
            <Eyebrow>{d.components.ideaWhat}</Eyebrow>
            <Field
              icon="search"
              value={search}
              onChangeText={(text) => {
                setSearch(text);
                if (choice?.kind === 'custom') setChoice(null);
              }}
              placeholder={d.components.searchOrType}
              accessibilityLabel={d.components.searchOrType}
              autoCorrect={false}
            />
            {choice && !query ? row(choice.title, true, () => setChoice(null)) : null}
            {results.map((r) =>
              row(r.title, choice?.kind === 'recipe' && choice.id === r.id, () =>
                setChoice({ kind: 'recipe', id: r.id, title: r.title })
              )
            )}
            {query
              ? row(
                  fmt(d.components.useAsCustom, { title: query }),
                  choice?.kind === 'custom',
                  () => setChoice({ kind: 'custom', title: query }),
                  choice?.kind !== 'custom'
                )
              : null}
          </View>

          <View style={{ gap: 8 }}>
            <Eyebrow>{d.components.forWhichWeek}</Eyebrow>
            <WeekChips weeks={weeks} selected={weekIso} onSelect={setWeekIso} summaries={summaries} />
          </View>

          <View style={{ gap: 8 }}>
            <Eyebrow>{d.components.ideaNote}</Eyebrow>
            <Field
              value={note}
              onChangeText={setNote}
              placeholder={d.components.ideaNotePlaceholder}
              accessibilityLabel={d.components.ideaNote}
            />
          </View>

          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          <Button
            label={fmt(d.components.saveIdeaCta, { date: weekDateLong })}
            onPress={() => void save()}
            loading={busy}
            disabled={!choice}
          />
          <Button label={d.common.cancel} kind="secondary" onPress={onClose} disabled={busy} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
