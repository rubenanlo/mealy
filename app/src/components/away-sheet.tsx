import { useMemo } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PersonLike } from '@/components/person-chip';
import { Eyebrow, Muted, Title } from '@/components/ui';
import { fmt, useI18n } from '@/lib/i18n';
import { awayIds, type MealSlot, type PlanAbsence } from '@/lib/plan';
import { fonts, fontSize, minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';

/**
 * "Who eats away?" — set per-meal absences for one day BEFORE dishes are
 * picked. One row per household eater, one toggle pill per slot; every tap
 * persists immediately (the parent owns the write).
 */
export function AwaySheet({
  visible,
  day,
  dayLabel,
  eaters,
  absences,
  onToggle,
  onClose,
}: {
  visible: boolean;
  day: number;
  dayLabel: string;
  eaters: PersonLike[];
  absences: PlanAbsence[];
  onToggle: (day: number, slot: MealSlot, personId: string, away: boolean) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const awayBySlot = useMemo(
    () => ({
      lunch: awayIds(absences, day, 'lunch'),
      dinner: awayIds(absences, day, 'dinner'),
    }),
    [absences, day]
  );
  const slotLabel = (slot: MealSlot) => (slot === 'lunch' ? d.common.lunch : d.common.dinner);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={d.common.close}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
        onPress={onClose}
      />
      <View
        style={{
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.card * 2,
          borderTopRightRadius: radius.card * 2,
        }}
      >
        <SafeAreaView edges={['bottom']}>
          <View style={{ padding: screenPadding, gap: 14 }}>
            <View style={{ gap: 2 }}>
              <Title>{d.plan.whoEatsAway}</Title>
              <Muted>{dayLabel}</Muted>
            </View>
            <Muted>{d.plan.eatsAwayHint}</Muted>

            {eaters.map((person) => (
              <View
                key={person.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: minTapTarget,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    color: colors.text,
                    fontSize: fontSize.base,
                    fontFamily: fonts.uiMedium,
                  }}
                >
                  {person.name}
                </Text>
                {(['lunch', 'dinner'] as const).map((slot) => {
                  const away = awayBySlot[slot].has(person.id);
                  return (
                    <Pressable
                      key={slot}
                      accessibilityRole="button"
                      accessibilityState={{ selected: away }}
                      accessibilityLabel={fmt(d.plan.awayToggleA11y, {
                        name: person.name,
                        slot: slotLabel(slot),
                      })}
                      onPress={() => onToggle(day, slot, person.id, !away)}
                      style={({ pressed }) => ({
                        minHeight: 34,
                        paddingHorizontal: 12,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: away ? colors.accent : colors.border,
                        backgroundColor: away ? colors.accent : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text
                        style={{
                          color: away ? colors.accentText : colors.textMuted,
                          fontSize: fontSize.meta,
                          fontFamily: fonts.uiSemi,
                        }}
                      >
                        {slotLabel(slot)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {eaters.length === 0 ? <Eyebrow>{d.plan.wholeHousehold}</Eyebrow> : null}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
