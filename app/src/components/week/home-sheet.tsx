import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { PersonChip, type PersonLike } from '@/components/person-chip';
import { Button, Muted } from '@/components/ui';
import { WeekSheet } from '@/components/week/sheet';
import { SCHOOL_LUNCH_DAYS } from '@/lib/ai-week';
import { fmt, useI18n } from '@/lib/i18n';
import { awayIds, type MealSlot, type PlanAbsence } from '@/lib/plan';
import { isPastDay } from '@/lib/plan-ideas';
import { fonts, fontSize, radius, useTheme } from '@/lib/theme';
import { WEEK_SLOTS, everyoneAway } from '@/lib/week-page';

export interface AwayChange {
  day: number;
  slot: MealSlot;
  personId: string;
  away: boolean;
}

/**
 * Who's home for the whole week on one grid (design A). Tap a face to mark
 * someone out, tap the empty part of a meal to mark everyone out (going
 * out). The school chip sets the child's usual school lunches in one go.
 * Every change persists right away (the parent owns the writes).
 */
export function HomeSheet({
  visible,
  weekIso,
  eaters,
  absences,
  schoolChild,
  onChange,
  onClose,
}: {
  visible: boolean;
  weekIso: string;
  eaters: PersonLike[];
  absences: PlanAbsence[];
  schoolChild: PersonLike | null;
  onChange: (changes: AwayChange[]) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.weekPage;
  const eaterIds = eaters.map((p) => p.id);
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);
  const shortDay = (day: number) => d.common.days[day]!.slice(0, 3);

  const schoolDays = SCHOOL_LUNCH_DAYS.filter((day) => !isPastDay(weekIso, day));
  const atSchool =
    !!schoolChild &&
    schoolDays.length > 0 &&
    schoolDays.every((day) => awayIds(absences, day, 'lunch').has(schoolChild.id));

  const toggleSchool = () => {
    if (!schoolChild) return;
    onChange(
      schoolDays
        .filter((day) => awayIds(absences, day, 'lunch').has(schoolChild.id) === atSchool)
        .map((day) => ({ day, slot: 'lunch' as MealSlot, personId: schoolChild.id, away: !atSchool }))
    );
  };

  const toggleOut = (day: number, slot: MealSlot) => {
    const out = everyoneAway(absences, day, slot, eaterIds);
    const away = awayIds(absences, day, slot);
    onChange(
      eaterIds
        .filter((id) => away.has(id) === out)
        .map((personId) => ({ day, slot, personId, away: !out }))
    );
  };

  return (
    <WeekSheet
      visible={visible}
      onClose={onClose}
      title={t.homeTitle}
      footer={<Button label={t.done} onPress={onClose} />}
    >
      {schoolChild ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: atSchool }}
          onPress={toggleSchool}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minHeight: 40,
            paddingHorizontal: 14,
            borderRadius: 999,
            borderWidth: atSchool ? 0 : 1,
            borderColor: colors.border,
            backgroundColor: atSchool ? colors.text : pressed ? colors.cardPressed : colors.bg,
          })}
        >
          {atSchool ? <Ionicons name="checkmark" size={16} color={colors.bg} /> : null}
          <Text style={{ color: atSchool ? colors.bg : colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>
            {fmt(t.schoolChip, {
              name: schoolChild.name,
              days: SCHOOL_LUNCH_DAYS.map(shortDay).join(' '),
            })}
          </Text>
        </Pressable>
      ) : null}

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ width: 44 }} />
          {WEEK_SLOTS.map((slot) => (
            <Text
              key={slot}
              style={{ flex: 1, color: colors.textMuted, fontFamily: fonts.uiSemi, fontSize: 11, letterSpacing: 1.2 }}
            >
              {slotLabel(slot).toUpperCase()}
            </Text>
          ))}
        </View>
        {Array.from({ length: 7 }, (_, day) => {
          const past = isPastDay(weekIso, day);
          return (
            <View key={day} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: past ? 0.45 : 1 }}>
              <Text style={{ width: 44, color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
                {shortDay(day)}
              </Text>
              {WEEK_SLOTS.map((slot) => {
                const away = awayIds(absences, day, slot);
                const out = everyoneAway(absences, day, slot, eaterIds);
                return (
                  <Pressable
                    key={slot}
                    disabled={past}
                    accessibilityRole="button"
                    accessibilityLabel={fmt(t.everyoneOutA11y, { day: d.common.days[day], slot: slotLabel(slot) })}
                    accessibilityState={{ selected: out }}
                    onPress={() => toggleOut(day, slot)}
                    style={({ pressed }) => ({
                      flex: 1,
                      minHeight: 48,
                      borderRadius: radius.card,
                      paddingHorizontal: 4,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 2,
                      backgroundColor: out ? colors.bgGrouped : pressed ? colors.cardPressed : 'transparent',
                    })}
                  >
                    {out ? (
                      <Text style={{ color: colors.textMuted, fontFamily: fonts.uiSemi, fontSize: fontSize.meta, paddingHorizontal: 8 }}>
                        {t.goingOut}
                      </Text>
                    ) : (
                      eaters.map((p) => {
                        const isAway = away.has(p.id);
                        return (
                          <Pressable
                            key={p.id}
                            disabled={past}
                            accessibilityRole="button"
                            accessibilityLabel={fmt(t.personA11y, {
                              name: p.name,
                              day: d.common.days[day],
                              slot: slotLabel(slot),
                              state: isAway ? t.away : t.home,
                            })}
                            onPress={() => onChange([{ day, slot, personId: p.id, away: !isAway }])}
                            hitSlop={2}
                          >
                            <PersonChip person={p} hollow={isAway} />
                          </Pressable>
                        );
                      })
                    )}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
      <Muted>{t.homeHint}</Muted>
    </WeekSheet>
  );
}
