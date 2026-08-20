import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

/** Manual theme override, persisted across launches (spec §13). */
export type ThemeOverride = 'system' | 'light' | 'dark';
export type SchemeName = 'light' | 'dark';

export interface Palette {
  bg: string;
  card: string;
  text: string;
  textMuted: string;
  accent: string;
  danger: string;
}

/** Kitchen-readable, high-contrast palettes (spec §13). */
export const palettes: Record<SchemeName, Palette> = {
  light: {
    bg: '#FFFFFF',
    card: '#F1F1F4',
    text: '#151619',
    textMuted: '#565C66',
    accent: '#D9480F',
    danger: '#C92A2A',
  },
  dark: {
    bg: '#101114',
    card: '#1D1F24',
    text: '#F4F5F7',
    textMuted: '#A5ABB6',
    accent: '#FF922B',
    danger: '#FF6B6B',
  },
};

/** Kitchen-readable type scale: base ≥ 17 (spec §13). */
export const fontSize = {
  small: 15,
  base: 17,
  medium: 19,
  large: 22,
  title: 28,
} as const;

/** Minimum tap target (spec §13). */
export const minTapTarget = 48;

export const THEME_OVERRIDE_KEY = 'mealy.theme-override';

/**
 * Pure resolution rule: an explicit override wins; otherwise follow the
 * system scheme, defaulting to light when the system reports nothing.
 */
export function resolveScheme(
  system: SchemeName | null | undefined,
  override: ThemeOverride
): SchemeName {
  if (override === 'light' || override === 'dark') return override;
  return system === 'dark' ? 'dark' : 'light';
}

export interface Theme {
  colors: Palette;
  dark: boolean;
  override: ThemeOverride;
  setOverride: (value: ThemeOverride) => void;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [override, setOverrideState] = useState<ThemeOverride>('system');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(THEME_OVERRIDE_KEY)
      .then((stored) => {
        if (!cancelled && (stored === 'light' || stored === 'dark' || stored === 'system')) {
          setOverrideState(stored);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setOverride = useCallback((value: ThemeOverride) => {
    setOverrideState(value);
    AsyncStorage.setItem(THEME_OVERRIDE_KEY, value).catch(() => {});
  }, []);

  const scheme = resolveScheme(
    systemScheme === 'dark' || systemScheme === 'light' ? systemScheme : null,
    override
  );

  const value = useMemo<Theme>(
    () => ({ colors: palettes[scheme], dark: scheme === 'dark', override, setOverride }),
    [scheme, override, setOverride]
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}
