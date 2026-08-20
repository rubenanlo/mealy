import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type AccessibilityRole,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edges } from 'react-native-safe-area-context';

import {
  ENTRANCE_DURATION_MS,
  ENTRANCE_RISE_PX,
  entranceDelay,
  useReducedMotion,
} from '@/lib/motion';
import {
  controlHeight,
  fonts,
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  useTheme,
} from '@/lib/theme';

/** SafeArea + bg + optional scroll (design.md §Layout). */
export function Screen({
  children,
  scroll = false,
  edges = ['top'],
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edges;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[
            { paddingHorizontal: screenPadding, paddingBottom: 48, gap: 16 },
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** Screen title — Fraunces 600, 28pt. Reserved for titles only (design.md §Type). */
export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[{ color: colors.text, fontSize: fontSize.title, fontFamily: fonts.display }, style]}
    >
      {children}
    </Text>
  );
}

/** Section label — 13/uppercase/muted, +0.8 letter-spacing. */
export function Eyebrow({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        {
          color: colors.textMuted,
          fontSize: fontSize.eyebrow,
          fontWeight: '600',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        },
        style,
      ]}
    >
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

/** 4px rounded left spine — the signature category marker (design.md). */
function Spine({ color }: { color: string }) {
  if (color === 'transparent') return null;
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: 10,
        bottom: 10,
        width: 4,
        borderTopRightRadius: 2,
        borderBottomRightRadius: 2,
        backgroundColor: color,
      }}
    />
  );
}

/** Card surface: radius 14, 1px border, no heavy shadows. `spine` = category color. */
export function Card({
  children,
  style,
  spine,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  spine?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 16,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {spine ? <Spine color={spine} /> : null}
      {children}
    </View>
  );
}

/** Pressable Card: scale 0.98 + cardPressed bg on press (design.md §Motion). */
export function PressCard({
  children,
  onPress,
  onLongPress,
  style,
  spine,
  accessibilityLabel,
  accessibilityRole = 'button',
  disabled = false,
}: {
  children: ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  spine?: string;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: pressed ? colors.cardPressed : colors.card,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 16,
          overflow: 'hidden',
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {spine ? <Spine color={spine} /> : null}
      {children}
    </Pressable>
  );
}

/**
 * Button (design.md §Layout): primary accent/accentText; secondary
 * transparent + 1px border; danger = destructive text, no fill.
 */
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
  const fg =
    kind === 'primary' ? colors.accentText : kind === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          minHeight: controlHeight,
          borderRadius: radius.control,
          paddingHorizontal: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            kind === 'primary'
              ? colors.accent
              : pressed && kind === 'secondary'
                ? colors.cardPressed
                : 'transparent',
          borderWidth: kind === 'secondary' ? 1 : 0,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : pressed && kind !== 'secondary' ? 0.8 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
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

/** Field: card bg, 1px border, radius 12, height 52, focus border accent (2px). */
export function Field(props: TextInputProps & { style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      style={[
        {
          minHeight: controlHeight,
          borderRadius: radius.control,
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? colors.accent : colors.border,
          paddingHorizontal: focused ? 15 : 16,
          paddingVertical: focused ? 11 : 12,
          backgroundColor: colors.card,
          color: colors.text,
          fontSize: fontSize.base,
        },
        props.style,
      ]}
    />
  );
}

/** Small pill, border only, 13pt (design.md §Layout). */
export function Tag({ label, color, style }: { label: string; color?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: color ?? colors.border,
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 4,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Text style={{ color: color ?? colors.textMuted, fontSize: fontSize.eyebrow, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

/** Centered Fraunces-italic line + one primary action. Direct, never apologetic. */
export function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 20, paddingVertical: 40, paddingHorizontal: 24 }}>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.medium,
          fontFamily: fonts.displayItalic,
          textAlign: 'center',
          lineHeight: 28,
        }}
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={{ alignSelf: 'stretch' }} />
      ) : null}
    </View>
  );
}

/**
 * The one deliberate motion: fade + rise 12px on first mount, staggered by
 * `index`. Skipped entirely under reduce-motion (design.md §Motion).
 */
export function FadeRise({
  children,
  index = 0,
  style,
}: {
  children: ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (reduced) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: ENTRANCE_DURATION_MS,
      delay: entranceDelay(index),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [index, progress, reduced]);

  // If the preference resolves to "reduced" after mount, jump to the end state.
  useEffect(() => {
    if (reduced) progress.setValue(1);
  }, [reduced, progress]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [ENTRANCE_RISE_PX, 0],
              }),
            },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
