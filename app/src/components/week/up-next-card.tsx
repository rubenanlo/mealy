import { Pressable, Text, View } from 'react-native';

import { RecipeImage } from '@/components/recipe-cards';
import type { UpcomingCell } from '@/components/upcoming-strip';
import { Button, Eyebrow, Muted } from '@/components/ui';
import { Badge } from '@/components/week/sheet';
import { fmt, useI18n } from '@/lib/i18n';
import { dayDate, weekStart } from '@/lib/plan';
import { fonts, fontSize, radius, useTheme } from '@/lib/theme';

/**
 * The next meal, large: cover, when, the dish and its sides, who eats, and
 * an Open recipe button. Tapping the card itself opens its week.
 */
export function UpNextCard({
  cell,
  when,
  onOpenRecipe,
  onPress,
}: {
  cell: UpcomingCell;
  /** "Today · Dinner" */
  when: string;
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
        <View style={{ position: 'absolute', left: 12, top: 12 }}>
          <Badge label={t.upNext} accent />
        </View>
      </View>
      <View style={{ padding: 14, gap: 6 }}>
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
            style={{ marginTop: 6 }}
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
          : (cell.dayLabel ?? date.toLocaleDateString(locale, { weekday: 'long' }));
    const slot = cell.slot === 'lunch' ? d.common.lunch : d.common.dinner;
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${slot}`;
  };
}
