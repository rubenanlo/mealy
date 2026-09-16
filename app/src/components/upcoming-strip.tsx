import { Pressable, ScrollView, Text, View } from 'react-native';

import { RecipeImage } from '@/components/recipe-cards';
import { Eyebrow, Muted } from '@/components/ui';
import { fmt, useI18n } from '@/lib/i18n';
import type { MealCell } from '@/lib/meal-cells';
import type { MealSlot } from '@/lib/plan';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';

/** A meal cell in the strip, optionally tagged with the week it belongs to. */
export type UpcomingCell = MealCell & {
  /** Week the cell belongs to; lets tap handlers open the right week. */
  weekIso?: string;
  /** Eyebrow day text override (e.g. "Monday 21" for a future week). */
  dayLabel?: string;
};

/**
 * Horizontal strip of upcoming meal cells — the "This week" section shared
 * by the plan overview and the home feed. Runs continuously into future
 * planned weeks; the first cell is highlighted as the next meal.
 */
export function UpcomingMealsStrip({
  cells,
  todayIndex,
  onPressCell,
}: {
  cells: UpcomingCell[];
  todayIndex: number;
  onPressCell: (cell: UpcomingCell) => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -screenPadding }}
      contentContainerStyle={{ gap: 14, paddingHorizontal: screenPadding }}
    >
      {cells.map((cell, i) => (
        <Pressable
          key={`${cell.weekIso ?? ''}-${cell.day}-${cell.slot}`}
          accessibilityRole="button"
          accessibilityLabel={`${d.common.days[cell.day]} ${slotLabel(cell.slot)}: ${cell.titles.join(', ')}`}
          onPress={() => onPressCell(cell)}
          style={({ pressed }) => ({ width: 150, opacity: pressed ? 0.7 : 1 })}
        >
          {cell.covers.length > 1 ? (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignContent: 'space-between',
                width: 150,
                height: 110,
                borderRadius: radius.card,
                overflow: 'hidden',
              }}
            >
              {[0, 1, 2, 3].map((n) => (
                <RecipeImage
                  key={n}
                  path={cell.covers[n] ?? null}
                  style={{ width: '49%', height: '48.5%' }}
                  iconSize={16}
                />
              ))}
            </View>
          ) : (
            <RecipeImage
              path={cell.covers[0] ?? null}
              style={{ width: 150, height: 110, borderRadius: radius.card }}
            />
          )}
          <View style={{ paddingTop: 8, gap: 2 }}>
            <Eyebrow style={i === 0 ? { color: colors.saffron } : undefined}>
              {`${cell.dayLabel ?? (cell.day === todayIndex ? d.plan.today : d.common.days[cell.day])} · ${slotLabel(cell.slot)}`}
              {i === 0 ? ` · ${d.plan.next}` : ''}
            </Eyebrow>
            <Text
              numberOfLines={2}
              style={{
                color: colors.text,
                fontSize: fontSize.cardTitle,
                lineHeight: 21,
                fontFamily: fonts.displaySemi,
              }}
            >
              {cell.titles.join(' · ')}
            </Text>
            {/* Who eats, per dish in title order; hidden when every dish is for everyone. */}
            {cell.eaters.some((names) => names.length > 0) ? (
              <Muted numberOfLines={1}>
                {cell.eaters
                  .map((names) => (names.length > 0 ? names.join(', ') : d.plan.wholeHousehold))
                  .join(' · ')}
              </Muted>
            ) : null}
            {cell.recipeIds.length === 1 ? (
              <Muted>{fmt(d.plan.serves, { n: cell.servings[0] })}</Muted>
            ) : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
