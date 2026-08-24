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
  /** Grouped-settings page background (NYT-style gray behind white cards). */
  bgGrouped: string;
  card: string;
  cardPressed: string;
  text: string;
  textMuted: string;
  /** Brand red — links, active save states, primary buttons. Used sparingly. */
  accent: string;
  /** Label color on accent surfaces. */
  accentText: string;
  /** Badge color (needs-review, TODAY). Token name kept from v1. */
  saffron: string;
  /** Errors and allergens only. */
  danger: string;
  /** Hairline dividers. */
  border: string;
  spineFish: string;
  spineMeat: string;
  spineVeg: string;
  spineLegume: string;
}

/** "Cooking editorial" v2: white/near-black monochrome, one editorial red. */
export const palettes: Record<SchemeName, Palette> = {
  light: {
    bg: '#FFFFFF',
    bgGrouped: '#F2F1EE',
    card: '#FFFFFF',
    cardPressed: '#F5F5F4',
    text: '#121212',
    textMuted: '#72716D',
    accent: '#C7442E',
    accentText: '#FFFFFF',
    saffron: '#B58A2A',
    danger: '#C7442E',
    border: '#E5E3DE',
    spineFish: '#4E6E8E',
    spineMeat: '#9C4A38',
    spineVeg: '#5F7040',
    spineLegume: '#B08432',
  },
  dark: {
    bg: '#121212',
    bgGrouped: '#0D0D0D',
    card: '#1C1C1C',
    cardPressed: '#262626',
    text: '#F5F5F4',
    textMuted: '#9C9A94',
    accent: '#E0604A',
    accentText: '#121212',
    saffron: '#D9A441',
    danger: '#E0604A',
    border: '#333230',
    spineFish: '#6E8DAB',
    spineMeat: '#B56A55',
    spineVeg: '#84955F',
    spineLegume: '#C29A4A',
  },
};

/**
 * v2 editorial scale (design.md §Type): body 16, meta 13, eyebrow 12;
 * Bitter for display sizes (cardTitle 17 / sectionHead 24 / heroTitle 26 /
 * wordmark 30), Libre Franklin for everything else.
 */
export const fontSize = {
  eyebrow: 12,
  meta: 13,
  small: 15,
  base: 16,
  cardTitle: 17,
  dayName: 20,
  sectionHead: 24,
  heroTitle: 26,
  wordmark: 30,
} as const;

/**
 * Faces loaded in the root layout. Bitter (Karnak stand-in) is reserved for
 * the wordmark, section headlines, recipe titles and day names; Libre
 * Franklin carries all UI/body text. Weight lives in the family name —
 * avoid fontWeight next to these so Android never synthesizes.
 */
export const fonts = {
  display: 'Bitter_700Bold',
  displaySemi: 'Bitter_600SemiBold',
  ui: 'LibreFranklin_400Regular',
  uiMedium: 'LibreFranklin_500Medium',
  uiSemi: 'LibreFranklin_600SemiBold',
} as const;

/** Shared shape tokens (design.md §Chrome). */
export const radius = { card: 8, control: 6, thumb: 6 } as const;
/** Standard control height (buttons, fields). */
export const controlHeight = 48;
/** Horizontal screen padding. */
export const screenPadding = 20;
/** Minimum tap target (spec §13). */
export const minTapTarget = 48;

/**
 * v3.1 floating capsule tab bar: scroll content needs
 * `insets.bottom + tabBarClearance` bottom padding to clear it
 * (64 bar + 8 gap + ~28 breathing room; the safe-area inset is added by
 * each screen since the capsule floats above it).
 */
export const tabBarClearance = 100;
/** Bottom offset (above safe area) for actions floating above the capsule. */
export const floatingActionOffset = 84; // 8 gap + 64 bar + 12 spacing

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
