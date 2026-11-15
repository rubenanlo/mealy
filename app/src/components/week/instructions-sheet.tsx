import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Field, Muted } from '@/components/ui';
import { WeekSheet } from '@/components/week/sheet';
import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, minTapTarget, useTheme } from '@/lib/theme';

/**
 * Edit the employee's instructions for a week: remove a line, add one, or
 * bring back last week's in one tap. "Done" (or closing) saves.
 */
export function InstructionsSheet({
  visible,
  title,
  subtitle,
  notes,
  carryOver,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  notes: string[];
  /** Last week's lines that are not on this week's list. */
  carryOver: string[];
  onSave: (next: string[]) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.planHome;
  const [draft, setDraft] = useState<string[]>(notes);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!visible) return;
    setDraft(notes);
    setText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pending = carryOver.filter((n) => !draft.includes(n));
  const add = () => {
    const line = text.trim();
    if (!line) return;
    setDraft((prev) => [...prev, line]);
    setText('');
  };
  const finish = () => {
    const line = text.trim();
    onSave(line ? [...draft, line] : draft);
  };

  return (
    <WeekSheet
      visible={visible}
      onClose={finish}
      title={title}
      subtitle={subtitle}
      footer={<Button label={d.weekPage.done} onPress={finish} />}
    >
      {draft.length === 0 ? <Muted>{t.noInstructions}</Muted> : null}
      <View>
        {draft.map((line, i) => (
          <View
            key={`${i}-${line}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: minTapTarget,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: fontSize.base }}>{line}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fmt(t.removeA11y, { text: line })}
              hitSlop={8}
              onPress={() => setDraft((prev) => prev.filter((_, j) => j !== i))}
              style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}
      </View>
      <Field
        value={text}
        onChangeText={setText}
        placeholder={t.instructionsPlaceholder}
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={add}
      />
      {pending.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setDraft((prev) => [...prev, ...pending])}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="refresh" size={16} color={colors.accent} />
          <Text style={{ flex: 1, color: colors.accent, fontFamily: fonts.uiSemi, fontSize: fontSize.small }}>
            {fmt(t.addLastWeeks, { list: pending.join(', ') })}
          </Text>
        </Pressable>
      ) : null}
    </WeekSheet>
  );
}
