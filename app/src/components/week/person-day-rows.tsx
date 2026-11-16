import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import type { PersonLike } from '@/components/person-chip';
import { RecipeImage } from '@/components/recipe-cards';
import { fmt, useI18n } from '@/lib/i18n';
import { dayDate, type MealSlot, type PlanAbsence, type PlanEntry } from '@/lib/plan';
import { isPastDay } from '@/lib/plan-ideas';
import { fonts, fontSize, minTapTarget, radius, useTheme } from '@/lib/theme';
import { WEEK_SLOTS, personMeal, type PersonMeal } from '@/lib/week-page';

interface RecipeLike {
  id: string;
  title: string;
  cover_image_path: string | null;
}

/**
 * One person's week (design D1, 2026-11-16): the same seven day blocks as
 * DayRows, but each meal shows only what this person eats, whether it's
 * shared or just theirs. Tapping a dish opens its recipe; the ··· button
 * offers a different dish, joining the others, or marking them away.
 */
export function PersonDayRows({
  weekIso,
  person,
  entries,
  absences,
  eaters,
  recipeById,
  todayIndex,
  readOnly,
  onAdd,
  onOpenDish,
  onMore,
}: {
  weekIso: string;
  person: PersonLike;
  entries: PlanEntry[];
  absences: PlanAbsence[];
  eaters: PersonLike[];
  recipeById: ReadonlyMap<string, RecipeLike>;
  todayIndex: number;
  readOnly: boolean;
  onAdd: (day: number, slot: MealSlot) => void;
  onOpenDish: (entry: PlanEntry, day: number, slot: MealSlot) => void;
  onMore: (day: number, slot: MealSlot, meal: PersonMeal<PlanEntry>) => void;
}) {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const t = d.weekPage;
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);
  const titleOf = (e: PlanEntry) =>
    e.custom_title ?? (e.recipe_id ? recipeById.get(e.recipe_id)?.title : undefined) ?? d.plan.recipeFallback;

  const othersOn = (entry: PlanEntry, day: number, slot: MealSlot) => {
    const away = new Set(absences.filter((a) => a.day === day && a.slot === slot).map((a) => a.person_id));
    const ids = entry.person_ids.length === 0 ? eaters.map((p) => p.id) : entry.person_ids;
    return eaters.filter((p) => p.id !== person.id && ids.includes(p.id) && !away.has(p.id)).map((p) => p.name);
  };

  const label = (slot: MealSlot, width = 54) => (
    <Text style={{ width, color: colors.textMuted, fontFamily: fonts.uiSemi, fontSize: 11, letterSpacing: 1.2 }}>
      {slotLabel(slot).toUpperCase()}
    </Text>
  );

  const moreButton = (day: number, slot: MealSlot, meal: PersonMeal<PlanEntry>) =>
    readOnly ? null : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fmt(t.moreA11y, { name: person.name, day: d.common.days[day], slot: slotLabel(slot) })}
        onPress={() => onMore(day, slot, meal)}
        hitSlop={6}
        style={({ pressed }) => ({
          width: minTapTarget,
          height: minTapTarget,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: minTapTarget / 2,
          backgroundColor: pressed ? colors.cardPressed : 'transparent',
        })}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
      </Pressable>
    );

  let homeMeals = 0;
  for (let day = 0; day < 7; day += 1) {
    for (const slot of WEEK_SLOTS) {
      if (personMeal(entries, absences, day, slot, person.id).kind !== 'away') homeMeals += 1;
    }
  }

  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.meta }}>
        {fmt(t.personWeek, { name: person.name, n: homeMeals })}
      </Text>
      {Array.from({ length: 7 }, (_, day) => {
        const date = dayDate(weekIso, day);
        const past = isPastDay(weekIso, day);
        const isToday = day === todayIndex;
        return (
          <View
            key={day}
            style={{
              borderTopWidth: day === 0 ? 0 : 1,
              borderTopColor: colors.border,
              paddingVertical: 8,
              opacity: past && !isToday ? 0.55 : 1,
            }}
          >
            <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 18, minHeight: 32 }}>
              {date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })}
              {isToday ? (
                <Text style={{ color: colors.saffron, fontFamily: fonts.uiSemi, fontSize: fontSize.eyebrow }}>
                  {`  ${d.plan.today.toUpperCase()}`}
                </Text>
              ) : null}
            </Text>
            {WEEK_SLOTS.map((slot) => {
              const meal = personMeal(entries, absences, day, slot, person.id);
              if (meal.kind === 'away' || meal.kind === 'none') {
                return (
                  <View key={slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 }}>
                    {label(slot)}
                    <View
                      style={{
                        flex: 1,
                        minHeight: 44,
                        borderRadius: radius.card,
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: colors.border,
                        justifyContent: 'center',
                        paddingHorizontal: 12,
                      }}
                    >
                      <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.small }}>
                        {meal.kind === 'away' ? t.notHome : fmt(t.noDishFor, { name: person.name })}
                      </Text>
                    </View>
                    {moreButton(day, slot, meal)}
                  </View>
                );
              }
              if (meal.kind === 'empty') {
                if (past || readOnly) {
                  return (
                    <View key={slot} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
                      {label(slot, 64)}
                      <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.small }}>—</Text>
                    </View>
                  );
                }
                return (
                  <View key={slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 }}>
                    {label(slot)}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={fmt(d.plan.addDishA11y, { day: d.common.days[day], slot: slotLabel(slot) })}
                      onPress={() => onAdd(day, slot)}
                      style={({ pressed }) => ({
                        flex: 1,
                        minHeight: 44,
                        borderRadius: radius.card,
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: colors.border,
                        justifyContent: 'center',
                        paddingHorizontal: 12,
                        backgroundColor: pressed ? colors.cardPressed : 'transparent',
                      })}
                    >
                      <Text style={{ color: colors.accent, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>
                        {fmt(t.addSlot, { slot: slotLabel(slot).toLowerCase() })}
                      </Text>
                    </Pressable>
                  </View>
                );
              }
              const entry = meal.entry;
              const source =
                meal.kind === 'leftover' ? (entries.find((e) => e.id === entry.leftover_of) ?? entry) : entry;
              const recipe = source.recipe_id ? recipeById.get(source.recipe_id) : undefined;
              const others = meal.kind === 'dish' ? othersOn(entry, day, slot) : [];
              const metaLine =
                meal.kind === 'leftover'
                  ? fmt(t.leftoverOf, { title: titleOf(source) })
                  : others.length === 0
                    ? fmt(t.justFor, { name: person.name })
                    : fmt(t.withNames, { names: others.join(', ') });
              const sides = meal.kind === 'dish' ? meal.sides : [];
              return (
                <View key={slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${titleOf(source)} · ${metaLine}`}
                    onPress={() => onOpenDish(source, day, slot)}
                    style={({ pressed }) => ({
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 56,
                      paddingVertical: 4,
                      borderRadius: radius.card,
                      backgroundColor: pressed ? colors.cardPressed : 'transparent',
                    })}
                  >
                    {label(slot)}
                    <RecipeImage
                      path={recipe?.cover_image_path ?? null}
                      style={{ width: 40, height: 40, borderRadius: radius.thumb }}
                      iconSize={16}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>
                        {titleOf(source)}
                        {sides.length > 0 ? (
                          <Text style={{ color: colors.textMuted, fontFamily: fonts.ui }}>
                            {` + ${sides.map(titleOf).join(', ')}`}
                          </Text>
                        ) : null}
                      </Text>
                      <Text numberOfLines={1} style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.meta }}>
                        {metaLine}
                      </Text>
                    </View>
                  </Pressable>
                  {moreButton(day, slot, meal)}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
