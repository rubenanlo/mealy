import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BookmarkChip, CalendarChip, CategoryDot, Hairline, Muted } from '@/components/ui';
import { matchCanonical, normalizeRaw } from '@/lib/canonical';
import { resolveProteinCategory, type ProteinCategory } from '@/lib/category';
import { computeRecipeFodmap, recipeFodmapTier } from '@/lib/fodmap';
import { fmt, useI18n } from '@/lib/i18n';
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
  /** Present where a screen selects it — the Home feed's "added by" filter. */
  created_by?: string | null;
  /** Present where a screen selects it — enables ingredient-derived category. */
  ingredients?: IngredientData[];
  /** Manual FODMAP level; null/absent = derive from ingredients. */
  fodmap_override?: 'low' | 'moderate' | 'high' | null;
  /** Planner classification; null/absent is treated as 'main'. */
  meal_type?: 'main' | 'breakfast' | 'dessert' | 'side' | null;
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
  const { d } = useI18n();
  const index = useCanonicalIndex();
  const category = resolveProteinCategory(recipe.tags, recipe.ingredients, index);
  const categoryLabels: Record<ProteinCategory, string> = {
    fish: d.components.catFish,
    meat: d.components.catMeat,
    vegan: d.components.catVegan,
    vegetarian: d.components.catVegetarian,
    legume: d.components.catLegume,
  };
  const minutes = totalMinutes(recipe);
  // Recipe-level FODMAP tier: a manual override wins; otherwise local
  // matching only. 'check' stays silent on cards — the recipe page carries
  // the detail.
  const fodmapTier = useMemo(() => {
    if (recipe.fodmap_override) return recipe.fodmap_override;
    if (!index || !recipe.ingredients || recipe.ingredients.length === 0) return null;
    const result = computeRecipeFodmap(
      recipe.ingredients.map((ing) => ({
        raw: ing.raw || ing.name,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
      })),
      recipe.servings,
      (line) => matchCanonical(normalizeRaw(line.raw), index)?.ingredient ?? null
    );
    return recipeFodmapTier(result);
  }, [index, recipe]);
  const showTier = fodmapTier !== null && fodmapTier !== 'check';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {minutes ? <Muted>{fmt(d.components.minutesShort, { minutes })}</Muted> : null}
      {minutes && category ? <Muted>·</Muted> : null}
      {category ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <CategoryDot category={category} />
          <Muted>{categoryLabels[category]}</Muted>
        </View>
      ) : null}
      {showTier ? (
        <>
          {minutes || category ? <Muted>·</Muted> : null}
          <Text
            accessibilityLabel={fmt(d.components.fodmapLevel, { tier: fodmapTier })}
            style={{
              color:
                fodmapTier === 'high'
                  ? colors.danger
                  : fodmapTier === 'moderate'
                    ? colors.saffron
                    : colors.spineVeg,
              fontSize: fontSize.meta,
              fontFamily: fonts.uiSemi,
            }}
          >
            {fodmapTier === 'high'
              ? d.components.fodmapHigh
              : fodmapTier === 'moderate'
                ? d.components.fodmapModerate
                : d.components.fodmapLow}
          </Text>
        </>
      ) : null}
      {showServings && recipe.servings ? (
        <>
          {minutes || category ? <Muted>·</Muted> : null}
          <Muted>{fmt(d.components.servingsCount, { count: recipe.servings })}</Muted>
        </>
      ) : null}
      {showBadge && recipe.needs_review ? (
        <Text style={{ color: colors.saffron, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}>
          {d.components.needsReview}
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

/** Full-bleed 4:3 hero card with a save chip (Home). */
export function Hero({
  recipe,
  saved,
  onPress,
  onSave,
}: {
  recipe: RecipeListItem;
  saved: boolean;
  onPress: () => void;
  onSave: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  // Chips are siblings of the card pressable (not children): nested
  // role="button" pressables render nested <button>s on web — invalid HTML.
  return (
    <View style={{ marginHorizontal: -screenPadding }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fmt(d.components.openRecipe, { title: recipe.title })}
        onPress={onPress}
        style={({ pressed }) => ({
          backgroundColor: pressed ? colors.cardPressed : 'transparent',
        })}
      >
        <RecipeImage path={recipe.cover_image_path} style={{ width: '100%', aspectRatio: 4 / 3 }} iconSize={48} />
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
      <BookmarkChip
        saved={saved}
        onPress={onSave}
        accessibilityLabel={saved ? d.components.savedToFolders : d.components.saveToFolder}
        style={{ top: 12, right: 12 }}
      />
    </View>
  );
}

/** 150×190 carousel card ("Suggested for you", "Recently added"). */
export function CarouselCard({
  recipe,
  saved,
  onPress,
  onSave,
}: {
  recipe: RecipeListItem;
  saved: boolean;
  onPress: () => void;
  onSave: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  // Chip as a sibling of the pressable — see the Hero note.
  return (
    <View style={{ width: 150 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fmt(d.components.openRecipe, { title: recipe.title })}
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <RecipeImage
          path={recipe.cover_image_path}
          style={{ width: 150, height: 110, borderRadius: radius.card }}
        />
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
      <BookmarkChip
        saved={saved}
        onPress={onSave}
        accessibilityLabel={saved ? d.components.savedToFolders : d.components.saveToFolder}
        style={{ top: 6, right: 6 }}
      />
    </View>
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
  const { d } = useI18n();
  // Chip as a sibling of the pressable — see the Hero note.
  return (
    <View style={{ width: 110 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fmt(d.components.open, { title: item.title })}
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <RecipeImage
          path={item.path}
          style={{ width: 110, height: 82, borderRadius: radius.card }}
          iconSize={22}
        />
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
      {onBookmark ? (
        <CalendarChip
          planned
          onPress={onBookmark}
          accessibilityLabel={fmt(d.components.removeFromWeek, { title: item.title })}
          style={{ top: 4, right: 4 }}
        />
      ) : null}
    </View>
  );
}

/** Hairline list row (Search tab, v2 style — thumbnails omit the chip). */
export function RecipeRow({ recipe, onPress }: { recipe: RecipeListItem; onPress: () => void }) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fmt(d.components.openRecipe, { title: recipe.title })}
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
