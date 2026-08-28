import { Alert, Platform } from 'react-native';

/**
 * Cross-platform dialogs: react-native-web's Alert is a complete no-op (both
 * with and without buttons), so the web falls back to the browser's native
 * confirm/alert. Same pattern as confirmRemoveFromWeek in add-to-week.tsx.
 */

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}

/** Set by the mounted ConfirmHost (web's styled modal); null when absent. */
let presenter: ((req: ConfirmRequest) => void) | null = null;

export function setConfirmPresenter(fn: ((req: ConfirmRequest) => void) | null): void {
  presenter = fn;
}

export function confirmDestructive(opts: ConfirmRequest): void {
  if (Platform.OS === 'web') {
    if (presenter) {
      presenter(opts);
      return;
    }
    // Host not mounted (early boot): the browser's confirm still works.
    const text = opts.message ? `${opts.title}\n\n${opts.message}` : opts.title;
    if (typeof window !== 'undefined' && window.confirm(text)) {
      opts.onConfirm();
    }
    return;
  }
  Alert.alert(opts.title, opts.message, [
    { text: opts.cancelLabel, style: 'cancel' },
    { text: opts.confirmLabel, style: 'destructive', onPress: opts.onConfirm },
  ]);
}

/** Message-only alert that is actually visible on the web. */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}
