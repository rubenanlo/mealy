import { Pressable, Text, View } from 'react-native';

import { fonts, minTapTarget, useTheme } from '@/lib/theme';

export interface PersonLike {
  id: string;
  name: string;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/**
 * Monochrome initials chip (v2): filled = text color, deselected = gray fill,
 * hollow = dashed outline for uncovered people.
 */
export function PersonChip({
  person,
  hollow,
  selected,
  onPress,
}: {
  person: PersonLike;
  hollow?: boolean;
  selected?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const chip = (
    <View
      style={{
        minWidth: 32,
        height: 32,
        borderRadius: 16,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hollow ? 'transparent' : selected === false ? colors.cardPressed : colors.text,
        borderWidth: hollow ? 1 : 0,
        borderColor: colors.textMuted,
      }}
    >
      <Text
        style={{
          color: hollow ? colors.textMuted : selected === false ? colors.text : colors.bg,
          fontSize: 13,
          fontFamily: fonts.uiSemi,
        }}
      >
        {initials(person.name)}
      </Text>
    </View>
  );
  if (!onPress) return chip;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={person.name}
      accessibilityState={{ selected: selected !== false }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: minTapTarget,
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {chip}
    </Pressable>
  );
}
