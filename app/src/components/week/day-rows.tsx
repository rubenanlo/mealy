import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { PersonChip, type PersonLike } from '@/components/person-chip';
import { RecipeImage } from '@/components/recipe-cards';
import { Badge } from '@/components/week/sheet';
import { fmt, useI18n } from '@/lib/i18n';
import { awayIds, dayDate, type MealSlot, type PlanAbsence, type PlanEntry } from '@/lib/plan';
import { isPastDay } from '@/lib/plan-ideas';
import { fonts, fontSize, radius, useTheme } from '@/lib/theme';
import { WEEK_SLOTS, everyoneAway, splitSlot, uncoveredEaters } from '@/lib/week-page';

interface RecipeLike {
  id: string;
  title: string;
  cover_image_path: string | null;
}

/**
 * The week as seven compact day blocks (design A): a day line, then one row
 * per meal with a thumbnail, the dish (+ sides) and who cooks. Empty meals
 * are a dashed "+ Add" row; going-out meals say so instead.
 */
export function DayRows({
  weekIso,
  entries,
  absences,
  eaters,
  recipeById,
  todayIndex,
  readOnly,
  onAdd,
  onOpen,
  onAddFor,
  onOpenDish,
  onHome,
}: {
  weekIso: string;
  entries: PlanEntry[];
  absences: PlanAbsence[];
  eaters: PersonLike[];
  recipeById: ReadonlyMap<string, RecipeLike>;
  todayIndex: number;
  readOnly: boolean;
  onAdd: (day: number, slot: MealSlot) => void;
  onOpen: (entry: PlanEntry) => void;
  /** Add a dish just for these people (they're home but the meal's dish is for someone else). */
  onAddFor: (day: number, slot: MealSlot, personIds: string[]) => void;
  /** A dish in a meal with several dishes (one per group of people): open its recipe. */
  onOpenDish: (entry: PlanEntry) => void;
  onHome: () => void;
}) {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const t = d.weekPage;
  const eaterIds = eaters.map((p) => p.id);
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);
  const titleOf = (e: PlanEntry) =>
    e.custom_title ?? (e.recipe_id ? recipeById.get(e.recipe_id)?.title : undefined) ?? d.plan.recipeFallback;

  return (
    <View>
      {Array.from({ length: 7 }, (_, day) => {
        const date = dayDate(weekIso, day);
        const past = isPastDay(weekIso, day);
        const isToday = day === todayIndex;
        const awayToday = eaters.filter((p) =>
          WEEK_SLOTS.some((slot) => awayIds(absences, day, slot).has(p.id))
        );
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${d.common.days[day]} · ${t.homeA11y}`}
              onPress={onHome}
              disabled={readOnly}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}
            >
              <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.display, fontSize: 18 }}>
                {date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })}
                {isToday ? (
                  <Text style={{ color: colors.saffron, fontFamily: fonts.uiSemi, fontSize: fontSize.eyebrow }}>
                    {`  ${d.plan.today.toUpperCase()}`}
                  </Text>
                ) : null}
              </Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {awayToday.map((p) => (
                  <PersonChip key={p.id} person={p} hollow />
                ))}
              </View>
            </Pressable>
            {WEEK_SLOTS.map((slot) => {
              const { main, sides, plates, leftovers } = splitSlot(entries, day, slot);
              const away = awayIds(absences, day, slot);
              const out = everyoneAway(absences, day, slot, eaterIds);
              const label = (width = 64) => (
                <Text
                  style={{
                    width,
                    color: colors.textMuted,
                    fontFamily: fonts.uiSemi,
                    fontSize: 11,
                    letterSpacing: 1.2,
                  }}
                >
                  {slotLabel(slot).toUpperCase()}
                </Text>
              );
              if (!main) {
                if (out || past || readOnly) {
                  return (
                    <View key={slot} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
                      {label()}
                      <Text style={{ flex: 1, color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.small }}>
                        {out ? t.goingOut : '—'}
                      </Text>
                    </View>
                  );
                }
                return (
                  <View key={slot} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52 }}>
                    {label()}
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
              const recipe = main.recipe_id ? recipeById.get(main.recipe_id) : undefined;
              const awayNames = eaters.filter((p) => away.has(p.id)).map((p) => p.name);
              // Main cooked for only some of the people home: say who.
              const homeIds = eaterIds.filter((id) => !away.has(id));
              const mainFor =
                main.person_ids.length > 0 && homeIds.some((id) => !main.person_ids.includes(id))
                  ? eaters.filter((p) => main.person_ids.includes(p.id)).map((p) => p.name)
                  : [];
              const uncovered = uncoveredEaters(entries, absences, day, slot, eaterIds);
              const uncoveredNames = eaters.filter((p) => uncovered.includes(p.id)).map((p) => p.name);
              const meta = [
                mainFor.length > 0 ? fmt(t.forNames, { names: mainFor.join(', ') }) : null,
                awayNames.length > 0 ? fmt(d.plan.eatsAwayLine, { names: awayNames.join(', ') }) : null,
                main.guest_count > 0
                  ? main.guest_count === 1
                    ? d.plan.guestsOne
                    : fmt(d.plan.guestsMany, { count: main.guest_count })
                  : null,
                ...plates.map((p) => {
                  const names = eaters.filter((e) => p.dish.person_ids.includes(e.id)).map((e) => e.name);
                  const title = [p.dish, ...p.sides].map(titleOf).join(' + ');
                  return fmt(t.plateRow, { names: names.join(', '), title });
                }),
                ...leftovers.map((l) => {
                  const source = entries.find((e) => e.id === l.leftover_of);
                  const names = eaters.filter((p) => l.person_ids.includes(p.id)).map((p) => p.name);
                  return fmt(d.routine.leftoverRow, { names: names.join(', '), title: source ? titleOf(source) : titleOf(l) });
                }),
              ].filter(Boolean);
              const employee = [main, ...sides, ...plates.flatMap((p) => [p.dish, ...p.sides])].some(
                (e) => e.assigned_cook === 'employee'
              );
              const addFor =
                uncovered.length > 0 && !past && !readOnly ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onAddFor(day, slot, uncovered)}
                    style={({ pressed }) => ({
                      marginLeft: 64,
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
                      {fmt(t.addDishFor, { names: uncoveredNames.join(', ') })}
                    </Text>
                  </Pressable>
                ) : null;
              if (plates.length > 0) {
                // Several dishes for different people (design E2): one row per
                // dish, the eaters' initials first, tap = that dish's recipe.
                const dishes = [{ entry: main, sides }, ...plates.map((p) => ({ entry: p.dish, sides: p.sides }))];
                const extra = [
                  awayNames.length > 0 ? fmt(d.plan.eatsAwayLine, { names: awayNames.join(', ') }) : null,
                  ...leftovers.map((l) => {
                    const source = entries.find((e) => e.id === l.leftover_of);
                    const names = eaters.filter((p) => l.person_ids.includes(p.id)).map((p) => p.name);
                    return fmt(d.routine.leftoverRow, { names: names.join(', '), title: source ? titleOf(source) : titleOf(l) });
                  }),
                ].filter(Boolean);
                return (
                  <View key={slot} style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 4 }}>
                      <View style={{ paddingTop: 20 }}>{label(54)}</View>
                      <View style={{ flex: 1, gap: 2, borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 8 }}>
                        {dishes.map(({ entry: dish, sides: dishSides }) => {
                          const ids = dish.person_ids.length === 0 ? homeIds : dish.person_ids;
                          const who = eaters.filter((p) => ids.includes(p.id) && !away.has(p.id));
                          const cover = dish.recipe_id ? recipeById.get(dish.recipe_id)?.cover_image_path ?? null : null;
                          const title = [dish, ...dishSides].map(titleOf).join(' + ');
                          return (
                            <View key={dish.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={fmt(t.openDishA11y, { title, names: who.map((p) => p.name).join(', ') })}
                                onPress={() => onOpenDish(dish)}
                                style={({ pressed }) => ({
                                  flex: 1,
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 8,
                                  minHeight: 52,
                                  paddingVertical: 4,
                                  paddingHorizontal: 4,
                                  borderRadius: radius.card,
                                  backgroundColor: pressed ? colors.cardPressed : 'transparent',
                                })}
                              >
                                <View style={{ flexDirection: 'row', gap: 2, minWidth: 34 }}>
                                  {who.map((p) => (
                                    <PersonChip key={p.id} person={p} />
                                  ))}
                                </View>
                                <RecipeImage path={cover} style={{ width: 36, height: 36, borderRadius: radius.thumb }} iconSize={14} />
                                <Text
                                  numberOfLines={2}
                                  style={{ flex: 1, color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}
                                >
                                  {title}
                                </Text>
                                {dish.assigned_cook === 'employee' ? <Badge label={t.employee} /> : null}
                              </Pressable>
                              {readOnly ? null : (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={fmt(d.plan.editMealA11y, { title: titleOf(dish) })}
                                  onPress={() => onOpen(dish)}
                                  hitSlop={4}
                                  style={({ pressed }) => ({
                                    width: 40,
                                    height: 44,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 20,
                                    backgroundColor: pressed ? colors.cardPressed : 'transparent',
                                  })}
                                >
                                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
                                </Pressable>
                              )}
                            </View>
                          );
                        })}
                        {extra.length > 0 ? (
                          <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.meta, paddingLeft: 4 }}>
                            {extra.join(' · ')}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    {addFor}
                  </View>
                );
              }
              return (
                <View key={slot} style={{ gap: 4 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fmt(d.plan.editMealA11y, { title: titleOf(main) })}
                  onPress={() => onOpen(main)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 56,
                    paddingVertical: 4,
                    borderRadius: radius.card,
                    backgroundColor: pressed ? colors.cardPressed : 'transparent',
                  })}
                >
                  {label(54)}
                  <RecipeImage
                    path={recipe?.cover_image_path ?? null}
                    style={{ width: 40, height: 40, borderRadius: radius.thumb }}
                    iconSize={16}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>
                      {titleOf(main)}
                      {sides.length > 0 ? (
                        <Text style={{ color: colors.textMuted, fontFamily: fonts.ui }}>
                          {` + ${sides.map(titleOf).join(', ')}`}
                        </Text>
                      ) : null}
                    </Text>
                    {meta.length > 0 ? (
                      <Text numberOfLines={2} style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.meta }}>
                        {meta.join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  {employee ? (
                    <Badge label={main.cook_part ? `${t.employee} · ${d.aiPlan.partBadge}` : t.employee} />
                  ) : null}
                </Pressable>
                {addFor}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
