import { Ionicons } from '@expo/vector-icons';
import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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

import { spineColor, type ProteinCategory } from '@/lib/category';
import { useI18n } from '@/lib/i18n';
import { BOOKMARK_FILL_MS, useReducedMotion } from '@/lib/motion';
import {
  controlHeight,
  fonts,
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  useTheme,
} from '@/lib/theme';

/** SafeArea + bg + optional scroll (design.md §Chrome). */
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

/** Screen/section title — Bitter 700, 24, tight leading (design.md §Type). */
export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[
        {
          color: colors.text,
          fontSize: fontSize.sectionHead,
          lineHeight: Math.round(fontSize.sectionHead * 1.15),
          letterSpacing: -0.3,
          fontFamily: fonts.display,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Section headline row: Bitter 24 left + optional red "See all" link right. */
export function SectionHeader({
  title,
  linkLabel,
  onLinkPress,
  style,
}: {
  title: string;
  linkLabel?: string;
  onLinkPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
        style,
      ]}
    >
      <Title>{title}</Title>
      {linkLabel && onLinkPress ? (
        <Pressable
          accessibilityRole="button"
          onPress={onLinkPress}
          style={({ pressed }) => ({
            minHeight: 32,
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: colors.accent, fontSize: fontSize.small, fontFamily: fonts.uiSemi }}>
            {linkLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Section label — 12/uppercase/muted, +1.2 tracking, Franklin 600. */
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
          fontFamily: fonts.uiSemi,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const { colors } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { color: colors.text, fontSize: fontSize.base, lineHeight: 24, fontFamily: fonts.ui },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Meta line — Franklin 500, 13, muted (design.md §Type). */
export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        { color: colors.textMuted, fontSize: fontSize.meta, lineHeight: 19, fontFamily: fonts.uiMedium },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Centered first-load spinner — screens show this instead of a fake-empty state. */
export function Loading({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
        style,
      ]}
    >
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

/** Hairline divider — the NYT texture between list sections. */
export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }, style]} />
  );
}

/** 8px category dot — the only surviving category color on cards. */
export function CategoryDot({
  category,
  size = 8,
  style,
}: {
  category: ProteinCategory;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: spineColor(category, colors),
        },
        style,
      ]}
    />
  );
}

/** Card surface: radius 8, no border, no shadow — whitespace defines it. */
export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, overflow: 'hidden' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Grouped-settings card (NYT settings style): rounded surface on the
 * bgGrouped page background, children separated by inset hairlines.
 */
export function SettingsGroup({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View
      style={[
        { backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
        style,
      ]}
    >
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? <Hairline style={{ marginLeft: 16 }} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/**
 * One row inside a SettingsGroup: label left, optional muted value and
 * chevron right. Chevron shows whenever the row navigates (onPress +
 * default chevron), never for action rows that opt out.
 */
export function SettingsRow({
  label,
  onPress,
  value,
  chevron,
  destructive = false,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  value?: string;
  chevron?: boolean;
  destructive?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const showChevron = chevron ?? Boolean(onPress);
  const content = (
    <>
      <Body style={{ flex: 1, color: destructive ? colors.danger : colors.text }}>{label}</Body>
      {value ? <Muted>{value}</Muted> : null}
      {showChevron ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      ) : null}
    </>
  );
  const layout: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 16,
  };
  if (!onPress) return <View style={layout}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [layout, { backgroundColor: pressed ? colors.cardPressed : 'transparent' }]}
    >
      {content}
    </Pressable>
  );
}

