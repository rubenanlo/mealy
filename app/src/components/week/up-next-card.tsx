import { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, Text, UIManager, View } from 'react-native';

import { RecipeImage } from '@/components/recipe-cards';
import type { UpcomingCell } from '@/components/upcoming-strip';
import { Button, Eyebrow, Muted } from '@/components/ui';
import { Badge } from '@/components/week/sheet';
import { fmt, useI18n } from '@/lib/i18n';
import { dayDate, weekStart } from '@/lib/plan';
import type { CellDish } from '@/lib/meal-cells';
import { fonts, fontSize, radius, screenPadding, useTheme } from '@/lib/theme';

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

/**
 * The next meal, large: cover, when, the dish and its sides, who eats, and
 * an Open recipe button. Tapping the card itself opens its week.
 */
export function UpNextCard({
  cell,
  when,
  first = true,
  onOpenRecipe,
  onPress,
}: {
  cell: UpcomingCell;
  /** "Today · Dinner" */
  when: string;
  /** Shows the "Up next" badge (only the first card of the carousel). */
  first?: boolean;
  onOpenRecipe: (recipeId: string, servings: number) => void;
  onPress: () => void;
}) {
  const dishes = cell.dishes ?? [];
  if (dishes.length > 1) {
    return <UpNextStack dishes={dishes} when={when} first={first} onOpenRecipe={onOpenRecipe} />;
  }
  return <UpNextSingle cell={cell} when={when} first={first} onOpenRecipe={onOpenRecipe} onPress={onPress} />;
}

function UpNextSingle({
  cell,
  when,
  first,
  onOpenRecipe,
  onPress,
}: {
  cell: UpcomingCell;
  when: string;
  first: boolean;
  onOpenRecipe: (recipeId: string, servings: number) => void;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.planHome;
  const [main, ...sides] = cell.titles;
  const mainRecipe = cell.dishRecipeIds[0] ?? null;
  const mainServings = cell.dishServings[0] ?? null;
  const eaters = cell.eaters[0] ?? [];
  const meta = [
    eaters.length > 0 ? eaters.join(', ') : null,
    mainServings ? fmt(d.plan.serves, { n: mainServings }) : null,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.upNext}: ${when}, ${cell.titles.join(', ')}`}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: radius.card * 2,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        backgroundColor: pressed ? colors.cardPressed : colors.bg,
      })}
    >
      <View>
        <RecipeImage path={cell.covers[0] ?? null} style={{ width: '100%', height: 150 }} iconSize={28} />
        {first ? (
          <View style={{ position: 'absolute', left: 12, top: 12 }}>
            <Badge label={t.upNext} accent />
          </View>
        ) : null}
      </View>
      <View style={{ padding: 14, gap: 6, flex: 1 }}>
        <Eyebrow>{when}</Eyebrow>
        <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: fontSize.cardTitle + 3, lineHeight: 26 }}>
          {main}
          {sides.length > 0 ? (
            <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.base }}>
              {`  + ${sides.join(', ')}`}
            </Text>
          ) : null}
        </Text>
        {meta.length > 0 ? <Muted>{meta.join(' · ')}</Muted> : null}
        {mainRecipe ? (
          <Button
            label={t.openRecipe}
            kind="secondary"
            onPress={() => onOpenRecipe(mainRecipe, mainServings ?? 1)}
            style={{ marginTop: 'auto' }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * A meal with several dishes (design G1, 2026-11-17): a deck of cards with
 * every dish's title at the same size and who eats it. Tapping the deck
 * fans the dishes out side by side, each with its own Open recipe; "Stack
 * them again" folds them back.
 */
function UpNextStack({
  dishes,
  when,
  first,
  onOpenRecipe,
}: {
  dishes: CellDish[];
  when: string;
  first: boolean;
  onOpenRecipe: (recipeId: string, servings: number) => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.planHome;
  const [fanned, setFanned] = useState(false);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setFanned((f) => !f);
  };
  const who = (dish: CellDish) => (dish.eaters.length > 0 ? dish.eaters.join(', ') : d.weekPage.everyone);
  const serves = (dish: CellDish) => (dish.servings ? fmt(d.plan.serves, { n: dish.servings }) : null);

  if (fanned) {
    return (
      <View style={{ gap: 10 }}>
        <Eyebrow>{`${when} · ${fmt(t.nDishes, { n: dishes.length })}`}</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {dishes.map((dish, i) => (
            <View
              key={`${dish.title}-${i}`}
              style={{
                flexBasis: '47%',
                flexGrow: 1,
                borderRadius: radius.card * 2,
                borderWidth: 1,
                borderColor: colors.border,
                overflow: 'hidden',
                backgroundColor: colors.bg,
                transform: [{ rotate: dishes.length === 2 ? (i === 0 ? '-1.2deg' : '1.2deg') : '0deg' }],
              }}
            >
              <RecipeImage path={dish.cover} style={{ width: '100%', height: 100 }} iconSize={22} />
              <View style={{ padding: 10, gap: 4, flex: 1 }}>
                <Text numberOfLines={3} style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.base, lineHeight: 20 }}>
                  {dish.title}
                  {dish.sides.length > 0 ? (
                    <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.small }}>
                      {` + ${dish.sides.join(', ')}`}
                    </Text>
                  ) : null}
                </Text>
                <Muted numberOfLines={2}>{[who(dish), serves(dish)].filter(Boolean).join(' · ')}</Muted>
                {dish.recipeId ? (
                  <Button
                    label={t.openRecipe}
                    kind="secondary"
                    onPress={() => onOpenRecipe(dish.recipeId!, dish.servings ?? 1)}
                    style={{ marginTop: 'auto', minHeight: 40 }}
                  />
                ) : null}
              </View>
            </View>
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={toggle} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 6 }}>
          <Text style={{ color: colors.textMuted, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{t.stackAgain}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fmt(t.dishesA11y, { when, n: dishes.length, titles: dishes.map((x) => x.title).join(', ') })}
        onPress={toggle}
        style={({ pressed }) => ({
          borderRadius: radius.card * 2,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
          backgroundColor: pressed ? colors.cardPressed : colors.bg,
        })}
      >
        <View style={{ flexDirection: 'row', height: 150, gap: 3 }}>
          {dishes.slice(0, 2).map((dish, i) => (
            <RecipeImage key={i} path={dish.cover} style={{ flex: 1, height: 150 }} iconSize={24} />
          ))}
          {first ? (
            <View style={{ position: 'absolute', left: 12, top: 12 }}>
              <Badge label={t.upNext} accent />
            </View>
          ) : null}
          <View style={{ position: 'absolute', right: 12, top: 12 }}>
            <Badge label={fmt(t.nDishes, { n: dishes.length })} />
          </View>
        </View>
        <View style={{ padding: 14, gap: 8 }}>
          <Eyebrow>{when}</Eyebrow>
          {dishes.map((dish, i) => (
            <View key={`${dish.title}-${i}`} style={{ gap: 2 }}>
              <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: fontSize.cardTitle + 1, lineHeight: 23 }}>
                {dish.title}
              </Text>
              <Muted numberOfLines={1}>{[who(dish), serves(dish)].filter(Boolean).join(' · ')}</Muted>
            </View>
          ))}
          <Button label={fmt(t.seeDishes, { n: dishes.length })} kind="secondary" onPress={toggle} style={{ marginTop: 4 }} />
        </View>
      </Pressable>
      {/* The deck: two card edges peeking out under the top card. */}
      <View
        style={{
          marginHorizontal: 8,
          height: 6,
          borderBottomLeftRadius: radius.card,
          borderBottomRightRadius: radius.card,
          borderWidth: 1,
          borderTopWidth: 0,
          borderColor: colors.border,
          backgroundColor: colors.bgGrouped,
        }}
      />
      <View
        style={{
          marginHorizontal: 16,
          height: 5,
          borderBottomLeftRadius: radius.card,
          borderBottomRightRadius: radius.card,
          borderWidth: 1,
          borderTopWidth: 0,
          borderColor: colors.border,
          backgroundColor: colors.bgGrouped,
        }}
      />
    </View>
  );
}

/** "Today · Dinner", "Tomorrow · Lunch", "Thursday · Dinner" or "Monday 23 · Lunch". */
export function useMealWhen(): (cell: UpcomingCell) => string {
  const { d, locale } = useI18n();
  return (cell) => {
    const week = cell.weekIso ?? weekStart(new Date());
    const date = dayDate(week, cell.day);
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const day =
      date.toDateString() === today.toDateString()
        ? d.plan.today
        : date.toDateString() === tomorrow.toDateString()
          ? d.planHome.tomorrow
          : week === weekStart(today)
            ? date.toLocaleDateString(locale, { weekday: 'long' })
            : `${date.toLocaleDateString(locale, { weekday: 'long' })} ${date.getDate()}`;
    const slot = cell.slot === 'lunch' ? d.common.lunch : d.common.dinner;
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${slot}`;
  };
}

