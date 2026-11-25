import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { WeekSheet } from '@/components/week/sheet';
import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, minTapTarget, radius, useTheme } from '@/lib/theme';
import type { WeekDeleteSummary } from '@/lib/week-delete';

/**
 * Confirm deleting a whole week's plan (design A+1, 2026-11-25): lists what
 * goes, warns when the employee's page empties, and offers to remove the
 * week's ideas too (they are kept by default).
 */
export function DeleteWeekSheet({
  visible,
  weekLabel,
  summary,
  employeeName,
  busy,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  /** "23 – 29 Nov" */
  weekLabel: string;
  summary: WeekDeleteSummary;
  employeeName: string | null;
  busy: boolean;
  onConfirm: (removeIdeas: boolean) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.weekPage;
  const [removeIdeas, setRemoveIdeas] = useState(false);
  useEffect(() => {
    if (visible) setRemoveIdeas(false);
  }, [visible]);

  const count = (n: number, one: string, many: string) => (n === 1 ? one : fmt(many, { n }));
  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [];
  if (summary.meals > 0) rows.push({ icon: 'calendar-outline', label: count(summary.meals, t.delMealOne, t.delMealMany) });
  if (summary.eatingOut > 0)
    rows.push({
      icon: 'people-outline',
      label: fmt(summary.eatingOutPeople === 1 ? t.delOutOne : t.delOutMany, {
        n: summary.eatingOutPeople,
        meals: count(summary.eatingOut, t.delMealOne, t.delMealMany),
      }),
    });
  if (employeeName && (summary.employeeMeals > 0 || summary.tasks > 0)) {
    const parts = [
      summary.employeeMeals > 0 ? count(summary.employeeMeals, t.delEmployeeMealOne, t.delEmployeeMealMany) : null,
      summary.tasks > 0 ? count(summary.tasks, t.delTaskOne, t.delTaskMany) : null,
    ].filter(Boolean);
    rows.push({
      icon: 'checkbox-outline',
      label: `${fmt(t.delEmployee, { name: employeeName })} (${parts.join(', ')})`,
    });
  }

  return (
    <WeekSheet
      visible={visible}
      onClose={onClose}
      title={fmt(t.delTitle, { week: weekLabel })}
      subtitle={t.delKeep}
      footer={
        <>
          <Button label={t.delConfirm} kind="danger" loading={busy} onPress={() => onConfirm(removeIdeas)} />
          <Button label={t.delCancel} kind="secondary" onPress={onClose} />
        </>
      }
    >
      {rows.length > 0 ? (
        <View style={{ borderRadius: radius.card * 1.5, backgroundColor: colors.bgGrouped, paddingHorizontal: 14 }}>
          {rows.map((row, i) => (
            <View
              key={row.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 11,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.border,
              }}
            >
              <Ionicons name={row.icon} size={18} color={colors.text} />
              <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small }}>
                {row.label}
              </Text>
              <Text style={{ color: colors.textMuted, fontFamily: fonts.ui, fontSize: fontSize.meta }}>
                {t.delRemoved}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {summary.warnEmployee && employeeName ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            alignItems: 'flex-start',
            padding: 12,
            borderRadius: radius.card * 1.5,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Ionicons name="warning-outline" size={18} color={colors.saffron} />
          <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small, lineHeight: 19 }}>
            {fmt(t.delWarn, { name: employeeName })}
          </Text>
        </View>
      ) : null}

      {summary.ideas > 0 ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: removeIdeas }}
          onPress={() => setRemoveIdeas((v) => !v)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            minHeight: minTapTarget,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons
            name={removeIdeas ? 'checkbox' : 'square-outline'}
            size={22}
            color={removeIdeas ? colors.text : colors.textMuted}
          />
          <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small }}>
            {count(summary.ideas, t.delIdeaOne, t.delIdeaMany)}
          </Text>
        </Pressable>
      ) : null}
    </WeekSheet>
  );
}
