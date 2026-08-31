import { Alert, Platform, type GestureResponderEvent } from 'react-native';

/**
 * Cross-platform option pickers: react-native-web's Alert is a complete
 * no-op, so option lists (units, recipe type, FODMAP, meal type, week
 * chooser, …) silently did nothing on web. Native keeps Alert.alert;
 * web routes through the mounted OptionPickerHost dropdown menu.
 * Same presenter pattern as lib/confirm.ts.
 */

export interface PickOptionItem {
  label: string;
  onPress: () => void;
  /** Renders the ✓ state (native: label suffix; web: trailing icon). */
  checked?: boolean;
  destructive?: boolean;
}

export interface PickRequest {
  title: string;
  message?: string;
  options: PickOptionItem[];
  cancelLabel: string;
  /** Web: where to drop the menu (usually the press point). Centered when absent. */
  anchor?: { x: number; y: number };
}

/** Set by the mounted OptionPickerHost (web dropdown); null when absent. */
let presenter: ((req: PickRequest) => void) | null = null;

export function setOptionPresenter(fn: ((req: PickRequest) => void) | null): void {
  presenter = fn;
}

/** Press-point anchor for the web dropdown; undefined off-web or without coords. */
export function anchorFromEvent(e?: GestureResponderEvent): { x: number; y: number } | undefined {
  const ne = e?.nativeEvent as { pageX?: number; pageY?: number } | undefined;
  return typeof ne?.pageX === 'number' && typeof ne?.pageY === 'number'
    ? { x: ne.pageX, y: ne.pageY }
    : undefined;
}

export function pickOption(req: PickRequest): void {
  if (Platform.OS === 'web') {
    presenter?.(req);
    return;
  }
  Alert.alert(req.title, req.message, [
    ...req.options.map((option) => ({
      text: option.checked ? `${option.label} ✓` : option.label,
      style: option.destructive ? ('destructive' as const) : ('default' as const),
      onPress: option.onPress,
    })),
    { text: req.cancelLabel, style: 'cancel' as const },
  ]);
}
