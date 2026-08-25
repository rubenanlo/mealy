import { Pressable, ScrollView, Text } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { QUICK_FILTERS, type QuickFilter } from '@/lib/quick-filters';
import { fonts, fontSize, screenPadding, useTheme } from '@/lib/theme';

/** Horizontal stackable filter chips for the Home feed (spec Part 2). */
export function QuickFilters({
  active,
  onToggle,
}: {
  active: ReadonlySet<QuickFilter>;
  onToggle: (filter: QuickFilter) => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const labels: Record<QuickFilter, string> = {
    under30: d.components.filterUnder30,
    fodmapFriendly: d.components.filterFodmap,
    meat: d.components.catMeat,
    fish: d.components.catFish,
    vegetarian: d.components.catVegetarian,
    needsReview: d.components.filterNeedsReview,
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: screenPadding }}
      style={{ marginHorizontal: -screenPadding }}
    >
      {QUICK_FILTERS.map((filter) => {
        const selected = active.has(filter);
        return (
          <Pressable
            key={filter}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onToggle(filter)}
            style={({ pressed }) => ({
              minHeight: 36,
              justifyContent: 'center',
              borderRadius: 999,
              paddingHorizontal: 14,
              borderWidth: selected ? 0 : 1,
              borderColor: colors.border,
              backgroundColor: selected ? colors.accent : pressed ? colors.cardPressed : 'transparent',
            })}
          >
            <Text
              style={{
                color: selected ? colors.accentText : colors.text,
                fontSize: fontSize.meta,
                fontFamily: fonts.uiMedium,
              }}
            >
              {labels[filter]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
