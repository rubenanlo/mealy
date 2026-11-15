import { Pressable, Text, View } from 'react-native';

import { Button, Eyebrow, Muted } from '@/components/ui';
import { Badge, WeekSheet } from '@/components/week/sheet';
import { useI18n } from '@/lib/i18n';
import { fonts, fontSize, useTheme } from '@/lib/theme';

export interface PastDish {
  title: string;
  recipeId: string | null;
  employee: boolean;
}

export interface PastDay {
  day: number;
  /** Short weekday, e.g. "Mon". */
  label: string;
  lunch: PastDish | null;
  dinner: PastDish | null;
}

/**
 * A past week at a glance: category counts, each day's lunch and dinner
 * (tap a dish for its recipe), the employee's instructions that week, and
 * ways to reuse, open or delete it.
 */
export function PastWeekSheet({
  visible,
  title,
  subtitle,
  tally,
  days,
  notes,
  busy,
  onOpenRecipe,
  onCopy,
  onOpenWeek,
  onDelete,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  tally: string[];
  days: PastDay[];
  notes: string[];
  busy: boolean;
  onOpenRecipe: (recipeId: string) => void;
  onCopy: () => void;
  onOpenWeek: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.planHome;

  const dish = (value: PastDish | null, muted: boolean) => {
    if (!value) return <Text style={{ color: colors.textMuted, fontSize: fontSize.small }}>—</Text>;
    const label = (
      <Text
        style={{
          color: muted ? colors.textMuted : colors.text,
          fontFamily: fonts.ui,
          fontSize: fontSize.small,
          textDecorationLine: value.recipeId ? 'underline' : 'none',
          textDecorationColor: colors.border,
        }}
      >
        {value.title}
      </Text>
    );
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        {value.recipeId ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => onOpenRecipe(value.recipeId!)}
            hitSlop={6}
            style={{ flexShrink: 1 }}
          >
            {label}
          </Pressable>
        ) : (
          label
        )}
        {value.employee ? <Badge label={d.weekPage.employee} /> : null}
      </View>
    );
  };

  return (
    <WeekSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        <View style={{ gap: 10 }}>
          <Button label={t.copyToWeek} onPress={onCopy} disabled={busy} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={t.openWeek} kind="secondary" onPress={onOpenWeek} style={{ flex: 1 }} />
            <Button label={d.common.delete} kind="danger" onPress={onDelete} style={{ flex: 1 }} />
          </View>
        </View>
      }
    >
      {tally.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {tally.map((label) => (
            <Badge key={label} label={label} />
          ))}
        </View>
      ) : null}
      <View style={{ gap: 2 }}>
        {days.map((row) => (
          <View key={row.day} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 }}>
            <Text
              style={{
                width: 44,
                color: colors.textMuted,
                fontFamily: fonts.uiSemi,
                fontSize: 11,
                letterSpacing: 1.2,
                paddingTop: 2,
              }}
            >
              {row.label.toUpperCase()}
            </Text>
            <View style={{ flex: 1, gap: 4 }}>
              {dish(row.lunch, false)}
              {dish(row.dinner, true)}
            </View>
          </View>
        ))}
      </View>
      {notes.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Eyebrow>{t.notesThatWeek}</Eyebrow>
          <Muted>{notes.join(' · ')}</Muted>
        </View>
      ) : null}
    </WeekSheet>
  );
}
