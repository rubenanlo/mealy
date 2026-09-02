// Redesigned day list for the Week detail page (2026-09-02).
//
// Experiment, kept deliberately isolated: everything visual lives in this one
// file and plan/detail.tsx only mounts <WeekDaysRedesign/>. To revert, restore
// detail.tsx's previous day-list block from git history and delete this file
// (or `git revert` the commit that introduced it).
//
// What it changes, and why:
// - Each day is a bordered card, so the week scans as seven discrete blocks
//   instead of one continuous run of hairlines.
// - Today's card carries a saffron left rail and a TODAY pill; days already
//   past are dimmed, so the eye lands on now-and-next while scrolling.
// - An empty slot collapses to one compact dashed tappable row (label and
//   + Add together, the whole row pressable) instead of an eyebrow with a
//   detached link across the full width.

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import { PersonChip, type PersonLike } from '@/components/person-chip';
import { CategoryDot, Eyebrow, Muted } from '@/components/ui';
import { resolveProteinCategory } from '@/lib/category';
import { fmt, useI18n } from '@/lib/i18n';
import { useImageUrl } from '@/lib/media';
import { DAY_LABELS, dayDate, slotCoverage, slotEntries, type MealSlot, type PlanEntry } from '@/lib/plan';
import { entryServings } from '@/lib/servings';
import { fonts, fontSize, radius, useTheme } from '@/lib/theme';
import { useCanonicalIndex } from '@/lib/use-canonical';
import type { IngredientRow as IngredientData } from '@/lib/worker';

interface RecipeLike {
  id: string;
  title: string;
  tags: string[];
  cover_image_path: string | null;
  ingredients?: IngredientData[];
}

interface Props {
  entries: PlanEntry[];
  weekIso: string;
  /** Index of today within the shown week; -1 when it's another week. */
  todayIndex: number;
  eaterIds: string[];
  personById: ReadonlyMap<string, PersonLike>;
  recipeById: ReadonlyMap<string, RecipeLike>;
  onAddDish: (day: number, slot: MealSlot) => void;
  onEditEntry: (entry: PlanEntry) => void;
  onRemoveEntry: (entryId: string) => void;
}

function EntryThumb({ path }: { path: string | null }) {
  const { colors } = useTheme();
  const url = useImageUrl(path);
  return (
    <View
      style={{
        width: 64,
        height: 48,
        borderRadius: radius.thumb,
        backgroundColor: colors.cardPressed,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: 64, height: 48 }} contentFit="cover" />
      ) : (
        <Ionicons name="restaurant-outline" size={18} color={colors.textMuted} />
      )}
    </View>
  );
}

