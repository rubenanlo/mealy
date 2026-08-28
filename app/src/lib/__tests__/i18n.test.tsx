import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { supabase } from '@/lib/supabase';

import { dictionaries, fmt, LanguageProvider, LOCALES, useI18n, type Locale } from '../i18n';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: jest.fn().mockResolvedValue({ error: null }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

describe('fmt', () => {
  it('replaces {name} params', () => {
    expect(fmt('Step {n} of {total}', { n: 2, total: 5 })).toBe('Step 2 of 5');
  });

  it('leaves unknown params untouched', () => {
    expect(fmt('Hello {name}', {})).toBe('Hello {name}');
  });
});

describe('dictionaries', () => {
  const keyShape = (obj: object): string[] =>
    Object.entries(obj)
      .flatMap(([k, v]) =>
        v !== null && typeof v === 'object' && !Array.isArray(v)
          ? keyShape(v).map((inner) => `${k}.${inner}`)
          : [k]
      )
      .sort();

  it.each(['es', 'fr', 'it'] as Locale[])('%s mirrors the English key shape', (locale) => {
    expect(keyShape(dictionaries[locale])).toEqual(keyShape(dictionaries.en));
  });

  it('exposes the four supported locales', () => {
    expect(LOCALES.map((l) => l.code).sort()).toEqual(['en', 'es', 'fr', 'it']);
  });
});

function Probe() {
  const { locale, setLocale, d } = useI18n();
  return (
    <>
      <Text testID="locale">{locale}</Text>
      <Text testID="cancel">{d.common.cancel}</Text>
      <Text testID="switch" onPress={() => void setLocale('es')} />
    </>
  );
}

describe('LanguageProvider', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('defaults to English without a stored locale', async () => {
    const { getByTestId } = render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );
    await waitFor(() => expect(getByTestId('locale').props.children).toBe('en'));
    expect(getByTestId('cancel').props.children).toBe('Cancel');
  });

  it('boots in the locale cached in AsyncStorage', async () => {
    await AsyncStorage.setItem('mealy.locale', 'fr');
    const { getByTestId } = render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );
    await waitFor(() => expect(getByTestId('locale').props.children).toBe('fr'));
    expect(getByTestId('cancel').props.children).toBe(dictionaries.fr.common.cancel);
  });

  it('setLocale switches strings and persists locally and to the account', async () => {
    const { getByTestId } = render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );
    await waitFor(() => expect(getByTestId('locale').props.children).toBe('en'));
    await act(async () => {
      getByTestId('switch').props.onPress();
    });
    await waitFor(() =>
      expect(getByTestId('cancel').props.children).toBe(dictionaries.es.common.cancel)
    );
    expect(await AsyncStorage.getItem('mealy.locale')).toBe('es');
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ data: { locale: 'es' } });
  });

  it('useI18n works without a provider, in English (test environments)', () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('locale').props.children).toBe('en');
    expect(getByTestId('cancel').props.children).toBe('Cancel');
  });
});
