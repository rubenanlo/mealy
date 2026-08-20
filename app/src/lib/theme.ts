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
  cardPressed: string;
  text: string;
  textMuted: string;
  /** Actions, active tab, links. */
  accent: string;
  /** Label color on accent surfaces. */
  accentText: string;
  /** Featured/seasonal highlights and badges. */
  saffron: string;
  /** Errors and allergens only. */
  danger: string;
  border: string;
  spineFish: string;
  spineMeat: string;
  spineVeg: string;
  spineLegume: string;
}

/** "Carnet de cuisine": warm paper light / warm cast-iron dark (design.md). */
export const palettes: Record<SchemeName, Palette> = {
  light: {
    bg: '#F6F2EA',
    card: '#FFFDF8',
    cardPressed: '#F0EAD9',
    text: '#2B2925',
    textMuted: '#7A7468',
    accent: '#44582F',
    accentText: '#FFFDF8',
    saffron: '#D9A441',
    danger: '#B3402F',
    border: '#E4DCCB',
    spineFish: '#4E6E8E',
    spineMeat: '#9C4A38',
    spineVeg: '#5F7040',
    spineLegume: '#B08432',
  },
  dark: {
    bg: '#1C1B18',
    card: '#2A2721',
    cardPressed: '#332F27',
    text: '#EFEAE0',
    textMuted: '#A39B8B',
    accent: '#8FA96B',
    accentText: '#1C1B18',
    saffron: '#D9A441',
    danger: '#D06A54',
    border: '#3A352B',
    spineFish: '#6E8DAB',
    spineMeat: '#B56A55',
    spineVeg: '#84955F',
    spineLegume: '#C29A4A',
  },
};

/**
 * Kitchen-readable type scale (design.md §Type): body 17, secondary 15,
 * never below 13. `title` = screen titles (Fraunces 28), `large` = recipe
 * titles (Fraunces 22).
 */
export const fontSize = {
  eyebrow: 13,
  small: 15,
  base: 17,
  medium: 19,
  large: 22,
  title: 28,
  wordmark: 34,
} as const;

/**
 * Display faces (Fraunces, loaded in the root layout). Used ONLY for the
 * wordmark, screen titles, recipe titles and planner day names.
 */
export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_400Regular_Italic',
} as const;

/** Shared shape tokens (design.md §Layout). */
export const radius = { card: 14, control: 12 } as const;
/** Standard control height (buttons, fields). */
export const controlHeight = 52;
/** Horizontal screen padding. */
export const screenPadding = 20;
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