/**
 * Up next as a swipeable row of big cards: the next meal first, then every
 * following meal this week and in later planned weeks. The next card peeks
 * in from the right so it is clear the row scrolls. A last card invites
 * planning more.
 */
export function UpNextCarousel({
  cells,
  onOpenRecipe,
  onPressCell,
  onPlanMore,
}: {
  cells: UpcomingCell[];
  onOpenRecipe: (recipeId: string, servings: number) => void;
  onPressCell: (cell: UpcomingCell) => void;
  onPlanMore: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.planHome;
  const mealWhen = useMealWhen();
  const [width, setWidth] = useState(0);
  const gap = 12;
  const cardWidth = Math.max(0, width - 2 * screenPadding - 28);
  const total = cells.length + 1;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width + 2 * screenPadding)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + gap}
        snapToAlignment="start"
        style={{ marginHorizontal: -screenPadding }}
        contentContainerStyle={{ gap, paddingHorizontal: screenPadding }}
      >
        {cells.map((cell, i) => (
          <View key={`${cell.weekIso ?? ''}-${cell.day}-${cell.slot}`} style={{ width: cardWidth || undefined }}>
            <UpNextCard
              cell={cell}
              when={mealWhen(cell)}
              first={i === 0}
              onOpenRecipe={onOpenRecipe}
              onPress={() => onPressCell(cell)}
            />
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={onPlanMore}
          style={({ pressed }) => ({
            width: cardWidth || undefined,
            borderRadius: radius.card * 2,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            gap: 6,
            minHeight: 200,
            backgroundColor: pressed ? colors.cardPressed : 'transparent',
          })}
        >
          <Muted>{cells.length > 0 ? t.thatsAll : t.nothingNext}</Muted>
          <Text style={{ color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>
            {t.planMore}
          </Text>
        </Pressable>
      </ScrollView>
      {total > 2 ? <Muted style={{ marginTop: 8 }}>{cells.length === 2 ? t.swipeHintOne : fmt(t.swipeHint, { n: cells.length - 1 })}</Muted> : null}
    </View>
  );
}
