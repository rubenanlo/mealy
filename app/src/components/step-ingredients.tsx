import { Pressable, ScrollView, Text, View } from 'react-native';

import { fmt, useI18n } from '@/lib/i18n';
import { amountLabel } from '@/lib/step-ingredients';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';
import type { IngredientRow as IngredientData } from '@/lib/worker';

/** Soft red behind the per-step chips (accent at low strength, both themes). */
export function usesTint(dark: boolean): string {
  return dark ? '#3A201B' : '#FBEAE6';
}

/** Amount text on the per-step chips: darker red that passes 4.5:1 on the tint. */
function usesAmountColor(dark: boolean): string {
  return dark ? '#F4A090' : '#9F3221';
}

/**
 * The ingredients one step uses, as chips: "Pork chops 4 (600 g)". Sits under
 * the step text on the recipe page. Tapping a chip opens its details.
 */
export function StepUses({
  indexes,
  ingredients,
  onPress,
}: {
  indexes: number[];
  ingredients: IngredientData[];
  onPress?: (index: number) => void;
}) {
  const { colors, dark } = useTheme();
  const { d } = useI18n();
  if (indexes.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {indexes.map((i) => {
        const ing = ingredients[i];
        if (!ing) return null;
        const amount = amountLabel(ing);
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={fmt(d.recipe.ingredientDetailsA11y, { name: `${ing.name} ${amount}`.trim() })}
            onPress={onPress ? () => onPress(i) : undefined}
            hitSlop={4}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              minHeight: 34,
              paddingHorizontal: 12,
              borderRadius: 17,
              backgroundColor: usesTint(dark),
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.text, fontSize: fontSize.small - 1, fontFamily: fonts.ui }}>{ing.name}</Text>
            {amount ? (
              <Text
                style={{
                  color: usesAmountColor(dark),
                  fontSize: fontSize.small - 1,
                  fontFamily: fonts.uiSemi,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {amount}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export const CHIP_STRIP_HEIGHT = 60;

/**
 * The sticky strip that replaces the thin "Ingredients ⌄" bar: an "All N"
 * button, then every ingredient with its amount, scrolling sideways.
 */
export function IngredientStrip({
  ingredients,
  open,
  onToggleAll,
  onPress,
}: {
  ingredients: IngredientData[];
  open: boolean;
  onToggleAll: () => void;
  onPress: (index: number) => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{
        height: CHIP_STRIP_HEIGHT,
        flexGrow: 0,
        backgroundColor: colors.bg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
      contentContainerStyle={{ alignItems: 'center', gap: 8, paddingHorizontal: screenPadding - 4 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fmt(d.recipe.allNA11y, { n: ingredients.length })}
        accessibilityState={{ expanded: open }}
        onPress={onToggleAll}
        style={({ pressed }) => ({
          height: 40,
          paddingHorizontal: 14,
          borderRadius: radius.card + 4,
          backgroundColor: colors.text,
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Text style={{ color: colors.bg, fontSize: fontSize.small - 1, fontFamily: fonts.uiSemi }}>
          {fmt(d.recipe.allN, { n: ingredients.length })}
        </Text>
      </Pressable>
      {ingredients.map((ing, i) => {
        const amount = amountLabel(ing);
        return (
          <Pressable
            key={`${ing.raw}-${i}`}
            accessibilityRole="button"
            accessibilityLabel={fmt(d.recipe.ingredientDetailsA11y, { name: `${ing.name} ${amount}`.trim() })}
            onPress={() => onPress(i)}
            style={({ pressed }) => ({
              height: 40,
              maxWidth: 220,
              paddingHorizontal: 12,
              borderRadius: radius.card + 4,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.cardPressed : colors.bg,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            })}
          >
            <Text
              numberOfLines={1}
              style={{ flexShrink: 1, color: colors.text, fontSize: fontSize.small - 1, fontFamily: fonts.ui }}
            >
              {ing.name}
            </Text>
            {amount ? (
              <Text
                style={{
                  color: colors.text,
                  fontSize: fontSize.small - 1,
                  fontFamily: fonts.uiSemi,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {amount}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Two-column grid: big amount on top, name and first step below. */
export function AllIngredientsGrid({
  ingredients,
  firstStep,
  onPress,
}: {
  ingredients: IngredientData[];
  firstStep: (number | null)[];
  onPress: (index: number) => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {ingredients.map((ing, i) => {
        const amount = amountLabel(ing);
        const step = firstStep[i];
        return (
          <Pressable
            key={`${ing.raw}-${i}`}
            accessibilityRole="button"
            accessibilityLabel={fmt(d.recipe.ingredientDetailsA11y, { name: `${ing.name} ${amount}`.trim() })}
            onPress={() => onPress(i)}
            style={({ pressed }) => ({
              width: '48.5%',
              minHeight: 56,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.card + 4,
              paddingHorizontal: 12,
              paddingVertical: 10,
              gap: 2,
              backgroundColor: pressed ? colors.cardPressed : colors.bg,
            })}
          >
            {amount ? (
              <Text
                style={{
                  color: colors.text,
                  fontSize: fontSize.cardTitle,
                  fontFamily: fonts.uiSemi,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {amount}
              </Text>
            ) : null}
            <Text style={{ color: colors.text, fontSize: fontSize.small - 1, fontFamily: fonts.ui }}>{ing.name}</Text>
            {step !== null && step !== undefined ? (
              <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.ui }}>
                {fmt(d.recipe.usedInStep, { n: step + 1 })}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
