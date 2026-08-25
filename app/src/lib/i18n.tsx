import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { auth } from '@/lib/i18n/auth';
import { capture } from '@/lib/i18n/capture';
import { common } from '@/lib/i18n/common';
import { components } from '@/lib/i18n/components';
import { groceries } from '@/lib/i18n/groceries';
import { library } from '@/lib/i18n/library';
import { mealPrefs } from '@/lib/i18n/mealPrefs';
import { onboarding } from '@/lib/i18n/onboarding';
import { person } from '@/lib/i18n/person';
import { plan } from '@/lib/i18n/plan';
import { recipe } from '@/lib/i18n/recipe';
import { search } from '@/lib/i18n/search';
import { settings } from '@/lib/i18n/settings';
import { supabase } from '@/lib/supabase';

export type Locale = 'en' | 'es' | 'fr' | 'it';

export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
];

/**
 * The merged dictionary per locale. `en` is the source of truth; every other
 * locale is typed as the same shape, so completeness is enforced at compile time.
 */
export const dictionaries = {
  en: {
    common: common.en,
    auth: auth.en,
    settings: settings.en,
    plan: plan.en,
    recipe: recipe.en,
    library: library.en,
    search: search.en,
    groceries: groceries.en,
    capture: capture.en,
    onboarding: onboarding.en,
    person: person.en,
    mealPrefs: mealPrefs.en,
    components: components.en,
  },
  es: {
    common: common.es,
    auth: auth.es,
    settings: settings.es,
    plan: plan.es,
    recipe: recipe.es,
    library: library.es,
    search: search.es,
    groceries: groceries.es,
    capture: capture.es,
    onboarding: onboarding.es,
    person: person.es,
    mealPrefs: mealPrefs.es,
    components: components.es,
  },
  fr: {
    common: common.fr,
    auth: auth.fr,
    settings: settings.fr,
    plan: plan.fr,
    recipe: recipe.fr,
    library: library.fr,
    search: search.fr,
    groceries: groceries.fr,
    capture: capture.fr,
    onboarding: onboarding.fr,
    person: person.fr,
    mealPrefs: mealPrefs.fr,
    components: components.fr,
  },
  it: {
    common: common.it,
    auth: auth.it,
    settings: settings.it,
    plan: plan.it,
    recipe: recipe.it,
    library: library.it,
    search: search.it,
    groceries: groceries.it,
    capture: capture.it,
    onboarding: onboarding.it,
    person: person.it,
    mealPrefs: mealPrefs.it,
    components: components.it,
  },
} as const;

export type Dict = (typeof dictionaries)['en'];

/** Fill `{name}` placeholders: fmt('Step {n}', { n: 2 }) → 'Step 2'. */
export function fmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  );
}

const STORAGE_KEY = 'mealy.locale';

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'es' || value === 'fr' || value === 'it';
}

/** Device language when it is one of ours, else English. */
function deviceLocale(): Locale {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    const prefix = tag.slice(0, 2).toLowerCase();
    return isLocale(prefix) ? prefix : 'en';
  } catch {
    return 'en';
  }
}

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  d: Dict;
}

// English default so useI18n works without a provider (tests render bare components).
const I18nContext = createContext<I18n>({
  locale: 'en',
  setLocale: async () => {},
  d: dictionaries.en,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Boot order: local cache → account metadata (new device) → device language.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await AsyncStorage.getItem(STORAGE_KEY);
      if (isLocale(cached)) {
        if (!cancelled) setLocaleState(cached);
        return;
      }
      const { data } = await supabase.auth.getSession();
      const fromAccount = data.session?.user.user_metadata?.locale;
      const resolved = isLocale(fromAccount) ? fromAccount : deviceLocale();
      if (!cancelled) setLocaleState(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    await AsyncStorage.setItem(STORAGE_KEY, next);
    // Best effort: keep the choice on the account so other devices follow.
    void supabase.auth.updateUser({ data: { locale: next } });
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale, d: dictionaries[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
