import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Modal, PanResponder, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/ui';
import { clampFocal, focalToContentPosition, type CoverFocal } from '@/lib/cover-focal';
import { useImageUrl } from '@/lib/media';
import { screenPadding, useTheme } from '@/lib/theme';

/** Notion-style free X/Y cover reposition (spec Part 4). Drag moves the
 *  visible window; Save persists {x,y} in 0..1. */
export function CoverRepositionModal({
  visible,
  path,
  focal,
  onSave,
  onClose,
}: {
  visible: boolean;
  path: string;
  focal: CoverFocal | null;
  onSave: (focal: CoverFocal) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const frameW = width - screenPadding * 2;
  const frameH = (frameW * 3) / 4;
  const url = useImageUrl(path);
  const [current, setCurrent] = useState<CoverFocal>(focal ?? { x: 0.5, y: 0.5 });
  // The PanResponder below is created exactly once, so its callbacks must not
  // close over React state (a closure would be frozen at mount and every later
  // drag would restart from the mount-time focal). Mirror the live values into
  // refs each render and read only refs inside the responder.
  const currentRef = useRef(current);
  currentRef.current = current;
  const frameRef = useRef({ w: frameW, h: frameH });
  frameRef.current = { w: frameW, h: frameH };
  const startRef = useRef<CoverFocal>(current);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // Grant-time base = the focal as of this touch-down, not mount.
        startRef.current = currentRef.current;
      },
      onPanResponderMove: (_evt, g) => {
        // Dragging the image right shows more of its left side → focal decreases.
        setCurrent(
          clampFocal({
            x: startRef.current.x - g.dx / frameRef.current.w,
            y: startRef.current.y - g.dy / frameRef.current.h,
          })
        );
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: screenPadding, gap: 16 }}>
        <View
          {...pan.panHandlers}
          style={{ width: frameW, height: frameH, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.cardPressed }}
        >
          {url ? (
            <Image
              source={{ uri: url }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              contentPosition={focalToContentPosition(current)}
            />
          ) : null}
        </View>
        <Button label="Save position" onPress={() => onSave(current)} />
        <Button label="Cancel" kind="secondary" onPress={onClose} />
      </View>
    </Modal>
  );
}
