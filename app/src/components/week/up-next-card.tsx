import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RecipeImage } from '@/components/recipe-cards';
import type { UpcomingCell } from '@/components/upcoming-strip';
import { Button, Eyebrow, Muted } from '@/components/ui';
import { Badge } from '@/components/week/sheet';
import { fmt, useI18n } from '@/lib/i18n';
import { dayDate, weekStart } from '@/lib/plan';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';

/**
 * The next meal, large: cover, when, the dish and its sides, who eats, and
 * an Open recipe button. Tapping the card itself opens its week.
 */
export function UpNextCard({
  cell,
  when,
  first = true,
  onOpenRecipe,
  onPress,
}: {
  cell: UpcomingCell;
  /** "Today · Dinner" */
  when: string;
  /** Shows the "Up next" badge (only the first card of the carousel). */
  first?: boolean;
  onOpenRecipe: (recipeId: string, servings: number) => void;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.planHome;
  const [main, ...sides] = cell.titles;
  const mainRecipe = cell.dishRecipeIds[0] ?? null;
  const mainServings = cell.dishServings[0] ?? null;
  const eaters = cell.eaters[0] ?? [];
  const meta = [
    eaters.length > 0 ? eaters.join(', ') : null,
    mainServings ? fmt(d.plan.serves, { n: mainServings }) : null,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.upNext}: ${when}, ${cell.titles.join(', ')}`}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: radius.card * 2,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        backgroundColor: pressed ? colors.cardPressed : colors.bg,
      })}
    >
      <View>
        <RecipeImage path={cell.covers[0] ?? null} style={{ width: '100%', height: 150 }} iconSize={28} />
        {first ? (
          <View style={{ position: 'absolute', left: 12, top: 12 }}>
            <Badge label={t.upNext} accent />
          </View>
        ) : null}
      </View>
      <View style={{ padding: 14, gap: 6, flex: 1 }}>
        <Eyebrow>{when}</Eyebrow>
        <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: fontSize.cardTitle + 3, lineHeight: 26 }}>
          {main}
          {sides.length > 0 ? (
            <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.base }}>
              {`  + ${sides.join(', ')}`}
            </Text>
          ) : null}
        </Text>
        {meta.length > 0 ? <Muted>{meta.join(' · ')}</Muted> : null}
        {mainRecipe ? (
          <Button
            label={t.openRecipe}
            kind="secondary"
            onPress={() => onOpenRecipe(mainRecipe, mainServings ?? 1)}
            style={{ marginTop: 'auto' }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/** "Today · Dinner", "Tomorrow · Lunch", "Thursday · Dinner" or "Monday 23 · Lunch". */
export function useMealWhen(): (cell: UpcomingCell) => string {
  const { d, locale } = useI18n();
  return (cell) => {
    const week = cell.weekIso ?? weekStart(new Date());
    const date = dayDate(week, cell.day);
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const day =
      date.toDateString() === today.toDateString()
        ? d.plan.today
        : date.toDateString() === tomorrow.toDateString()
          ? d.planHome.tomorrow
          : week === weekStart(today)
            ? date.toLocaleDateString(locale, { weekday: 'long' })
            : `${date.toLocaleDateString(locale, { weekday: 'long' })} ${date.getDate()}`;
    const slot = cell.slot === 'lunch' ? d.common.lunch : d.common.dinner;
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${slot}`;
  };
}

/**
 * Up next as a swipeable row of big cards: the next meal first, then every
 * following meal this week and in later planned weeks. The next card peeks
 * in from the right so it is clear the row scrolls. A last card invites
 * planning more.
 */
export function UpNextCarousel({
  cells,
  onOpenRecipe,
  onPressCell,
  onPlanMore,
}: {
  cells: UpcomingCell[];
  onOpenRecipe: (recipeId: string, servings: number) => void;
  onPressCell: (cell: UpcomingCell) => void;
  onPlanMore: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.planHome;
  const mealWhen = useMealWhen();
  const [width, setWidth] = useState(0);
  const gap = 12;
  const cardWidth = Math.max(0, width - 2 * screenPadding - 28);
  const total = cells.length + 1;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width + 2 * screenPadding)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + gap}
        snapToAlignment="start"
        style={{ marginHorizontal: -screenPadding }}
        contentContainerStyle={{ gap, paddingHorizontal: screenPadding }}
      >
        {cells.map((cell, i) => (
          <View key={`${cell.weekIso ?? ''}-${cell.day}-${cell.slot}`} style={{ width: cardWidth || undefined }}>
            <UpNextCard
              cell={cell}
              when={mealWhen(cell)}
              first={i === 0}
              onOpenRecipe={onOpenRecipe}
              onPress={() => onPressCell(cell)}
            />
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={onPlanMore}
          style={({ pressed }) => ({
            width: cardWidth || undefined,
            borderRadius: radius.card * 2,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            gap: 6,
            minHeight: 200,
            backgroundColor: pressed ? colors.cardPressed : 'transparent',
          })}
        >
          <Muted>{cells.length > 0 ? t.thatsAll : t.nothingNext}</Muted>
          <Text style={{ color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>
            {t.planMore}
          </Text>
        </Pressable>
      </ScrollView>
      {total > 2 ? <Muted style={{ marginTop: 8 }}>{cells.length === 2 ? t.swipeHintOne : fmt(t.swipeHint, { n: cells.length - 1 })}</Muted> : null}
    </View>
  );
}
