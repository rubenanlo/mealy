import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { fonts, fontSize, minTapTarget, useTheme } from '@/lib/theme';

/** Pill used for the errands person filter ("All · 6", "Marc · 1"). */
export function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? colors.text : colors.border,
        backgroundColor: selected ? colors.text : pressed ? colors.cardPressed : colors.card,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Text
        style={{
          color: selected ? colors.bg : colors.text,
          fontSize: fontSize.meta + 1,
          fontFamily: fonts.uiMedium,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Folded summary card: a title, a right-hand count, an optional progress bar
 * and a muted line underneath. The whole card is one button.
 */
export function SummaryCard({
  title,
  count,
  progress,
  subtitle,
  expanded,
  onPress,
  a11yLabel,
}: {
  title: string;
  count?: string;
  /** 0..1, omitted = no bar. */
  progress?: number;
  subtitle?: string;
  expanded: boolean;
  onPress: () => void;
  a11yLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.border : colors.cardPressed,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 8,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 }}>
        <Text
          style={{
            flex: 1,
            color: colors.text,
            fontSize: fontSize.dayName,
            fontFamily: fonts.displaySemi,
          }}
        >
          {title}
        </Text>
        {count ? (
          <Text style={{ color: colors.textMuted, fontSize: fontSize.meta + 1, fontFamily: fonts.ui }}>
            {count}
          </Text>
        ) : null}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </View>
      {progress !== undefined ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
          <View
            style={{
              width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
              height: 6,
              backgroundColor: colors.text,
            }}
          />
        </View>
      ) : null}
      {subtitle ? (
        <Text
          numberOfLines={1}
          style={{ color: colors.textMuted, fontSize: fontSize.meta + 1, fontFamily: fonts.ui }}
        >
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Dark snackbar pinned above the tab bar with one action (Undo). */
export function UndoToast({
  message,
  actionLabel,
  onAction,
  bottom,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  bottom: number;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom,
        minHeight: 52,
        borderRadius: 12,
        backgroundColor: '#121212',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 4,
        gap: 8,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      <Text
        numberOfLines={2}
        style={{ flex: 1, color: '#FFFFFF', fontSize: fontSize.base, fontFamily: fonts.ui }}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onAction}
        style={({ pressed }) => ({
          minHeight: minTapTarget,
          paddingHorizontal: 12,
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ color: '#F4B4A6', fontSize: fontSize.base, fontFamily: fonts.uiSemi }}>
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}
