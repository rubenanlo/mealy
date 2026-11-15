import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { RecipeImage } from '@/components/recipe-cards';
import { Button, Eyebrow, Field, Muted } from '@/components/ui';
import { Badge, WeekSheet } from '@/components/week/sheet';
import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, minTapTarget, radius, useTheme } from '@/lib/theme';

export interface ReviewItem {
  id: string;
  /** "Mon · Lunch" */
  heading: string;
  title: string;
  coverPath: string | null;
  part: boolean;
  note: string | null;
}

/**
 * Review, hand off and approve (design A): the week's tally, what the
 * employee prepares (whole dish or part, with notes), her other tasks for
 * the week, then one button. Also the place to re-send her link later.
 */
export function ReviewSheet({
  visible,
  approved,
  mealsCount,
  tally,
  employeeName,
  canSend,
  items,
  tasks,
  busy,
  onTasksChange,
  onOpenItem,
  onApprove,
  onSendLink,
  onClose,
}: {
  visible: boolean;
  approved: boolean;
  mealsCount: number;
  tally: string[];
  /** Null when the household has no employee. */
  employeeName: string | null;
  canSend: boolean;
  items: ReviewItem[];
  tasks: string[];
  busy: boolean;
  onTasksChange: (next: string[]) => void;
  onOpenItem: (id: string) => void;
  onApprove: (send: boolean) => void;
  onSendLink: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.weekPage;
  const [draft, setDraft] = useState('');

  const addTask = () => {
    const task = draft.trim();
    if (!task) return;
    onTasksChange([...tasks, task]);
    setDraft('');
  };

  const footer = approved ? (
    canSend && employeeName ? (
      <Button label={fmt(t.sendLink, { name: employeeName })} onPress={onSendLink} />
    ) : (
      <Button label={t.done} onPress={onClose} />
    )
  ) : (
    <>
      <Button label={t.approve} onPress={() => onApprove(false)} loading={busy} />
      {canSend && employeeName ? (
        <Button
          label={fmt(t.approveSend, { name: employeeName })}
          kind="secondary"
          onPress={() => onApprove(true)}
          disabled={busy}
        />
      ) : null}
    </>
  );

  return (
    <WeekSheet
      visible={visible}
      onClose={onClose}
      title={approved ? t.approvedTitle : t.reviewTitle}
      footer={footer}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Badge label={fmt(t.mealsCount, { n: mealsCount })} />
        {tally.map((label) => (
          <Badge key={label} label={label} />
        ))}
      </View>

      {employeeName ? (
        <>
          <Eyebrow>{fmt(t.prepares, { name: employeeName, n: items.length })}</Eyebrow>
          {items.length === 0 ? <Muted>{fmt(t.nothingFor, { name: employeeName })}</Muted> : null}
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => onOpenItem(item.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: minTapTarget,
                borderRadius: radius.card,
                backgroundColor: pressed ? colors.cardPressed : 'transparent',
              })}
            >
              <RecipeImage path={item.coverPath} style={{ width: 40, height: 40, borderRadius: radius.thumb }} iconSize={16} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.uiMedium, fontSize: fontSize.small }}>
                  {`${item.title} · ${item.heading}`}
                </Text>
                <Muted numberOfLines={2}>
                  {item.part
                    ? fmt(t.partLine, { note: item.note ?? '' })
                    : item.note
                      ? `${t.wholeDish} · ${item.note}`
                      : t.wholeDish}
                </Muted>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))}

          <Eyebrow>{t.tasks}</Eyebrow>
          {tasks.map((task, i) => (
            <View key={`${task}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
              <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.textMuted }} />
              <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.small }}>{task}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={fmt(t.removeTaskA11y, { task })}
                onPress={() => onTasksChange(tasks.filter((_, j) => j !== i))}
                hitSlop={10}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Field
              value={draft}
              onChangeText={setDraft}
              placeholder={t.taskPlaceholder}
              onSubmitEditing={addTask}
              returnKeyType="done"
              style={{ flex: 1 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.addTask}
              onPress={addTask}
              disabled={!draft.trim()}
              style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center', opacity: draft.trim() ? 1 : 0.4 }}
            >
              <Ionicons name="add-circle" size={30} color={colors.accent} />
            </Pressable>
          </View>
        </>
      ) : null}
    </WeekSheet>
  );
}
