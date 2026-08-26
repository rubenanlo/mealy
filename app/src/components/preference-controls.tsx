import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Body, Button, Eyebrow, Field, Muted } from '@/components/ui';
import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, useTheme } from '@/lib/theme';

/** 0–7 stepper for weekly counts; `allowNull` lets max step past 7 to ∞. */
export function Stepper({
  value,
  onChange,
  allowNull,
  label,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  /** For max bounds: stepping past 7 yields null (no limit, shown ∞). */
  allowNull?: boolean;
  label: string;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const dec = () => {
    if (value === null) onChange(7);
    else if (value > 0) onChange(value - 1);
  };
  const inc = () => {
    if (value === null) return;
    if (value >= 7) onChange(allowNull ? null : 7);
    else onChange(value + 1);
  };
  const buttonStyle = (pressed: boolean) => ({
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: pressed ? colors.cardPressed : 'transparent',
  });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fmt(d.mealPrefs.decrease, { label })}
        onPress={dec}
        hitSlop={8}
        style={({ pressed }) => buttonStyle(pressed)}
      >
        <Ionicons name="remove" size={18} color={colors.text} />
      </Pressable>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.base,
          fontFamily: fonts.uiSemi,
          fontVariant: ['tabular-nums'],
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {value === null ? '∞' : value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fmt(d.mealPrefs.increase, { label })}
        onPress={inc}
        hitSlop={8}
        style={({ pressed }) => buttonStyle(pressed)}
      >
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

/** Chip list + add field for free-text values (allergens, dislikes). */
export function TagEditor({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft('');
  };
  return (
    <View style={{ gap: 10 }}>
      <Eyebrow>{label}</Eyebrow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {values.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={fmt(d.person.removeValue, { value })}
            onPress={() => onChange(values.filter((v) => v !== value))}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: pressed ? colors.cardPressed : 'transparent',
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 999,
              paddingHorizontal: 12,
              minHeight: 40,
            })}
          >
            <Text style={{ color: colors.text, fontSize: fontSize.small, fontFamily: fonts.ui }}>
              {value}
            </Text>
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
        {values.length === 0 ? <Muted>{d.person.none}</Muted> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          style={{ flex: 1 }}
          onSubmitEditing={add}
        />
        <Button label={d.common.add} kind="secondary" onPress={add} />
      </View>
    </View>
  );
}

/** Row label used by the quota steppers on the per-person preferences page. */
export function QuotaRow({
  label,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  min: number | null;
  max: number | null;
  onMin: (v: number | null) => void;
  onMax: (v: number | null) => void;
}) {
  const { d } = useI18n();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 56,
        paddingHorizontal: 16,
      }}
    >
      <Body style={{ flex: 1 }}>{label}</Body>
      <Stepper value={min} label={fmt(d.mealPrefs.minimumOf, { label })} onChange={onMin} />
      <Muted>–</Muted>
      <Stepper
        value={max}
        allowNull
        label={fmt(d.mealPrefs.maximumOf, { label })}
        onChange={onMax}
      />
    </View>
  );
}
