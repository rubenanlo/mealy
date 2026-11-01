import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import type { FodmapFlag } from '@/lib/fodmap';
import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';
import type { FodmapSwapResult } from '@/lib/worker';

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
  onLowFodmap,
  hasFodmapWork,
}: {
  visible: boolean;
  onClose: () => void;
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
          icon="leaf-outline"
          label={d.ai.lowFodmapOption}
          hint={hasFodmapWork ? d.ai.lowFodmapOptionHint : d.ai.alreadyLowHint}
          onPress={onLowFodmap}
          highlighted
        />
        <ActionRow icon="nutrition-outline" label={d.ai.vegetarianOption} badge={d.ai.soon} />
        <ActionRow icon="people-outline" label={d.ai.guestsOption} badge={d.ai.soon} />
        <ActionRow icon="chatbubble-ellipses-outline" label={d.ai.askOption} badge={d.ai.soon} />
      </View>
    </Modal>
  );
}

const GROUP_LABELS: Record<string, string> = {
  fructan: 'fructans',
  fructans: 'fructans',
  gos: 'GOS',
  excess_fructose: 'fructose',
  fructose: 'fructose',
  lactose: 'lactose',
  polyol: 'polyols',
  sorbitol: 'sorbitol',
  mannitol: 'mannitol',
};

function Bubble({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 14,
        borderBottomLeftRadius: 4,
        padding: 14,
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}

function BubbleText({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        color: colors.text,
        fontSize: fontSize.small,
        lineHeight: 21,
        fontFamily: strong ? fonts.uiSemi : fonts.ui,
      }}
    >
      {children}
    </Text>
  );
}

export interface FodmapChatProps {
  visible: boolean;
  recipeTitle: string;
  /** Lines the engine checked (for the "I checked N" count). */
  checkedCount: number;
  servings: number | null;
  /** High/moderate flags from the deterministic table. */
  flags: FodmapFlag[];
  loading: boolean;
  failed: boolean;
  result: FodmapSwapResult | null;
  saving: boolean;
  saveError: boolean;
  /** A low-FODMAP version already exists, so saving updates it. */
  updatesExisting: boolean;
  onRetry: () => void;
  onSave: (accepted: Set<string>) => void;
  onClose: () => void;
}

/**
 * Chat-style low-FODMAP flow (concept A): what's high, the proposed swaps with
 * checkboxes, then "save as a version". Flags come from Mealy's cited table;
 * only the replacements and reworded steps come from the model.
 */
