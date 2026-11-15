import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

import { fmt, useI18n } from '@/lib/i18n';
import { dayDate } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';

export interface WeekSummary {
  meals: number;
  ideas: number;
}

/**
 * Meal + idea counts for the given weeks, for the chips' second line.
 * `refreshKey` reloads after a change made from the sheet itself.
 */
export function useWeekSummaries(
  householdId: string,
  weeks: string[],
  enabled: boolean,
  refreshKey = 0
): Map<string, WeekSummary> {
  const [summaries, setSummaries] = useState<Map<string, WeekSummary>>(new Map());
  const key = weeks.join(',');
  useEffect(() => {
    if (!enabled || weeks.length === 0) return;
    let cancelled = false;
    void Promise.all([
      supabase
        .from('meal_plans')
        .select('week_start, plan_entries(count)')
        .eq('household_id', householdId)
        .in('week_start', weeks),
      supabase
        .from('plan_ideas')
        .select('week_start')
        .eq('household_id', householdId)
        .in('week_start', weeks),
    ]).then(([plans, ideas]) => {
      if (cancelled) return;
      const next = new Map<string, WeekSummary>();
      for (const row of (plans.data ?? []) as {
        week_start: string;
        plan_entries: { count: number }[] | null;
      }[]) {
        next.set(row.week_start, { meals: row.plan_entries?.[0]?.count ?? 0, ideas: 0 });
      }
      for (const row of (ideas.data ?? []) as { week_start: string }[]) {
        const s = next.get(row.week_start) ?? { meals: 0, ideas: 0 };
        next.set(row.week_start, { ...s, ideas: s.ideas + 1 });
      }
      setSummaries(next);
    });
    return () => {
      cancelled = true;
    };
    // `key` stands in for the weeks array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, key, enabled, refreshKey]);
  return summaries;
}

/**
 * Horizontal row of week chips: "This week", "Next week", then dates. The
 * second line shows what the week already holds (meals, else ideas), else
 * its date range (first two) or "Empty".
 */
export function WeekChips({
  weeks,
  selected,
  onSelect,
  summaries,
}: {
  weeks: string[];
  selected: string;
  onSelect: (week: string) => void;
  summaries: Map<string, WeekSummary>;
}) {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const short = (date: Date) => date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -screenPadding }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: screenPadding }}
    >
      {weeks.map((week, i) => {
        const isSelected = week === selected;
        const label = i === 0 ? d.components.thisWeek : i === 1 ? d.components.nextWeek : short(dayDate(week, 0));
        const summary = summaries.get(week);
        const sub =
          summary && summary.meals > 0
            ? summary.meals === 1
              ? d.components.mealOne
              : fmt(d.components.mealMany, { count: summary.meals })
            : summary && summary.ideas > 0
              ? summary.ideas === 1
                ? d.components.ideaOne
                : fmt(d.components.ideaMany, { count: summary.ideas })
              : i < 2
                ? `${short(dayDate(week, 0))} – ${short(dayDate(week, 6))}`
                : d.components.weekEmpty;
        return (
          <Pressable
            key={week}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={fmt(d.components.weekChipA11y, { label, sub })}
            onPress={() => onSelect(week)}
            style={({ pressed }) => ({
              minWidth: 92,
              minHeight: 52,
              paddingHorizontal: 12,
              borderRadius: radius.control,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              backgroundColor: isSelected ? colors.text : pressed ? colors.cardPressed : 'transparent',
              borderWidth: isSelected ? 0 : 1,
              borderColor: colors.border,
            })}
          >
            <Text
              style={{
                color: isSelected ? colors.bg : colors.text,
                fontSize: fontSize.meta,
                fontFamily: fonts.uiSemi,
              }}
            >
              {label}
            </Text>
            <Text
              style={{
                color: isSelected ? colors.bg : colors.textMuted,
                opacity: isSelected ? 0.8 : 1,
                fontSize: fontSize.eyebrow,
                fontFamily: fonts.ui,
              }}
            >
              {sub}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
