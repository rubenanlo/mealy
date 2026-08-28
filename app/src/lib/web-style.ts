import { Platform } from 'react-native';

const STYLE_ID = 'mealy-no-scrollbar';

/**
 * Web-only global CSS: hide every scrollbar (the app scrolls like the native
 * one, chrome-free). Injected at runtime because the SPA export has no
 * app-owned HTML shell to put a stylesheet in. Idempotent.
 */
export function hideWebScrollbars(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    * { scrollbar-width: none; -ms-overflow-style: none; }
    *::-webkit-scrollbar { display: none; width: 0; height: 0; }
  `;
  document.head.appendChild(style);
}
