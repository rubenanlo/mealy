import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/lib/i18n';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';

/**
 * Bottom sheet used by the week page: scrim, grab handle, title row, a
 * scrolling body and an optional pinned footer. `tall` pins it near the top
 * (search lists); otherwise it hugs its content up to 90% of the screen.
 */
export function WeekSheet({
  visible,
  onClose,
  title,
  subtitle,
  headerRight,
  footer,
  tall = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  footer?: ReactNode;
  tall?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.common.close}
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(18,18,18,0.38)' }}
        />
        <View
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: radius.card * 2,
            borderTopRightRadius: radius.card * 2,
            maxHeight: '90%',
            height: tall ? '90%' : undefined,
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: 10 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border }} />
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: screenPadding,
              paddingTop: 10,
              paddingBottom: 6,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                accessibilityRole="header"
                style={{ color: colors.text, fontFamily: fonts.display, fontSize: 21 }}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.small }}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {headerRight}
          </View>
          <ScrollView
            style={{ flexGrow: tall ? 1 : 0 }}
            contentContainerStyle={{ paddingHorizontal: screenPadding, paddingTop: 8, paddingBottom: 12, gap: 14 }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: screenPadding, paddingTop: 8, gap: 10 }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Pill chip used across the week sheets. */
export function Pill({
  label,
  selected = false,
  onPress,
  accessibilityLabel,
  tone = 'default',
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  tone?: 'default' | 'accent';
}) {
  const { colors } = useTheme();
  const body = (
    <Text
      style={{
        color: selected ? colors.bg : tone === 'accent' ? colors.accent : colors.text,
        fontFamily: fonts.uiMedium,
        fontSize: fontSize.small,
      }}
    >
      {label}
    </Text>
  );
  const style = {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: selected ? 0 : 1,
    borderColor: colors.border,
    backgroundColor: selected ? colors.text : colors.bg,
  };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** Small grey badge ("Draft", "Meat 2/3"); `accent` tints it red. */
export function Badge({ label, accent = false }: { label: string; accent?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: accent ? colors.accent : colors.bgGrouped,
      }}
    >
      <Text
        style={{
          color: accent ? colors.accentText : colors.text,
          fontFamily: fonts.uiSemi,
          fontSize: fontSize.eyebrow,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
