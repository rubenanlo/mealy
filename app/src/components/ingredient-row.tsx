import { Text, View } from 'react-native';

import { fontSize, useTheme } from '@/lib/theme';
import type { IngredientRow as IngredientData } from '@/lib/worker';

/** One structured ingredient with its verbatim `raw` line beneath (spec §3.1). */
export function IngredientRow({ ingredient }: { ingredient: IngredientData }) {
  const { colors } = useTheme();
  const quantity = [ingredient.quantity, ingredient.unit].filter((v) => v != null).join(' ');
  const headline = quantity ? `${quantity} ${ingredient.name}` : ingredient.name;
  return (
    <View style={{ paddingVertical: 8, gap: 2 }}>
      <Text style={{ color: colors.text, fontSize: fontSize.base, lineHeight: 24 }}>
        {headline}
      </Text>
      {ingredient.raw && ingredient.raw !== headline ? (
        <Text style={{ color: colors.textMuted, fontSize: fontSize.small }}>{ingredient.raw}</Text>
      ) : null}
    </View>
  );
}
