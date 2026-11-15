import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { fonts, fontSize, useTheme } from '@/lib/theme';
import type { IngredientRow as IngredientData } from '@/lib/worker';

/**
 * One structured ingredient: name left, quantity right in tabular figures,
 * verbatim `raw` line beneath in muted 13 (design.md §Recipe detail).
 */
/** Colour of the "added in My version" marker (shared with the AI change chat). */
export function addedColor(dark: boolean): string {
  return dark ? '#6FAF7A' : '#2F6B3A';
}

export type IngredientMarker = 'added' | 'changed' | null;

/**
 * `marker`: a dot on lines My version added (green) or changed (gold).
 * `estimated`: the amount is a Mealy AI unit estimate (✦ before it).
 */
export function IngredientRow({
  ingredient,
  marker = null,
  estimated = false,
}: {
  ingredient: IngredientData;
  marker?: IngredientMarker;
  estimated?: boolean;
}) {
  const { colors, dark } = useTheme();
  const { d } = useI18n();
  const quantity = [ingredient.quantity, ingredient.unit].filter((v) => v != null).join(' ');
  return (
    <View style={{ paddingVertical: 10, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        {marker ? (
          <View
            accessible
            accessibilityLabel={marker === 'added' ? d.assist.addedA11y : d.assist.changedA11y}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              marginRight: -4,
              alignSelf: 'center',
              backgroundColor: marker === 'added' ? addedColor(dark) : colors.saffron,
            }}
          />
        ) : null}
        <Text
          style={{
            flex: 1,
            color: colors.text,
            fontSize: fontSize.base,
            lineHeight: 24,
            fontFamily: fonts.ui,
          }}
        >
          {ingredient.name}
        </Text>
        {quantity && estimated ? (
          <Ionicons
            name="sparkles-outline"
            size={13}
            color={colors.accent}
            accessibilityLabel={d.assist.estimatedA11y}
            style={{ marginRight: -6 }}
          />
        ) : null}
        {quantity ? (
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.base,
              lineHeight: 24,
              fontFamily: fonts.ui,
              fontVariant: ['tabular-nums'],
              textAlign: 'right',
            }}
          >
            {quantity}
          </Text>
        ) : null}
      </View>
      {ingredient.raw && ingredient.raw !== ingredient.name ? (
        <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.ui }}>
          {ingredient.raw}
        </Text>
      ) : null}
    </View>
  );
}
