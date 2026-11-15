import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { shareEmployeeLink } from '@/lib/employee-link';
import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, radius, useTheme } from '@/lib/theme';

/** "The plan is live" card shown right after the AI planner approves a week. */
export function LiveCard({
  summary,
  employee,
  onGroceries,
  onDismiss,
}: {
  summary: { meals: number; employee: number };
  employee: { name: string; share_token?: string | null } | null;
  onGroceries: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const t = d.aiPlan;
  const body =
    employee && summary.employee > 0
      ? fmt(t.liveBody, { meals: summary.meals, n: summary.employee, name: employee.name })
      : fmt(t.liveBodyNoEmployee, { meals: summary.meals });
  const button = (label: string, onPress: () => void, primary: boolean) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 44,
        borderRadius: radius.card,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? colors.bg : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: colors.textMuted,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: primary ? colors.text : colors.bg, fontFamily: primary ? fonts.uiSemi : fonts.ui, fontSize: fontSize.small }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ backgroundColor: colors.text, borderRadius: radius.card * 1.5, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colors.bg, fontFamily: fonts.uiSemi, fontSize: fontSize.base }}>{t.liveTitle}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t.dismissA11y} onPress={onDismiss} hitSlop={8}>
          <Ionicons name="close" size={18} color={colors.bg} />
        </Pressable>
      </View>
      <Text style={{ color: colors.bg, opacity: 0.8, fontFamily: fonts.ui, fontSize: fontSize.small, lineHeight: 20 }}>{body}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {employee?.share_token && summary.employee > 0
          ? button(fmt(t.sendLink, { name: employee.name }), () => void shareEmployeeLink(employee.share_token!, d.common.linkCopied), true)
          : null}
        {button(t.groceries, onGroceries, !(employee?.share_token && summary.employee > 0))}
      </View>
    </View>
  );
}
