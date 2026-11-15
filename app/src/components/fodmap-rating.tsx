import { Pressable, Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { PERSONAL_RATINGS, type PersonalRating } from '@/lib/my-fodmap';
import { fonts, fontSize, minTapTarget, radius, useTheme, type Palette } from '@/lib/theme';

export function ratingColor(rating: PersonalRating, colors: Palette): string {
  if (rating === 'low') return colors.spineVeg;
  if (rating === 'moderate') return colors.saffron;
  return colors.danger;
}

/** Small colored dot + label ("● Low"). */
export function RatingBadge({ rating }: { rating: PersonalRating }) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const color = ratingColor(rating, colors);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color, fontFamily: fonts.uiSemi, fontSize: fontSize.meta }}>{d.myFodmap[rating]}</Text>
    </View>
  );
}

/** Three-way segmented picker: Low / Moderate / High. */
export function RatingPicker({
  value,
  onChange,
}: {
  value: PersonalRating | null;
  onChange: (rating: PersonalRating) => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {PERSONAL_RATINGS.map((rating) => {
        const selected = value === rating;
        const color = ratingColor(rating, colors);
        return (
          <Pressable
            key={rating}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={d.myFodmap[rating]}
            onPress={() => onChange(rating)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: minTapTarget,
              borderRadius: radius.control,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: selected ? 0 : 1,
              borderColor: colors.border,
              backgroundColor: selected ? color : pressed ? colors.cardPressed : 'transparent',
            })}
          >
            <Text
              style={{
                color: selected ? '#FFFFFF' : colors.text,
                fontFamily: fonts.uiSemi,
                fontSize: fontSize.base,
              }}
            >
              {d.myFodmap[rating]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
