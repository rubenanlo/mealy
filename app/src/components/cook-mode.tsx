import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Hairline } from '@/components/ui';
import { fmt, useI18n } from '@/lib/i18n';
import { amountLabel, type StepIngredientMap } from '@/lib/step-ingredients';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';
import type { IngredientRow as IngredientData } from '@/lib/worker';

const KEEP_AWAKE_TAG = 'mealy-cook-mode';

/**
 * Full-screen cook mode: one step per screen in large type, the step's own
 * ingredients first ("You need"), big Back / Next, and the whole list in a
 * drawer that peeks from the bottom. Keeps the screen awake while open.
 * Ticks live only while cook mode is open.
 */
export function CookMode({
  visible,
  onClose,
  title,
  steps,
  ingredients,
  map,
  servingsLabel,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  steps: string[];
  ingredients: IngredientData[];
  map: StepIngredientMap;
  servingsLabel: string | null;
}) {
  const { colors, dark } = useTheme();
  const { d } = useI18n();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Fresh start each time it opens; the screen stays on while it is open.
  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    setTicked(new Set());
    setDrawerOpen(false);
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      try {
        void Promise.resolve(deactivateKeepAwake(KEEP_AWAKE_TAG)).catch(() => {});
      } catch {
        // Web without the Wake Lock API: nothing to release.
      }
    };
  }, [visible]);

  const total = steps.length;
  const step = steps[index] ?? '';
  const need = map.byStep[index] ?? [];
  const last = index >= total - 1;

  const toggle = (i: number) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 8 }}>
        {/* Header: close, step counter, progress */}
        <View style={{ paddingHorizontal: screenPadding, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={d.recipe.closeCookMode}
              onPress={onClose}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? colors.border : colors.bgGrouped,
              })}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: fontSize.eyebrow,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                fontFamily: fonts.uiSemi,
              }}
            >
              {fmt(d.recipe.cookStepOf, { n: index + 1, total })}
            </Text>
            <View style={{ width: 44 }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {steps.map((_, i) => (
              <View
                key={i}
                style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= index ? colors.accent : colors.border }}
              />
            ))}
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: screenPadding, gap: 20, paddingBottom: 40 }}
        >
          <Text numberOfLines={2} style={{ color: colors.textMuted, fontSize: fontSize.small, fontFamily: fonts.ui }}>
            {title}
          </Text>
          {need.length > 0 ? (
            <View style={{ backgroundColor: colors.bgGrouped, borderRadius: radius.card * 2, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text
                style={{
                  paddingTop: 6,
                  color: colors.textMuted,
                  fontSize: fontSize.eyebrow,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                  fontFamily: fonts.uiSemi,
                }}
              >
                {d.recipe.youNeed}
              </Text>
              {need.map((i, n) => {
                const ing = ingredients[i];
                if (!ing) return null;
                return (
                  <View key={i}>
                    {n > 0 ? <Hairline /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 12 }}>
                      <Text style={{ flex: 1, color: colors.text, fontSize: 18, fontFamily: fonts.ui }}>{ing.name}</Text>
                      <Text style={{ color: colors.text, fontSize: 18, fontFamily: fonts.uiSemi, fontVariant: ['tabular-nums'] }}>
                        {amountLabel(ing)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
          <Text style={{ color: colors.text, fontSize: 22, lineHeight: 32, fontFamily: fonts.ui }}>{step}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label={d.recipe.prevStep}
              kind="secondary"
              disabled={index === 0}
              onPress={() => setIndex((i) => Math.max(0, i - 1))}
              style={{ flexBasis: 110 }}
            />
            <Button
              label={last ? d.recipe.doneCooking : d.recipe.nextStep}
              onPress={() => (last ? onClose() : setIndex((i) => Math.min(total - 1, i + 1)))}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>

        {/* Drawer: peeks at the bottom, opens to the full tick-off list. */}
        {drawerOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={d.recipe.hideIngredients}
            onPress={() => setDrawerOpen(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(18,18,18,0.38)' }}
          />
        ) : null}
        <View
          style={{
            position: drawerOpen ? 'absolute' : 'relative',
            left: 0,
            right: 0,
            bottom: 0,
            top: drawerOpen ? insets.top + 90 : undefined,
            backgroundColor: colors.bg,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: dark ? 1 : 0,
            borderColor: colors.border,
            shadowColor: '#000000',
            shadowOpacity: 0.12,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: -4 },
            elevation: 12,
            paddingBottom: Math.max(insets.bottom, 12),
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={drawerOpen ? d.recipe.hideIngredients : d.recipe.showIngredients}
            accessibilityState={{ expanded: drawerOpen }}
            onPress={() => setDrawerOpen(!drawerOpen)}
            style={{ paddingHorizontal: screenPadding, paddingTop: 8, paddingBottom: 10, gap: 8 }}
          >
            <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: 10 }}>
              <Text style={{ flex: 1, color: colors.text, fontSize: fontSize.base, fontFamily: fonts.uiSemi }}>
                {fmt(d.recipe.allIngredientsCount, { n: ingredients.length })}
              </Text>
              {servingsLabel ? (
                <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.ui }}>{servingsLabel}</Text>
              ) : null}
              <Ionicons name={drawerOpen ? 'chevron-down' : 'chevron-up'} size={18} color={colors.textMuted} />
            </View>
          </Pressable>
          {drawerOpen ? (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: 16 }}>
              {ingredients.map((ing, i) => {
                const on = ticked.has(i);
                return (
                  <View key={`${ing.raw}-${i}`}>
                    {i > 0 ? <Hairline /> : null}
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={fmt(d.recipe.tickA11y, { name: ing.name })}
                      onPress={() => toggle(i)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        minHeight: 50,
                        backgroundColor: pressed ? colors.cardPressed : 'transparent',
                      })}
                    >
                      <View
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          borderWidth: on ? 0 : 1.5,
                          borderColor: colors.textMuted,
                          backgroundColor: on ? colors.accent : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {on ? <Ionicons name="checkmark" size={16} color={colors.accentText} /> : null}
                      </View>
                      <Text
                        style={{
                          flex: 1,
                          color: on ? colors.textMuted : colors.text,
                          textDecorationLine: on ? 'line-through' : 'none',
                          fontSize: fontSize.base,
                          fontFamily: fonts.ui,
                        }}
                      >
                        {ing.name}
                      </Text>
                      <Text
                        style={{
                          color: on ? colors.textMuted : colors.text,
                          fontSize: fontSize.base,
                          fontFamily: fonts.ui,
                          fontVariant: ['tabular-nums'],
                        }}
                      >
                        {amountLabel(ing)}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
