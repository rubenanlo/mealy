import { Pressable, ScrollView, Text } from 'react-native';

import { QUICK_FILTERS, QUICK_FILTER_LABELS, type QuickFilter } from '@/lib/quick-filters';
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
              {QUICK_FILTER_LABELS[filter]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