/** Pressable surface: pressed = cardPressed bg, no scale (design.md §Motion). */
export function PressCard({
  children,
  onPress,
  onLongPress,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  disabled = false,
}: {
  children: ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
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
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/**
 * Button (design.md §Chrome): primary red/white 600, radius 6, height 48.
 * Secondary = 1px text-color border, transparent. Danger = red text, no chrome.
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
          borderColor: colors.text,
          opacity: disabled ? 0.45 : pressed && kind !== 'secondary' ? 0.75 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: fontSize.base, fontFamily: fonts.uiSemi }}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Red tertiary text link ("+ Add", "See all") — no chrome. */
export function LinkButton({
  label,
  onPress,
  accessibilityLabel,
  style,
  textStyle,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [
        { minHeight: minTapTarget, justifyContent: 'center', opacity: pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Text style={[{ color: colors.accent, fontSize: fontSize.base, fontFamily: fonts.uiSemi }, textStyle]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Field: gray fill (NYT search style), radius 6, no border until focus
 * (2px text color), height 48, optional leading icon.
 */
export function Field({
  icon,
  ...props
}: TextInputProps & { style?: StyleProp<TextStyle>; icon?: keyof typeof Ionicons.glyphMap }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const input = (
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
          minHeight: icon ? controlHeight - 4 : controlHeight,
          borderRadius: radius.control,
          borderWidth: icon ? 0 : 2,
          borderColor: !icon && focused ? colors.text : 'transparent',
          paddingHorizontal: icon ? 0 : 14,
          paddingVertical: 10,
          backgroundColor: icon ? 'transparent' : colors.cardPressed,
          color: colors.text,
          fontSize: fontSize.base,
          fontFamily: fonts.ui,
          flex: icon ? 1 : undefined,
        },
        props.style,
      ]}
    />
  );
  if (!icon) return input;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderRadius: radius.control,
        borderWidth: 2,
        borderColor: focused ? colors.text : 'transparent',
        backgroundColor: colors.cardPressed,
        minHeight: controlHeight,
      }}
    >
      <Ionicons name={icon} size={20} color={colors.textMuted} />
      {input}
    </View>
  );
}

/** Bookmark save/plan affordance: outline, filled red when in this week. */
export function Bookmark({
  saved,
  onPress,
  size = 22,
  accessibilityLabel,
  style,
}: {
  saved: boolean;
  onPress?: () => void;
  size?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const previous = useRef(saved);

  useEffect(() => {
    if (previous.current === saved) return;
    previous.current = saved;
    if (reduced) return;
    scale.setValue(0.6);
    Animated.timing(scale, {
      toValue: 1,
      duration: BOOKMARK_FILL_MS,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [saved, reduced, scale]);

  const icon = (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Ionicons
        name={saved ? 'bookmark' : 'bookmark-outline'}
        size={size}
        color={saved ? colors.accent : colors.text}
      />
    </Animated.View>
  );
  if (!onPress) return <View style={style}>{icon}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (saved ? d.components.plannedThisWeek : d.components.addToThisWeek)
      }
      accessibilityState={{ selected: saved }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }, style]}
    >
      {icon}
    </Pressable>
  );
}

/**
 * v3 signature: the 36px bookmark chip overlaid top-right on recipe photos.
 * Card-fill circle + 1px border; red filled bookmark when in this week.
 */
export function BookmarkChip({
  saved,
  onPress,
  accessibilityLabel,
  style,
}: {
  saved: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          position: 'absolute',
          top: 8,
          right: 8,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Bookmark saved={saved} onPress={onPress} size={18} accessibilityLabel={accessibilityLabel} />
    </View>
  );
}

/**
 * 36px calendar chip overlaid on recipe photos — add/remove this week's
 * plan (the bookmark now belongs to folders, spec 2026-08-24).
 */
export function CalendarChip({
  planned,
  onPress,
  accessibilityLabel,
  style,
}: {
  planned: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <View
      style={[
        {
          position: 'absolute',
          top: 8,
          right: 8,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          accessibilityLabel ?? (planned ? d.components.plannedThisWeek : d.components.addToThisWeek)
        }
        accessibilityState={{ selected: planned }}
        onPress={onPress}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons
          name={planned ? 'calendar' : 'calendar-outline'}
          size={18}
          color={planned ? colors.accent : colors.text}
        />
      </Pressable>
    </View>
  );
}

/** Bitter headline + one red primary action. Direct, never apologetic. */
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
    <View style={{ alignItems: 'center', gap: 20, paddingVertical: 48, paddingHorizontal: 24 }}>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.sectionHead,
          lineHeight: Math.round(fontSize.sectionHead * 1.2),
          letterSpacing: -0.3,
          fontFamily: fonts.display,
          textAlign: 'center',
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
