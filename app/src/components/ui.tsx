import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { fontSize, minTapTarget, useTheme } from '@/lib/theme';

/** Kitchen-readable button: ≥48px tall, ≥17pt label (spec §13). */
export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const bg =
    kind === 'primary' ? colors.accent : kind === 'danger' ? colors.danger : colors.card;
  const fg = kind === 'secondary' ? colors.text : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          minHeight: minTapTarget,
          borderRadius: 12,
          paddingHorizontal: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: fontSize.base, fontWeight: '600' }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      {...props}
      style={[
        {
          minHeight: minTapTarget,
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: colors.card,
          color: colors.text,
          fontSize: fontSize.base,
        },
        props.style,
      ]}
    />
  );
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text style={[{ color: colors.text, fontSize: fontSize.title, fontWeight: '700' }, style]}>
      {children}
    </Text>
  );
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text style={[{ color: colors.text, fontSize: fontSize.base, lineHeight: 24 }, style]}>
      {children}
    </Text>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text style={[{ color: colors.textMuted, fontSize: fontSize.small, lineHeight: 21 }, style]}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ backgroundColor: colors.card, borderRadius: 14, padding: 16 }, style]}>
      {children}
    </View>
  );
}
