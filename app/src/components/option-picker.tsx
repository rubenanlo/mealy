import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { setOptionPresenter, type PickRequest } from '@/lib/options';
import { fonts, fontSize, radius, useTheme } from '@/lib/theme';

const MENU_WIDTH = 260;
const MARGIN = 12;

/**
 * Web dropdown menu behind lib/options.ts pickOption(). Mount once next to
 * ConfirmHost; native never presents here (pickOption uses Alert.alert).
 * Anchored at the press point when the caller provides one, else centered.
 */
export function OptionPickerHost() {
  const { colors } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();
  const [req, setReq] = useState<PickRequest | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    setOptionPresenter((r) => setReq(r));
    return () => setOptionPresenter(null);
  }, []);

  if (!req) return null;

  const close = () => setReq(null);
  const { anchor } = req;
  const left = anchor
    ? Math.max(MARGIN, Math.min(anchor.x, winW - MENU_WIDTH - MARGIN))
    : (winW - MENU_WIDTH) / 2;
  // Lower-screen anchors open upward so the menu stays on screen.
  const openBelow = !anchor || anchor.y < winH * 0.6;
  const vertical = anchor
    ? openBelow
      ? { top: anchor.y + 10 }
      : { bottom: winH - anchor.y + 10 }
    : { top: winH * 0.3 };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable accessibilityLabel={req.cancelLabel} onPress={close} style={{ flex: 1 }}>
        <Pressable
          onPress={() => {}}
          style={{
            position: 'absolute',
            left,
            width: MENU_WIDTH,
            maxHeight: winH * 0.6,
            backgroundColor: colors.card,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.border,
            paddingVertical: 6,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 8 },
            ...vertical,
          }}
        >
          <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4, gap: 2 }}>
            <Text
              numberOfLines={2}
              style={{ color: colors.text, fontSize: fontSize.meta, fontFamily: fonts.uiSemi }}
            >
              {req.title}
            </Text>
            {req.message ? (
              <Text style={{ color: colors.textMuted, fontSize: fontSize.meta, fontFamily: fonts.uiMedium }}>
                {req.message}
              </Text>
            ) : null}
          </View>
          <ScrollView style={{ flexGrow: 0 }}>
            {req.options.map((option, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: !!option.checked }}
                onPress={() => {
                  close();
                  option.onPress();
                }}
                style={({ pressed }) => ({
                  minHeight: 44,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  paddingHorizontal: 14,
                  backgroundColor: pressed ? colors.cardPressed : 'transparent',
                })}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    flexShrink: 1,
                    color: option.destructive ? colors.danger : colors.text,
                    fontSize: fontSize.base,
                    fontFamily: option.checked ? fonts.uiSemi : fonts.uiMedium,
                  }}
                >
                  {option.label}
                </Text>
                {option.checked ? (
                  <Ionicons name="checkmark" size={18} color={colors.accent} />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
