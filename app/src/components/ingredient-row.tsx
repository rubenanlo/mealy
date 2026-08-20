import { Text, View } from 'react-native';

import { fontSize, useTheme } from '@/lib/theme';
import type { IngredientRow as IngredientData } from '@/lib/worker';

/**
 * One structured ingredient: name left, quantity right in tabular figures,
 * verbatim `raw` line beneath in muted 13 (design.md §Recipe detail).
 */
export function IngredientRow({ ingredient }: { ingredient: IngredientData }) {
  const { colors } = useTheme();
  const quantity = [ingredient.quantity, ingredient.unit].filter((v) => v != null).join(' ');
  return (
    <View style={{ paddingVertical: 8, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: fontSize.base, lineHeight: 24 }}>
          {ingredient.name}
        </Text>
        {quantity ? (
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.base,
              lineHeight: 24,
              fontVariant: ['tabular-nums'],
              textAlign: 'right',
            }}
          >
            {quantity}
          </Text>
        ) : null}
      </View>
      {ingredient.raw && ingredient.raw !== ingredient.name ? (
        <Text style={{ color: colors.textMuted, fontSize: fontSize.eyebrow }}>
          {ingredient.raw}
        </Text>
      ) : null}
    </View>
  );
}
