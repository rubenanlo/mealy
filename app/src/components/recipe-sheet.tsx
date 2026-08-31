import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useI18n } from '@/lib/i18n';
import { useReducedMotion } from '@/lib/motion';
import { useTheme } from '@/lib/theme';

// Drag past this distance (or flick faster than this velocity) to dismiss.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
// A touch must travel this far before we decide drag-to-dismiss vs scroll.
const DRAG_SLOP = 8;

export function shouldDismissDrag(translationY: number, velocityY: number): boolean {
  'worklet';
  return translationY > DISMISS_DISTANCE || velocityY > DISMISS_VELOCITY;
}

/** Any scroller between the touch target and the card that isn't at its top? */
export function hasScrolledAncestor(
  target: { scrollTop: number; parentElement: unknown } | null,
  card: unknown
): boolean {
  let el = target;
  while (el && el !== card) {
    if (el.scrollTop > 0) return true;
    el = el.parentElement as typeof target;
  }
  return false;
}

/**
 * v3.2 sheet chrome. iOS relies on the native pageSheet (rounded top, peek,
 * swipe-down); Android/web get a self-drawn dimmed backdrop + 95%-height
 * container with 16px top radii, a 280ms slide-up (reduced-motion: fade),
 * and a grab handle that can be dragged down to dismiss.
 */
export function RecipeSheet({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  const { colors } = useTheme();
  if (Platform.OS === 'ios') {
    return <View style={{ flex: 1, backgroundColor: colors.bg }}>{children}</View>;
  }
  return <DraggableSheet onDismiss={onDismiss}>{children}</DraggableSheet>;
}

/** Android/web sheet: self-drawn backdrop + card, drag-down-to-dismiss on the handle. */
export function DraggableSheet({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const { d } = useI18n();
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  const sheetHeight = windowHeight * 0.95;

  const progress = useSharedValue(0); // 0 = off-screen, 1 = presented
  const dragY = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(
      1,
      reduced
        ? { duration: 150 }
        : { duration: 280, easing: Easing.out(Easing.cubic) }
    );
  }, [progress, reduced]);

  const pan = Gesture.Pan()
    .withTestId('recipe-sheet-pan')
    .onUpdate((e) => {
      // Direct manipulation, not an animation: the card tracks the finger
      // even under reduced motion (only release effects are toned down).
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (!shouldDismissDrag(e.translationY, e.velocityY)) {
        // Reduced motion: instant snap back instead of the spring.
        dragY.value = reduced ? 0 : withSpring(0, { damping: 22, stiffness: 260 });
        return;
      }
      if (reduced) {
        // Reduced motion: no slide-off travel on release.
        runOnJS(onDismiss)();
        return;
      }
      dragY.value = withTiming(
        sheetHeight,
        { duration: 200, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(onDismiss)();
        }
      );
    });

  // Web touch: drag-to-dismiss from anywhere on the card, iOS-pageSheet
  // style. Claims a touch only when it moves mostly downward while every
  // scroller under the finger is at its top; otherwise (mid-scroll, upward,
  // horizontal galleries) native scrolling proceeds untouched. Mouse users
  // keep the pill handle — a full-card mouse drag would fight text selection.
  const cardRef = useRef<Animated.View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = cardRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;

    let startY = 0;
    let startX = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let claimed = false;
    let decided = false;

    const settle = (translationY: number, velocityY: number) => {
      if (!shouldDismissDrag(translationY, velocityY)) {
        dragY.value = reduced ? 0 : withSpring(0, { damping: 22, stiffness: 260 });
        return;
      }
      if (reduced) {
        onDismiss();
        return;
      }
      dragY.value = withTiming(
        sheetHeight,
        { duration: 200, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(onDismiss)();
        }
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      claimed = false;
      decided = e.touches.length !== 1;
      if (decided) return;
      startY = lastY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      lastT = e.timeStamp;
      velocity = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const x = e.touches[0].clientX;
      if (!decided) {
        const dy = y - startY;
        const dx = x - startX;
        if (Math.abs(dy) < DRAG_SLOP && Math.abs(dx) < DRAG_SLOP) return;
        decided = true;
        claimed =
          dy > 0 &&
          dy > Math.abs(dx) &&
          !hasScrolledAncestor(
            e.target as unknown as { scrollTop: number; parentElement: unknown },
            node
          );
      }
      if (!claimed) return;
      e.preventDefault();
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = ((y - lastY) / dt) * 1000;
      lastY = y;
      lastT = e.timeStamp;
      dragY.value = Math.max(0, y - startY);
    };
    const onTouchEnd = () => {
      if (!claimed) return;
      claimed = false;
      settle(lastY - startY, velocity);
    };
    const onTouchCancel = () => {
      if (!claimed) return;
      claimed = false;
      dragY.value = reduced ? 0 : withSpring(0, { damping: 22, stiffness: 260 });
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    // Non-passive: preventDefault is what stops the browser scrolling once claimed.
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd);
    node.addEventListener('touchcancel', onTouchCancel);
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [dragY, onDismiss, reduced, sheetHeight]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity:
      progress.value * interpolate(dragY.value, [0, sheetHeight], [1, 0], 'clamp'),
  }));

  const cardStyle = useAnimatedStyle(() => {
    // Reduced motion: fade-only entry, but the drag still moves the card.
    if (reduced) return { opacity: progress.value, transform: [{ translateY: dragY.value }] };
    return { transform: [{ translateY: (1 - progress.value) * sheetHeight + dragY.value }] };
  });

  return (
    <GestureHandlerRootView style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.45)' }, backdropStyle]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.recipe.closeRecipe}
          onPress={onDismiss}
          style={{ flex: 1 }}
        />
      </Animated.View>
      <Animated.View
        ref={cardRef}
        style={[
          {
            height: '95%',
            backgroundColor: colors.bg,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            overflow: 'hidden',
          },
          cardStyle,
        ]}
      >
        {children}
        <GestureDetector gesture={pan}>
          {/* Sits over the hero so drags start anywhere along the top edge. */}
          <View
            testID="recipe-sheet-drag-handle"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 28,
              alignItems: 'center',
              paddingTop: 8,
              zIndex: 10,
            }}
          >
            <View
              style={{
                width: 36,
                height: 5,
                borderRadius: 3,
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(0, 0, 0, 0.2)',
              }}
            />
          </View>
        </GestureDetector>
      </Animated.View>
    </GestureHandlerRootView>
  );
}
