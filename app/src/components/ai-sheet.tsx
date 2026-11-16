import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/lib/i18n';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';

/** ✦ button overlaid on the recipe hero (top-left, clear of the bookmark chip). */
export function AiButton({ onPress, style }: { onPress: () => void; style?: object }) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={d.ai.openA11y}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.text,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <Ionicons name="sparkles-outline" size={18} color={colors.bg} />
    </Pressable>
  );
}

interface ActionRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  onPress?: () => void;
  highlighted?: boolean;
  badge?: string;
}

function ActionRow({ icon, label, hint, onPress, highlighted, badge }: ActionRowProps) {
  const { colors } = useTheme();
  const disabled = !onPress;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={hint}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 60,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: highlighted ? colors.bgGrouped : pressed ? colors.cardPressed : 'transparent',
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: highlighted ? colors.card : colors.bgGrouped,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={18} color={highlighted ? colors.spineVeg : colors.text} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: fontSize.base, fontFamily: highlighted ? fonts.uiSemi : fonts.uiMedium }}>
          {label}
        </Text>
        {hint ? (
          <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.uiMedium }}>{hint}</Text>
        ) : null}
      </View>
      {badge ? (
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.eyebrow,
            fontFamily: fonts.uiSemi,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          {badge}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The Mealy AI action sheet (design concept A). Low-FODMAP is live; the other
 * actions are placeholders for later AI features and render disabled.
 */
export function AiActionsSheet({
  visible,
  onClose,
  onChange,
  onAsk,
  onUnits,
  onLowFodmap,
  hasFodmapWork,
}: {
  visible: boolean;
  onClose: () => void;
  onChange: () => void;
  onAsk: () => void;
  onUnits: () => void;
  onLowFodmap: () => void;
  /** False when the engine found nothing high/moderate (the chat says so). */
  hasFodmapWork: boolean;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={d.ai.closeA11y}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        onPress={onClose}
      />
      <View
        style={{
          backgroundColor: colors.bg,
          paddingHorizontal: screenPadding,
          paddingTop: 10,
          paddingBottom: insets.bottom + 20,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          gap: 4,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 40,
            height: 5,
            borderRadius: 3,
            backgroundColor: colors.border,
            marginBottom: 12,
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
          <Text style={{ color: colors.text, fontSize: fontSize.dayName, fontFamily: fonts.display }}>
            {d.ai.sheetTitle}
          </Text>
        </View>
        <ActionRow
          icon="create-outline"
          label={d.assist.changeOption}
          hint={d.assist.changeOptionHint}
          onPress={onChange}
          highlighted
        />
        <ActionRow
          icon="chatbubble-ellipses-outline"
          label={d.assist.askOption}
          hint={d.assist.askOptionHint}
          onPress={onAsk}
        />
        <ActionRow
          icon="swap-horizontal-outline"
          label={d.assist.unitsOption}
          hint={d.assist.unitsOptionHint}
          onPress={onUnits}
        />
        <ActionRow
          icon="leaf-outline"
          label={d.ai.lowFodmapOption}
          hint={hasFodmapWork ? d.ai.lowFodmapOptionHint : d.ai.alreadyLowHint}
          onPress={onLowFodmap}
        />
      </View>
    </Modal>
  );
}

export type VersionKey = 'original' | 'low_fodmap' | 'custom';

/**
 * Original | Low-FODMAP | My version segmented switch shown under the title
 * of a recipe family. Tapping the active "My version" segment opens its
 * manage sheet (onActivePress).
 */
export function VersionToggle({
  active,
  available,
  onSelect,
  onActivePress,
}: {
  active: VersionKey;
  /** Segments to show, in order; 'original' is always first. */
  available: VersionKey[];
  onSelect: (which: VersionKey) => void;
  onActivePress?: (which: VersionKey) => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const labels: Record<VersionKey, string> = {
    original: d.ai.versionOriginal,
    low_fodmap: d.ai.versionLowFodmap,
    custom: d.assist.versionMine,
  };
  const icons: Partial<Record<VersionKey, { name: keyof typeof Ionicons.glyphMap; color: string }>> = {
    low_fodmap: { name: 'leaf-outline', color: colors.spineVeg },
    custom: { name: 'create-outline', color: colors.accent },
  };
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={d.ai.versionsA11y}
      style={{ flexDirection: 'row', backgroundColor: colors.bgGrouped, borderRadius: radius.card, padding: 3 }}
    >
      {available.map((which) => {
        const on = active === which;
        const icon = icons[which];
        return (
          <Pressable
            key={which}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => (on ? onActivePress?.(which) : onSelect(which))}
            style={{
              flex: 1,
              minHeight: 40,
              borderRadius: radius.control,
              backgroundColor: on ? colors.card : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingHorizontal: 4,
            }}
          >
            {icon ? <Ionicons name={icon.name} size={14} color={on ? icon.color : colors.textMuted} /> : null}
            <Text
              numberOfLines={1}
              style={{
                color: on ? colors.text : colors.textMuted,
                fontSize: fontSize.small,
                fontFamily: fonts.uiSemi,
              }}
            >
              {labels[which]}
            </Text>
            {on && onActivePress && which === 'custom' ? (
              <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
