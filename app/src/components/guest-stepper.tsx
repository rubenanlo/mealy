import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { fonts, fontSize, minTapTarget, radius, useTheme } from '@/lib/theme';

/**
 * Small −/＋ stepper for the number of non-family guests eating a meal. Guests
 * add to the meal's servings (migration 0017), which scales the recipe's
 * quantities in the planner, "what's next", and the shopping list.
 */
export function GuestStepper({
  value,
  onChange,
  max = 30,
}: {
  value: number;
  onChange: (next: number) => void;
  max?: number;
}) {
  const { colors } = useTheme();
  const clamp = (n: number) => Math.max(0, Math.min(max, n));

  const StepButton = ({ delta, icon, label }: { delta: number; icon: 'remove' | 'add'; label: string }) => {
    const disabled = clamp(value + delta) === value;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => onChange(clamp(value + delta))}
        hitSlop={6}
        style={({ pressed }) => ({
          width: minTapTarget,
          height: minTapTarget,
          borderRadius: radius.control,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name={icon} size={18} color={colors.text} />
      </Pressable>
    );
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <StepButton delta={-1} icon="remove" label="One fewer guest" />
      <Text
        accessibilityLabel={`${value} guests`}
        style={{
          minWidth: 24,
          textAlign: 'center',
          color: colors.text,
          fontSize: fontSize.base,
          fontFamily: fonts.uiMedium,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <StepButton delta={1} icon="add" label="One more guest" />
    </View>
  );
}
