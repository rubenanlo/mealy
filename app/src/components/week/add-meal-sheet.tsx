import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { RecipeImage } from '@/components/recipe-cards';
import { Eyebrow, Field, Muted } from '@/components/ui';
import { Pill, WeekSheet } from '@/components/week/sheet';
import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, radius, useTheme } from '@/lib/theme';
import type { AddSuggestions } from '@/lib/week-page';

export interface AddRecipe {
  id: string;
  title: string;
  cover_image_path: string | null;
  category: string | null;
  isSalad: boolean;
  weeksSince: number | null;
  totalMinutes: number | null;
}

export interface CustomIdea {
  id: string;
  title: string;
}

export type AddPick = { recipeId: string; ideaId?: string } | { customTitle: string; ideaId?: string };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * One-tap add (design A): the week's ideas and dishes that fill what the week
 * is missing come first; tapping a row adds it straight away with the usual
 * defaults. Typing searches the library or adds a free-text meal.
 */
export function AddMealSheet({
  visible,
  title,
  subtitle,
  recipes,
  suggestions,
  customIdeas,
  ideaIdByRecipe,
  gapsLabel,
  leftovers = false,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  recipes: AddRecipe[];
  suggestions: AddSuggestions;
  /** Free-text ideas parked for this week. */
  customIdeas: CustomIdea[];
  /** Idea id for recipe ideas, so planning one clears the idea. */
  ideaIdByRecipe: ReadonlyMap<string, string>;
  /** Overrides the "Fills the gaps" heading (side mode). */
  gapsLabel?: string;
  /** Offer a one-tap "Leftovers" meal as the first row. */
  leftovers?: boolean;
  onPick: (pick: AddPick) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.weekPage;
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const categoryName = (r: AddRecipe) =>
    r.isSalad
      ? t.salad
      : r.category === 'fish'
        ? d.plan.categoryFish
        : r.category === 'meat'
          ? d.plan.categoryMeat
          : r.category === 'vegetarian'
            ? d.plan.categoryVeg
            : r.category === 'legume'
              ? d.plan.categoryLegume
              : null;

  const q = fold(query.trim());
  const results = useMemo(
    () => (q ? recipes.filter((r) => fold(r.title).includes(q)).slice(0, 40) : []),
    [recipes, q]
  );

  const row = (r: AddRecipe, extra?: string) => {
    const meta = [
      categoryName(r),
      r.totalMinutes ? fmt(t.minutes, { n: r.totalMinutes }) : null,
      extra ??
        (r.weeksSince === null ? null : r.weeksSince >= 1 ? fmt(t.weeksAgo, { n: r.weeksSince }) : null),
    ].filter(Boolean);
    return (
      <Pressable
        key={r.id}
        accessibilityRole="button"
        accessibilityLabel={fmt(t.addA11y, { title: r.title })}
        onPress={() => onPick({ recipeId: r.id, ideaId: ideaIdByRecipe.get(r.id) })}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 56,
          borderRadius: radius.card,
          backgroundColor: pressed ? colors.cardPressed : 'transparent',
        })}
      >
        <RecipeImage path={r.cover_image_path} style={{ width: 48, height: 48, borderRadius: radius.thumb }} iconSize={18} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.base }}>
            {r.title}
          </Text>
          {meta.length > 0 ? <Muted numberOfLines={1}>{meta.join(' · ')}</Muted> : null}
        </View>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={22} color={colors.accent} />
        </View>
      </Pressable>
    );
  };

  const section = (label: string, ids: string[], extra?: (r: AddRecipe) => string | undefined) => {
    const rows = ids.map((id) => byId.get(id)).filter((r): r is AddRecipe => !!r);
    if (rows.length === 0) return null;
    return (
      <View style={{ gap: 4 }}>
        <Eyebrow>{label}</Eyebrow>
        {rows.map((r) => row(r, extra?.(r)))}
      </View>
    );
  };

  const typed = query.trim();
  return (
    <WeekSheet visible={visible} onClose={onClose} title={title} subtitle={subtitle} tall>
      <Field
        icon="search-outline"
        value={query}
        onChangeText={setQuery}
        placeholder={t.searchPlaceholder}
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={() => {
          if (typed) onPick({ customTitle: typed });
        }}
      />
      {typed ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => onPick({ customTitle: typed })}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              minHeight: 48,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="create-outline" size={20} color={colors.accent} />
            <Text style={{ flex: 1, color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
              {fmt(t.addTyped, { title: typed })}
            </Text>
          </Pressable>
          {results.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Eyebrow>{t.resultsSection}</Eyebrow>
              {results.map((r) => row(r))}
            </View>
          ) : (
            <Muted>{t.noMatches}</Muted>
          )}
        </>
      ) : (
        <>
          {leftovers ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fmt(t.addA11y, { title: t.leftovers })}
              onPress={() => onPick({ customTitle: t.leftovers })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 56,
                borderRadius: radius.card,
                backgroundColor: pressed ? colors.cardPressed : 'transparent',
              })}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.thumb,
                  backgroundColor: colors.bgGrouped,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="refresh-outline" size={20} color={colors.textMuted} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.base }}>{t.leftovers}</Text>
                <Muted numberOfLines={1}>{t.leftoversHint}</Muted>
              </View>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={22} color={colors.accent} />
              </View>
            </Pressable>
          ) : null}
          {suggestions.ideas.length > 0 || customIdeas.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Eyebrow>{t.ideasSection}</Eyebrow>
              {suggestions.ideas
                .map((id) => byId.get(id))
                .filter((r): r is AddRecipe => !!r)
                .map((r) => row(r, t.yourIdea))}
              {customIdeas.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                  {customIdeas.map((idea) => (
                    <Pill
                      key={idea.id}
                      label={idea.title}
                      onPress={() => onPick({ customTitle: idea.title, ideaId: idea.id })}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          {section(gapsLabel ?? t.gapsSection, suggestions.gaps, (r) =>
            r.weeksSince === null ? t.neverHad : undefined
          )}
          {suggestions.recent.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Eyebrow>{t.recentSection}</Eyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {suggestions.recent
                  .map((id) => byId.get(id))
                  .filter((r): r is AddRecipe => !!r)
                  .map((r) => (
                    <Pill key={r.id} label={r.title} onPress={() => onPick({ recipeId: r.id })} />
                  ))}
              </View>
            </View>
          ) : null}
        </>
      )}
    </WeekSheet>
  );
}