export function FodmapChatSheet(props: FodmapChatProps) {
  const { visible, flags, result, loading, failed, saving } = props;
  const { colors } = useTheme();
  const { d } = useI18n();
  const insets = useSafeAreaInsets();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  // Every proposed swap starts ticked; the user unticks what to keep.
  useEffect(() => {
    setAccepted(new Set((result?.swaps ?? []).map((s) => s.raw)));
  }, [result]);

  const flagByRaw = useMemo(() => new Map(flags.map((f) => [f.raw, f])), [flags]);
  const toggle = (raw: string) =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(raw)) next.delete(raw);
      else next.add(raw);
      return next;
    });

  const intro =
    flags.length === 0
      ? fmt(d.ai.noneFound, { n: props.checkedCount })
      : props.servings
        ? fmt(d.ai.checked, { n: props.checkedCount, high: flags.length, servings: props.servings })
        : fmt(d.ai.checkedNoServings, { n: props.checkedCount, high: flags.length });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={props.onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.bgGrouped }}>
        <View
          style={{
            backgroundColor: colors.bg,
            paddingHorizontal: screenPadding,
            paddingTop: 16,
            paddingBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                color: colors.textMuted,
                fontSize: fontSize.eyebrow,
                fontFamily: fonts.uiSemi,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              {fmt(d.ai.chatEyebrow, { title: props.recipeTitle })}
            </Text>
            <Text style={{ color: colors.text, fontSize: fontSize.dayName, fontFamily: fonts.display, marginTop: 2 }}>
              {d.ai.chatTitle}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={d.ai.closeA11y}
            onPress={props.onClose}
            style={({ pressed }) => ({
              width: minTapTarget - 4,
              height: minTapTarget - 4,
              borderRadius: (minTapTarget - 4) / 2,
              backgroundColor: pressed ? colors.cardPressed : colors.bgGrouped,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }}>
          <Bubble>
            <BubbleText>{intro}</BubbleText>
            {flags.map((flag) => (
              <View
                key={flag.raw}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
              >
                <Text style={{ flex: 1, color: colors.text, fontSize: fontSize.small, fontFamily: fonts.ui }}>
                  {flag.raw}
                </Text>
                <Text
                  style={{
                    color: flag.tier === 'high' ? colors.danger : colors.saffron,
                    fontSize: fontSize.eyebrow,
                    fontFamily: fonts.uiSemi,
                  }}
                >
                  {[
                    flag.tier === 'high' ? d.ai.tierHigh : d.ai.tierModerate,
                    ...flag.groups.map((g) => GROUP_LABELS[g] ?? g),
                  ].join(' · ')}
                </Text>
              </View>
            ))}
          </Bubble>

          {flags.length > 0 && loading ? (
            <Bubble>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={colors.textMuted} />
                <BubbleText>{d.ai.finding}</BubbleText>
              </View>
            </Bubble>
          ) : null}

          {flags.length > 0 && failed && !loading ? (
            <Bubble>
              <BubbleText>{d.ai.swapsFailed}</BubbleText>
              <Button label={d.ai.retry} kind="secondary" onPress={props.onRetry} />
            </Bubble>
          ) : null}

          {result && !loading ? (
            <>
              <Bubble>
                <BubbleText>{d.ai.swapsIntro}</BubbleText>
                <View>
                  {result.swaps.map((swap, i) => {
                    const on = accepted.has(swap.raw);
                    const flag = flagByRaw.get(swap.raw);
                    return (
                      <Pressable
                        key={swap.raw}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        onPress={() => toggle(swap.raw)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'flex-start',
                          gap: 12,
                          paddingVertical: 10,
                          borderTopWidth: i === 0 ? 0 : 1,
                          borderTopColor: colors.border,
                        }}
                      >
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            marginTop: 1,
                            borderRadius: 6,
                            borderWidth: on ? 0 : 1.5,
                            borderColor: colors.textMuted,
                            backgroundColor: on ? colors.accent : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {on ? <Ionicons name="checkmark" size={16} color={colors.accentText} /> : null}
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ fontSize: fontSize.small, lineHeight: 21, fontFamily: fonts.ui, color: colors.text }}>
                            <Text
                              style={{
                                color: colors.textMuted,
                                textDecorationLine: on ? 'line-through' : 'none',
                              }}
                            >
                              {flag?.raw ?? swap.raw}
                            </Text>
                            {'  →  '}
                            <Text style={{ fontFamily: fonts.uiSemi }}>{swap.replacement.raw || swap.replacement.name}</Text>
                          </Text>
                          {swap.note ? (
                            <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.uiMedium }}>
                              {swap.note}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </Bubble>
              {result.swaps.length > 0 ? (
                <>
                  <Bubble>
                    <BubbleText>{props.updatesExisting ? d.ai.askUpdate : d.ai.askSave}</BubbleText>
                  </Bubble>
                  {props.saveError ? (
                    <Text style={{ color: colors.danger, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>
                      {d.ai.saveFailed}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button
                      style={{ flex: 1 }}
                      label={saving ? d.ai.saving : fmt(d.ai.saveVersion, { n: accepted.size })}
                      loading={saving}
                      disabled={accepted.size === 0}
                      onPress={() => props.onSave(new Set(accepted))}
                    />
                    <Button label={d.ai.notNow} kind="secondary" onPress={props.onClose} />
                  </View>
                </>
              ) : null}
            </>
          ) : null}

          <Text
            style={{
              color: colors.textMuted,
              fontSize: fontSize.eyebrow,
              fontFamily: fonts.uiMedium,
              textAlign: 'center',
              marginTop: 6,
            }}
          >
            {d.ai.disclaimer}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Original | Low-FODMAP segmented switch shown under the title of a recipe family. */
export function VersionToggle({
  active,
  onSelect,
}: {
  active: 'original' | 'low_fodmap';
  onSelect: (which: 'original' | 'low_fodmap') => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const seg = (which: 'original' | 'low_fodmap', label: string, leaf: boolean) => {
    const on = active === which;
    return (
      <Pressable
        key={which}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        onPress={() => !on && onSelect(which)}
        style={{
          flex: 1,
          minHeight: 40,
          borderRadius: radius.control,
          backgroundColor: on ? colors.card : 'transparent',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        {leaf ? <Ionicons name="leaf-outline" size={14} color={colors.spineVeg} /> : null}
        <Text
          style={{
            color: on ? colors.text : colors.textMuted,
            fontSize: fontSize.small,
            fontFamily: fonts.uiSemi,
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={d.ai.versionsA11y}
      style={{ flexDirection: 'row', backgroundColor: colors.bgGrouped, borderRadius: radius.card, padding: 3 }}
    >
      {seg('original', d.ai.versionOriginal, false)}
      {seg('low_fodmap', d.ai.versionLowFodmap, true)}
    </View>
  );
}
