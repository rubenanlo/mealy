import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { PersonChip, type PersonLike } from '@/components/person-chip';
import { Button, Muted } from '@/components/ui';
import { WeekSheet } from '@/components/week/sheet';
import { SCHOOL_LUNCH_DAYS } from '@/lib/ai-week';
import { cellsFor, copyLastWeek, isAway, mealsOut, patternOn, thinnerMeals, togglePattern, type MealCell } from '@/lib/away';
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

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Who's eating out (design F3, 2026-11-17): a tab per person with the
 * week's 14 meals as big tiles, tap one to mark them out; pattern chips
 * (every weekday lunch, the weekend, same as last week, school lunches).
 * The Everyone tab sums up who's out and which meals have fewer people, and
 * its tiles mark everyone out at once. Every change persists right away
 * (the parent owns the writes).
 */
export function HomeSheet({
  visible,
  weekIso,
  eaters,
  absences,
  schoolChild,
  initialPersonId,
  onChange,
  onClose,
  loadLastWeek,
}: {
  /** The tab to open on (the person whose week is showing); default the first person. */
  initialPersonId?: string | null;
  visible: boolean;
  weekIso: string;
  eaters: PersonLike[];
  absences: PlanAbsence[];
  schoolChild: PersonLike | null;
  onChange: (changes: AwayChange[]) => void;
  onClose: () => void;
  /** Last week's absences, for "Same as last week". */
  loadLastWeek?: () => Promise<PlanAbsence[]>;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.weekPage;
  const eaterIds = eaters.map((p) => p.id);
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);
  const shortDay = (day: number) => d.common.days[day]!.slice(0, 3);
  const mealLabel = (c: MealCell) => `${shortDay(c.day)} ${slotLabel(c.slot).toLowerCase()}`;

  /** Selected tab: a person id, or 'all' for Everyone. */
  const [tab, setTab] = useState<string>('all');
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setTab((initialPersonId && eaters.some((p) => p.id === initialPersonId) ? initialPersonId : eaters[0]?.id) ?? 'all');
      setHint(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const futureDays = WEEK_DAYS.filter((day) => !isPastDay(weekIso, day));
  const person = eaters.find((p) => p.id === tab) ?? null;
  const isSchool = (day: number, slot: MealSlot, id: string) =>
    schoolChild?.id === id && slot === 'lunch' && (SCHOOL_LUNCH_DAYS as readonly number[]).includes(day);

  const chip = (label: string, selected: boolean, onPress: () => void, key = label) => (
    <Pressable
      key={key}
      accessibilityRole="switch"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: selected ? 0 : 1,
        borderColor: colors.border,
        backgroundColor: selected ? colors.text : pressed ? colors.cardPressed : colors.bg,
      })}
    >
      {selected ? <Ionicons name="checkmark" size={15} color={colors.bg} /> : null}
      <Text style={{ color: selected ? colors.bg : colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>
        {label}
      </Text>
    </Pressable>
  );

  const tabs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {[{ id: 'all', name: t.everyone } as PersonLike, ...eaters].map((p) => {
        const selected = tab === p.id;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              setTab(p.id);
              setHint(null);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              minHeight: 40,
              paddingLeft: p.id === 'all' ? 14 : 4,
              paddingRight: 14,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: selected ? colors.text : colors.border,
              backgroundColor: selected ? colors.text : colors.bg,
            }}
          >
            {p.id === 'all' ? null : <PersonChip person={p} />}
            <Text style={{ color: selected ? colors.bg : colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>
              {p.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  /** One meal tile; tap toggles that person (or everyone) out. */
  const tile = (day: number, slot: MealSlot) => {
    const past = isPastDay(weekIso, day);
    if (person) {
      const out = isAway(absences, day, slot, person.id);
      const school = out && isSchool(day, slot, person.id);
      const label = out ? (school ? t.tileSchool : t.tileOut) : t.tileHome;
      return (
        <Pressable
          key={slot}
          disabled={past}
          accessibilityRole="switch"
          accessibilityState={{ checked: out, disabled: past }}
          accessibilityLabel={fmt(t.personA11y, {
            name: person.name,
            day: d.common.days[day],
            slot: slotLabel(slot),
            state: out ? t.away : t.home,
          })}
          onPress={() => onChange([{ day, slot, personId: person.id, away: !out }])}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 54,
            borderRadius: radius.card,
            paddingHorizontal: 10,
            justifyContent: 'center',
            backgroundColor: school ? colors.bgGrouped : out ? colors.text : pressed ? colors.cardPressed : colors.bgGrouped,
            borderWidth: school ? 1 : 0,
            borderColor: colors.saffron,
          })}
        >
          <Text style={{ color: out && !school ? colors.bg : colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.meta }}>
            {slotLabel(slot)}
          </Text>
          <Text
            style={{
              color: out && !school ? colors.bg : school ? colors.saffron : colors.text,
              fontFamily: out ? fonts.uiSemi : fonts.ui,
              fontSize: fontSize.small,
            }}
          >
            {label}
          </Text>
        </Pressable>
      );
    }
    // Everyone tab: faces of who's home; tap = everyone out (or back home).
    const out = everyoneAway(absences, day, slot, eaterIds);
    const away = awayIds(absences, day, slot);
    return (
      <Pressable
        key={slot}
        disabled={past}
        accessibilityRole="switch"
        accessibilityState={{ checked: out, disabled: past }}
        accessibilityLabel={fmt(t.everyoneOutA11y, { day: d.common.days[day], slot: slotLabel(slot) })}
        onPress={() =>
          onChange(eaterIds.filter((id) => away.has(id) === out).map((personId) => ({ day, slot, personId, away: !out })))
        }
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 54,
          borderRadius: radius.card,
          paddingHorizontal: 10,
          justifyContent: 'center',
          gap: 3,
          backgroundColor: out ? colors.text : pressed ? colors.cardPressed : colors.bgGrouped,
        })}
      >
        <Text style={{ color: out ? colors.bg : colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.meta }}>
          {slotLabel(slot)}
        </Text>
        {out ? (
          <Text style={{ color: colors.bg, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>{t.goingOut}</Text>
        ) : (
          <View style={{ flexDirection: 'row', gap: 3 }}>
            {eaters.map((p) => (
              <View key={p.id} style={{ transform: [{ scale: 0.75 }], margin: -4 }}>
                <PersonChip person={p} hollow={away.has(p.id)} />
              </View>
            ))}
          </View>
        )}
      </Pressable>
    );
  };

  const calendar = (
    <View style={{ gap: 6 }}>
      {WEEK_DAYS.map((day) => (
        <View
          key={day}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: isPastDay(weekIso, day) ? 0.45 : 1 }}
        >
          <Text style={{ width: 44, color: colors.text, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
            {shortDay(day)}
          </Text>
          {WEEK_SLOTS.map((slot) => tile(day, slot))}
        </View>
      ))}
    </View>
  );

  const personChips = () => {
    if (!person) return null;
    const weekdayLunches = cellsFor(futureDays.filter((day) => day <= 4), ['lunch']);
    const weekend = cellsFor(futureDays.filter((day) => day >= 5));
    const schoolCells = cellsFor(
      futureDays.filter((day) => (SCHOOL_LUNCH_DAYS as readonly number[]).includes(day)),
      ['lunch']
    );
    const sameAsLast = async () => {
      if (!loadLastWeek) return;
      const last = await loadLastWeek();
      const changes = copyLastWeek(absences, last, person.id, futureDays);
      if (!last.some((a) => a.person_id === person.id) && changes.length === 0) setHint(t.nothingLastWeek);
      else setHint(null);
      onChange(changes);
    };
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {schoolChild?.id === person.id && schoolCells.length > 0
          ? chip(
              fmt(t.schoolChip, { name: person.name, days: SCHOOL_LUNCH_DAYS.map(shortDay).join(' ') }),
              patternOn(absences, person.id, schoolCells),
              () => onChange(togglePattern(absences, person.id, schoolCells))
            )
          : null}
        {weekdayLunches.length > 0
          ? chip(t.everyWeekdayLunch, patternOn(absences, person.id, weekdayLunches), () =>
              onChange(togglePattern(absences, person.id, weekdayLunches))
            )
          : null}
        {weekend.length > 0
          ? chip(t.theWeekend, patternOn(absences, person.id, weekend), () =>
              onChange(togglePattern(absences, person.id, weekend))
            )
          : null}
        {loadLastWeek && futureDays.length > 0 ? chip(t.sameAsLastWeek, false, () => void sameAsLast()) : null}
      </View>
    );
  };

  const summary = () => {
    const thin = thinnerMeals(absences, eaterIds);
    const nameOf = (id: string) => eaters.find((p) => p.id === id)?.name ?? '';
    return (
      <View style={{ gap: 4 }}>
        {eaters.map((p) => {
          const out = mealsOut(absences, p.id);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              onPress={() => setTab(p.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: 52,
                paddingVertical: 6,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                backgroundColor: pressed ? colors.cardPressed : 'transparent',
              })}
            >
              <PersonChip person={p} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>{p.name}</Text>
                <Text numberOfLines={2} style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.meta }}>
                  {out.length === 0 ? t.homeAllWeek : out.map(mealLabel).join(' · ')}
                </Text>
              </View>
              {out.length > 0 ? (
                <Text
                  style={{
                    color: colors.textMuted,
                    fontFamily: fonts.uiSemi,
                    fontSize: 11,
                    backgroundColor: colors.bgGrouped,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 10,
                    overflow: 'hidden',
                  }}
                >
                  {fmt(t.outCount, { n: out.length })}
                </Text>
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          );
        })}
        <Text
          style={{
            marginTop: 12,
            color: colors.textMuted,
            fontFamily: fonts.uiSemi,
            fontSize: 11,
            letterSpacing: 1.2,
          }}
        >
          {t.fewerPeople.toUpperCase()}
        </Text>
        {thin.length === 0 ? (
          <Muted>{t.allHomeYet}</Muted>
        ) : (
          thin.map((c) => (
            <Text key={`${c.day}-${c.slot}`} style={{ color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small, lineHeight: 24 }}>
              {`${mealLabel(c)} · ${
                c.home.length === 0
                  ? t.nobodyHome
                  : c.home.length === 1
                    ? fmt(t.onlyNames, { names: nameOf(c.home[0]!) })
                    : fmt(t.nOfM, { n: c.home.length, m: eaterIds.length })
              }`}
            </Text>
          ))
        )}
      </View>
    );
  };

  const outNow = person ? mealsOut(absences, person.id).length : 0;

  return (
    <WeekSheet visible={visible} onClose={onClose} title={t.homeTitle} footer={<Button label={t.done} onPress={onClose} />}>
      {tabs}
      {person ? (
        <>
          {personChips()}
          {hint ? <Muted>{hint}</Muted> : null}
          {calendar}
          <Muted>
            {`${fmt(t.personOutLine, { name: person.name, n: outNow, total: 14 })}. ${fmt(t.tapMealPerson, { name: person.name })}`}
          </Muted>
        </>
      ) : (
        <>
          {summary()}
          {calendar}
          <Muted>{t.tapMealEveryone}</Muted>
        </>
      )}
    </WeekSheet>
  );
}
