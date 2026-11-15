import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmt, useI18n } from '@/lib/i18n';
import { fonts, fontSize, minTapTarget, screenPadding, useTheme } from '@/lib/theme';
import { languageDisplayName, nativeLanguageName, type LanguageOption } from '@/lib/translations';

/**
 * 36px translate chip overlaid on the recipe photo, under the bookmark chip.
 * Ringed in the accent color while a translation (not the original) shows.
 */
export function LanguageChip({
  translated,
  languageName,
  onPress,
  style,
}: {
  translated: boolean;
  /** Name of the language on screen, for the accessibility label. */
  languageName: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fmt(d.recipe.languageA11y, { language: languageName })}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          position: 'absolute',
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.card,
          borderWidth: translated ? 2 : 1,
          borderColor: translated ? colors.accent : colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <Ionicons name="language-outline" size={18} color={translated ? colors.accent : colors.text} />
    </Pressable>
  );
}

/** Bottom sheet: read the recipe in its original language or any translation. */
export function LanguageSheet({
  visible,
  options,
  activeCode,
  onSelect,
  onClose,
}: {
  visible: boolean;
  options: LanguageOption[];
  /** Code of the language on screen (an option's `code`). */
  activeCode: string;
  onSelect: (option: LanguageOption) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { d, locale } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={d.common.close}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        onPress={onClose}
      />
      <View
        style={{
          backgroundColor: colors.bg,
          paddingHorizontal: screenPadding,
          paddingTop: 10,
          paddingBottom: insets.bottom + 20,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: '80%',
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 40,
            height: 5,
            borderRadius: 3,
            backgroundColor: colors.border,
            marginBottom: 12,
          }}
        />
        <Text style={{ color: colors.text, fontSize: fontSize.dayName, fontFamily: fonts.display }}>
          {d.recipe.languageTitle}
        </Text>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.meta,
            fontFamily: fonts.ui,
            marginTop: 4,
            marginBottom: 8,
          }}
        >
          {d.recipe.languageHint}
        </Text>
        <ScrollView bounces={false}>
          {options.map((option, i) => {
            const active = option.code === activeCode;
            const native = option.original && option.code === 'original'
              ? d.recipe.languageOriginal
              : nativeLanguageName(option.code);
            const inViewerLocale = option.code === 'original' ? null : languageDisplayName(option.code, locale);
            const sub = option.original
              ? d.recipe.languageAsWritten
              : !option.available
                ? d.recipe.languageNotReady
                : inViewerLocale && inViewerLocale !== native
                  ? inViewerLocale
                  : null;
            return (
              <Pressable
                key={option.code}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: !option.available }}
                disabled={!option.available}
                onPress={() => onSelect(option)}
                style={({ pressed }) => ({
                  minHeight: minTapTarget + 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 10,
                  borderBottomWidth: i === options.length - 1 ? 0 : 1,
                  borderBottomColor: colors.border,
                  backgroundColor: pressed ? colors.cardPressed : 'transparent',
                  opacity: option.available ? 1 : 0.5,
                })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: colors.text, fontSize: fontSize.cardTitle, fontFamily: fonts.uiSemi }}>
                      {native}
                    </Text>
                    {option.original && option.code !== 'original' ? (
                      <View
                        style={{
                          backgroundColor: colors.bgGrouped,
                          borderRadius: 6,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}
                      >
                        <Text
                          style={{
                            color: colors.textMuted,
                            fontSize: 11,
                            letterSpacing: 0.4,
                            textTransform: 'uppercase',
                            fontFamily: fonts.uiSemi,
                          }}
                        >
                          {d.recipe.languageOriginal}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {sub ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.ui }}>
                      {sub}
                    </Text>
                  ) : null}
                </View>
                {active ? <Ionicons name="checkmark" size={22} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.meta,
            fontFamily: fonts.ui,
            textAlign: 'center',
            marginTop: 12,
          }}
        >
          {d.recipe.languageAiNote}
        </Text>
      </View>
    </Modal>
  );
}