export function WeekDaysRedesign({
  entries,
  weekIso,
  todayIndex,
  eaterIds,
  personById,
  recipeById,
  onAddDish,
  onEditEntry,
  onRemoveEntry,
}: Props) {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const index = useCanonicalIndex();
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);

  return (
    <View style={{ gap: 14, paddingTop: 4 }}>
      {DAY_LABELS.map((_, day) => {
        const dayLabel = d.common.days[day];
        const isToday = day === todayIndex;
        const isPast = todayIndex >= 0 && day < todayIndex;
        return (
          <View
            key={day}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.card,
              backgroundColor: colors.card,
              overflow: 'hidden',
              opacity: isPast ? 0.55 : 1,
            }}
          >
            {isToday ? (
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  backgroundColor: colors.saffron,
                }}
              />
            ) : null}
            <View style={{ padding: 14, paddingLeft: isToday ? 17 : 14, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: fontSize.dayName,
                    letterSpacing: -0.2,
                    fontFamily: fonts.displaySemi,
                  }}
                >
                  {dayLabel}
                </Text>
                <Muted style={{ flex: 1 }}>
                  {dayDate(weekIso, day).toLocaleDateString(locale, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Muted>
                {isToday ? (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: colors.saffron,
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.saffron,
                        fontSize: fontSize.eyebrow,
                        fontFamily: fonts.uiSemi,
                        letterSpacing: 0.8,
                      }}
                    >
                      {d.plan.today.toUpperCase()}
                    </Text>
                  </View>
                ) : null}
              </View>

              {(['lunch', 'dinner'] as const).map((slot) => {
                const cellEntries = slotEntries(entries, day, slot);
                const coverage = slotCoverage(entries, day, slot, eaterIds);
                if (cellEntries.length === 0) {
                  // Empty slot: one compact dashed row, tappable end to end.
                  return (
                    <Pressable
                      key={slot}
                      accessibilityRole="button"
                      accessibilityLabel={fmt(d.plan.addDishA11y, { day: dayLabel, slot: slotLabel(slot) })}
                      onPress={() => onAddDish(day, slot)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: colors.border,
                        borderRadius: radius.control,
                        paddingHorizontal: 12,
                        minHeight: 44,
                        backgroundColor: pressed ? colors.cardPressed : 'transparent',
                      })}
                    >
                      <Eyebrow>{slotLabel(slot)}</Eyebrow>
                      <Text
                        style={{
                          color: colors.accent,
                          fontSize: fontSize.small,
                          fontFamily: fonts.uiMedium,
                        }}
                      >
                        {d.plan.addShort}
                      </Text>
                    </Pressable>
                  );
                }
                return (
                  <View key={slot} style={{ gap: 6 }}>
                    {/* Label and its action stay adjacent — no eye travel. */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Eyebrow>{slotLabel(slot)}</Eyebrow>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fmt(d.plan.addDishA11y, { day: dayLabel, slot: slotLabel(slot) })}
                        onPress={() => onAddDish(day, slot)}
                        hitSlop={8}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                      >
                        <Text
                          style={{
                            color: colors.accent,
                            fontSize: fontSize.meta,
                            fontFamily: fonts.uiMedium,
                          }}
                        >
                          {d.plan.addShort}
                        </Text>
                      </Pressable>
                    </View>
                    {cellEntries.map((entry) => {
                      const recipe = entry.recipe_id ? recipeById.get(entry.recipe_id) : undefined;
                      const category = resolveProteinCategory(
                        recipe?.tags ?? [],
                        recipe?.ingredients,
                        index
                      );
                      const planServings = entryServings(
                        entry.person_ids,
                        entry.guest_count,
                        eaterIds.length
                      );
                      return (
                        <View
                          key={entry.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 12,
                            minHeight: 56,
                          }}
                        >
                          {/* Tapping a planned meal opens the editor, pre-filled. */}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={fmt(d.plan.editMealA11y, { title: entry.custom_title ?? recipe?.title ?? d.plan.mealOne })}
                            onPress={() => onEditEntry(entry)}
                            style={({ pressed }) => ({
                              flex: 1,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 12,
                              borderRadius: radius.thumb,
                              backgroundColor: pressed ? colors.cardPressed : 'transparent',
                            })}
                          >
                            <EntryThumb path={recipe?.cover_image_path ?? null} />
                            <View style={{ flex: 1, gap: 3 }}>
                              <Text
                                numberOfLines={2}
                                style={{
                                  color: colors.text,
                                  fontSize: fontSize.small,
                                  fontFamily: fonts.uiMedium,
                                }}
                              >
                                {entry.custom_title ?? recipe?.title ?? d.plan.recipeFallback}
                              </Text>
                              <View
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}
                              >
                                {category ? <CategoryDot category={category} size={7} /> : null}
                                {entry.person_ids.length === 0 ? (
                                  <Muted>{d.plan.wholeHousehold}</Muted>
                                ) : (
                                  entry.person_ids.map((pid) => {
                                    const person = personById.get(pid);
                                    return person ? <PersonChip key={pid} person={person} /> : null;
                                  })
                                )}
                                {entry.guest_count > 0 ? (
                                  <Muted>
                                    {entry.guest_count === 1
                                      ? d.plan.guestsOne
                                      : fmt(d.plan.guestsMany, { count: entry.guest_count })}
                                  </Muted>
                                ) : null}
                                {recipe ? <Muted>{`· ${fmt(d.plan.serves, { n: planServings })}`}</Muted> : null}
                                {entry.assigned_cook === 'employee' ? (
                                  <View
                                    style={{
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      borderWidth: 1,
                                      borderColor: colors.border,
                                      borderRadius: 999,
                                      paddingHorizontal: 8,
                                      paddingVertical: 2,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: fontSize.eyebrow,
                                        fontFamily: fonts.uiSemi,
                                        color: colors.textMuted,
                                      }}
                                    >
                                      {d.plan.employeeCooks}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                            </View>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={d.plan.removeDish}
                            onPress={() => onRemoveEntry(entry.id)}
                            hitSlop={8}
                            style={({ pressed }) => ({
                              width: 32,
                              height: 32,
                              alignItems: 'center',
                              justifyContent: 'center',
                              opacity: pressed ? 0.5 : 1,
                            })}
                          >
                            <Ionicons name="close" size={18} color={colors.textMuted} />
                          </Pressable>
                        </View>
                      );
                    })}
                    {coverage.uncovered.length > 0 ? (
                      <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                        {coverage.uncovered.map((pid) => {
                          const person = personById.get(pid);
                          return person ? <PersonChip key={pid} person={person} hollow /> : null;
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}
