import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/lib/i18n';
import { useImageUrl } from '@/lib/media';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

// Web paging: pagingEnabled and momentum events don't exist there, so the
// gallery snaps via CSS scroll-snap and tracks the index with onScroll.
const WEB_SNAP_CONTAINER =
  Platform.OS === 'web' ? ({ scrollSnapType: 'x mandatory' } as unknown as ViewStyle) : undefined;
const WEB_SNAP_PAGE =
  Platform.OS === 'web' ? ({ scrollSnapAlign: 'start' } as unknown as ViewStyle) : undefined;

/**
 * A single full-screen, pinch-to-zoom / pan image page. Reports its zoom state
 * up so the parent can lock horizontal paging while the image is magnified
 * (otherwise swipe-to-pan and swipe-to-page fight each other). A single tap on
 * an un-zoomed image dismisses the viewer.
 */
function ZoomableImage({
  path,
  width,
  height,
  onZoomChange,
  onRequestClose,
}: {
  path: string;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
  onRequestClose: () => void;
}) {
  const url = useImageUrl(path);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  // Pan must be dead while un-zoomed: an always-active pan wins the gesture
  // race against the paging ScrollView and horizontal swipes go nowhere.
  const [panEnabled, setPanEnabled] = useState(false);

  const setZoom = (zoomedNow: boolean) => {
    setPanEnabled(zoomedNow);
    onZoomChange(zoomedNow);
  };

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        reset();
        runOnJS(setZoom)(false);
      } else {
        runOnJS(setZoom)(true);
      }
    });

  const pan = Gesture.Pan()
    .enabled(panEnabled)
    .averageTouches(true)
    .onUpdate((e) => {
      if (scale.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        reset();
        runOnJS(setZoom)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
        runOnJS(setZoom)(true);
      }
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      if (scale.value <= 1) runOnJS(onRequestClose)();
    });

  // Pan/pinch run together; taps are exclusive (double beats single).
  const gesture = Gesture.Simultaneous(
    Gesture.Race(pan, pinch),
    Gesture.Exclusive(doubleTap, singleTap)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    // pan-x lets mobile-web horizontal swipes reach the gallery scroller
    // (the default touch-action: none swallows them); taps still zoom/close.
    <GestureDetector gesture={gesture} touchAction="pan-x">
      <Animated.View
        style={[{ width, height, alignItems: 'center', justifyContent: 'center' }, animatedStyle]}
      >
        {url ? (
          <Image source={{ uri: url }} style={{ width, height }} contentFit="contain" />
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Full-screen source-image viewer: swipe between images, pinch / double-tap to
 * zoom, single-tap or the close button to dismiss. Rendered in a native Modal
 * over a black backdrop.
 */
export function ImageLightbox({
  visible,
  paths,
  initialIndex = 0,
  onClose,
  onDelete,
}: {
  visible: boolean;
  paths: string[];
  initialIndex?: number;
  onClose: () => void;
  /** When set, a trash button deletes the image on screen (caller confirms). */
  onDelete?: (path: string) => void;
}) {
  const { width, height } = useWindowDimensions();
  const { d } = useI18n();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [zoomed, setZoomed] = useState(false);
  const [index, setIndex] = useState(initialIndex);

  // Re-sync to the tapped image each time the viewer opens. The scrollTo
  // covers Android, where the contentOffset prop is ignored.
  useEffect(() => {
    if (visible) {
      setZoomed(false);
      setIndex(initialIndex);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ x: initialIndex * width, animated: false });
      });
    }
  }, [visible, initialIndex, width]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  if (paths.length === 0) return null;
  // Deleting the last page leaves a stale index until state catches up.
  const safeIndex = Math.min(index, paths.length - 1);

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(i, paths.length - 1));
    setIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: initialIndex * width, y: 0 }}
            onMomentumScrollEnd={onMomentumEnd}
            onScroll={Platform.OS === 'web' ? onMomentumEnd : undefined}
            scrollEventThrottle={16}
            style={WEB_SNAP_CONTAINER}
          >
            {paths.map((path) => (
              <View key={path} style={WEB_SNAP_PAGE}>
                <ZoomableImage
                  path={path}
                  width={width}
                  height={height}
                  onZoomChange={setZoomed}
                  onRequestClose={onClose}
                />
              </View>
            ))}
          </ScrollView>

          {/* Web: mouse users can't swipe — page with chevrons instead. */}
          {Platform.OS === 'web' && paths.length > 1
            ? ([
                ['prev', -1],
                ['next', 1],
              ] as const).map(([dir, delta]) =>
                (dir === 'prev' ? safeIndex > 0 : safeIndex < paths.length - 1) ? (
                  <Pressable
                    key={dir}
                    accessibilityRole="button"
                    accessibilityLabel={dir === 'prev' ? d.components.prevImage : d.components.nextImage}
                    onPress={() => goTo(safeIndex + delta)}
                    hitSlop={12}
                    style={({ pressed }) => ({
                      position: 'absolute',
                      top: '50%',
                      marginTop: -20,
                      [dir === 'prev' ? 'left' : 'right']: 12,
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(0,0,0,0.5)',
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Ionicons
                      name={dir === 'prev' ? 'chevron-back' : 'chevron-forward'}
                      size={26}
                      color="#FFFFFF"
                    />
                  </Pressable>
                ) : null
              )
            : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={d.components.closeViewer}
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => ({
              position: 'absolute',
              top: insets.top + 8,
              left: 12,
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.5)',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>

          {onDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={d.components.deleteImage}
              onPress={() => onDelete(paths[safeIndex])}
              hitSlop={12}
              style={({ pressed }) => ({
                position: 'absolute',
                top: insets.top + 8,
                right: 12,
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.5)',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
            </Pressable>
          ) : null}

          {paths.length > 1 ? (
            <View
              style={{
                position: 'absolute',
                bottom: insets.bottom + 16,
                left: 0,
                right: 0,
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {paths.map((path, i) => (
                <View
                  key={path}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i === safeIndex ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
