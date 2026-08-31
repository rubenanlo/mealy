import { useEffect, type ReactNode } from 'react';
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
      const shouldDismiss = e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY;
      if (!shouldDismiss) {
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
