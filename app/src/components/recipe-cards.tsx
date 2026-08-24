import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import { BookmarkChip, CalendarChip, CategoryDot, Hairline, Muted } from '@/components/ui';
import { CATEGORY_LABELS, resolveProteinCategory } from '@/lib/category';
import { useCanonicalIndex } from '@/lib/use-canonical';
import { useImageUrl } from '@/lib/media';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';
import type { IngredientRow as IngredientData } from '@/lib/worker';

/** Shared recipe card/row building blocks (v3: Home + Search). */

export interface RecipeListItem {
  id: string;
  title: string;
  tags: string[];
  needs_review: boolean;
  cover_image_path: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  /** Present where a screen selects it (Home's "Recently added" window). */
  created_at?: string;
  /** Present where a screen selects it — enables ingredient-derived category. */
  ingredients?: IngredientData[];
}

export function totalMinutes(recipe: RecipeListItem): number | null {
  const total = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0);
  return total > 0 ? total : null;
}

/** "35 min · Fish · 4 servings" meta line with the category dot inline. */
export function MetaLine({
  recipe,
  showServings = false,
  showBadge = false,
}: {
  recipe: RecipeListItem;
  showServings?: boolean;
  showBadge?: boolean;
}) {
  const { colors } = useTheme();
  const index = useCanonicalIndex();
  const category = resolveProteinCategory(recipe.tags, recipe.ingredients, index);
  const minutes = totalMinutes(recipe);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {minutes ? <Muted>{minutes} min</Muted> : null}
      {minutes && category ? <Muted>·</Muted> : null}
      {category ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <CategoryDot category={category} />
          <Muted>{CATEGORY_LABELS[category]}</Muted>
        </View>
      ) : null}
      {showServings && recipe.servings ? (
        <>
          {minutes || category ? <Muted>·</Muted> : null}
          <Muted>{recipe.servings} servings</Muted>
        </>
      ) : null}
      {showBadge && recipe.needs_review ? (
        <Text style={{ color: colors.saffron, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>
          needs review
        </Text>
      ) : null}
    </View>
  );
}

export function RecipeImage({
  path,
  style,
  iconSize = 28,
}: {
  path: string | null;
  style: object;
  iconSize?: number;
}) {
  const { colors } = useTheme();
  const url = useImageUrl(path);
  return (
    <View
      style={[
        {
          backgroundColor: colors.cardPressed,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      ) : (
        <Ionicons name="restaurant-outline" size={iconSize} color={colors.textMuted} />
      )}
    </View>
  );
}

/** Full-bleed 4:3 hero card with plan + save chips (Home). */
export function Hero({
  recipe,
  planned,
  saved,
  onPress,
  onPlan,
  onSave,
}: {
  recipe: RecipeListItem;
  planned: boolean;
  saved: boolean;
  onPress: () => void;
  onPlan: () => void;
  onSave: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open recipe ${recipe.title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        marginHorizontal: -screenPadding,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <View>
        <RecipeImage path={recipe.cover_image_path} style={{ width: '100%', aspectRatio: 4 / 3 }} iconSize={48} />
        <CalendarChip planned={planned} onPress={onPlan} style={{ top: 12, right: 12 }} />
        <BookmarkChip
          saved={saved}
          onPress={onSave}
          accessibilityLabel={saved ? 'Saved to your folders' : 'Save to a folder'}
          style={{ top: 12, right: 56 }}
        />
      </View>
      <View style={{ paddingHorizontal: screenPadding, paddingTop: 12, paddingBottom: 16, gap: 6 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: fontSize.heroTitle,
            lineHeight: Math.round(fontSize.heroTitle * 1.15),
            letterSpacing: -0.3,
            fontFamily: fonts.display,
          }}
        >
          {recipe.title}
        </Text>
        <MetaLine recipe={recipe} showServings />
      </View>
      <Hairline style={{ marginHorizontal: screenPadding }} />
    </Pressable>
  );
}

/** 150×190 carousel card ("Suggested for you", "Recently added"). */
export function CarouselCard({
  recipe,
  planned,
  saved,
  onPress,
  onPlan,
  onSave,
}: {
  recipe: RecipeListItem;
  planned: boolean;
  saved: boolean;
  onPress: () => void;
  onPlan: () => void;
  onSave: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open recipe ${recipe.title}`}
      onPress={onPress}
      style={({ pressed }) => ({ width: 150, opacity: pressed ? 0.7 : 1 })}
    >
      <View>
        <RecipeImage
          path={recipe.cover_image_path}
          style={{ width: 150, height: 110, borderRadius: radius.card }}
        />
        <CalendarChip planned={planned} onPress={onPlan} style={{ top: 6, right: 6 }} />
        <BookmarkChip
          saved={saved}
          onPress={onSave}
          accessibilityLabel={saved ? 'Saved to your folders' : 'Save to a folder'}
          style={{ top: 6, right: 50 }}
        />
      </View>
      <View style={{ paddingTop: 8, gap: 4 }}>
        <Text
          numberOfLines={2}
          style={{
            color: colors.text,
            fontSize: fontSize.cardTitle,
            lineHeight: 21,
            fontFamily: fonts.displaySemi,
          }}
        >
          {recipe.title}
        </Text>
        <MetaLine recipe={recipe} />
      </View>
    </Pressable>
  );
}

/** One "This week" strip item: a recipe or a free-text meal. */
export interface WeekStripItem {
  key: string;
  title: string;
  path: string | null;
  /** Recipe id when this is a recipe entry (enables the bookmark chip). */
  recipeId: string | null;
}

export function ThisWeekCard({
  item,
  onPress,
  onBookmark,
}: {
  item: WeekStripItem;
  onPress: () => void;
  /** Present only for recipe entries. */
  onBookmark?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.title}`}
      onPress={onPress}
      style={({ pressed }) => ({ width: 110, opacity: pressed ? 0.7 : 1 })}
    >
      <View>
        <RecipeImage
          path={item.path}
          style={{ width: 110, height: 82, borderRadius: radius.card }}
          iconSize={22}
        />
        {onBookmark ? (
          <CalendarChip
            planned
            onPress={onBookmark}
            accessibilityLabel={`Remove ${item.title} from this week`}
            style={{ top: 4, right: 4 }}
          />
        ) : null}
      </View>
      <Text
        numberOfLines={2}
        style={{
          color: colors.text,
          fontSize: fontSize.small,
          lineHeight: 19,
          fontFamily: fonts.uiMedium,
          paddingTop: 6,
        }}
      >
        {item.title}
      </Text>
    </Pressable>
  );
}

/** Hairline list row (Search tab, v2 style — thumbnails omit the chip). */
export function RecipeRow({ recipe, onPress }: { recipe: RecipeListItem; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open recipe ${recipe.title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 12,
        backgroundColor: pressed ? colors.cardPressed : 'transparent',
      })}
    >
      <RecipeImage
        path={recipe.cover_image_path}
        style={{ width: 96, height: 72, borderRadius: radius.thumb }}
        iconSize={24}
      />
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          numberOfLines={2}
          style={{
            color: colors.text,
            fontSize: fontSize.cardTitle,
            lineHeight: 21,
            fontFamily: fonts.displaySemi,
          }}
        >
          {recipe.title}
        </Text>
        <MetaLine recipe={recipe} showBadge />
      </View>
    </Pressable>
  );
}
