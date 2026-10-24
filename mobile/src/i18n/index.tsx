// Локализация: русский (основной) и английский. Ключ перевода — сама русская строка,
// поэтому код читается как раньше, а отсутствующий перевод просто показывает русский текст.
//   const t = useT();  t('Войти');  t('Продано работ: {n}', { n: 3 })
import { getLocales } from 'expo-localization';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { savePref } from '@/lib/prefs';

import { en } from './en';

export type Locale = 'ru' | 'en';
export type TParams = Record<string, string | number>;
export type TFunc = (ru: string, params?: TParams) => string;

/** Язык устройства: русский для ru/uk/be/kk, иначе английский. */
export function deviceLocale(): Locale {
  try {
    const code = getLocales()[0]?.languageCode ?? 'ru';
    return ['ru', 'uk', 'be', 'kk'].includes(code) ? 'ru' : 'en';
  } catch {
    return 'ru';
  }
}

let current: Locale = 'ru';

/** Текущий язык для кода вне компонентов (заголовок Accept-Language, тексты ошибок). */
export function currentLocale(): Locale {
  return current;
}

export function translate(locale: Locale, ru: string, params?: TParams): string {
  let s = locale === 'en' ? (en[ru] ?? ru) : ru;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
  return s;
}

/** Перевод вне компонентов. В компонентах используйте useT — он перерисует экран при смене языка. */
export const t: TFunc = (ru, params) => translate(current, ru, params);

interface I18nValue {
  locale: Locale;
  setLocale(l: Locale): void;
}

const I18nContext = createContext<I18nValue>({ locale: 'ru', setLocale: () => undefined });

export function I18nProvider({ initial, children, onChange }: { initial: Locale; children: ReactNode; onChange?: (l: Locale) => void }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    current = initial;
    return initial;
  });
  const setLocale = useCallback(
    (l: Locale) => {
      current = l;
      setLocaleState(l);
      void savePref('locale', l);
      onChange?.(l);
    },
    [onChange],
  );
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useLocale(): I18nValue {
  return useContext(I18nContext);
}

/** Функция перевода, привязанная к текущему языку (компонент перерисуется при смене). */
export function useT(): TFunc {
  const { locale } = useContext(I18nContext);
  return useCallback((ru: string, params?: TParams) => translate(locale, ru, params), [locale]);
}

/** Формы множественного числа: русские [1, 2–4, 5+] и английские [1, many]. */
export function pluralForm(locale: Locale, n: number, ru: [string, string, string], enForms?: [string, string]): string {
  if (locale === 'en') {
    const forms = enForms ?? [translate('en', ru[0]), translate('en', ru[2])];
    return Math.abs(n) === 1 ? forms[0] : forms[1];
  }
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return ru[2];
  if (last > 1 && last < 5) return ru[1];
  if (last === 1) return ru[0];
  return ru[2];
}
