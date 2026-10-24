// Тема оформления: системная, светлая или тёмная. Стили компонентов создаются фабрикой
// makeStyles и кэшируются для каждой темы, поэтому переключение не пересоздаёт StyleSheet на каждый рендер.
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { savePref } from '@/lib/prefs';

import { dark, light, makeType, type Palette, type TypeScale } from './tokens';

export type ThemePref = 'system' | 'light' | 'dark';
type Scheme = 'light' | 'dark';

interface ThemeValue {
  scheme: Scheme;
  colors: Palette;
  type: TypeScale;
  pref: ThemePref;
  setPref(p: ThemePref): void;
}

const themes = {
  light: { colors: light, type: makeType(light) },
  dark: { colors: dark, type: makeType(dark) },
} as const;

const ThemeContext = createContext<ThemeValue>({
  scheme: 'light',
  ...themes.light,
  pref: 'system',
  setPref: () => undefined,
});

export function ThemeProvider({ initial = 'system', children }: { initial?: ThemePref; children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>(initial);
  const scheme: Scheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    void savePref('theme', p);
  }, []);
  const value = useMemo<ThemeValue>(() => ({ scheme, ...themes[scheme], pref, setPref }), [scheme, pref, setPref]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

export function useColors(): Palette {
  return useContext(ThemeContext).colors;
}

/**
 * Фабрика стилей, зависящих от темы:
 *   const useStyles = makeStyles((c, t) => ({ root: { backgroundColor: c.wall } }));
 *   const styles = useStyles();
 */
type Styles = Parameters<typeof StyleSheet.create>[0];

export function makeStyles<T extends Styles>(factory: (c: Palette, t: TypeScale) => T & Styles): () => Readonly<T> {
  const cache: Partial<Record<Scheme, Readonly<T>>> = {};
  return function useStyles(): Readonly<T> {
    const { scheme, colors, type } = useContext(ThemeContext);
    let styles = cache[scheme];
    if (!styles) {
      styles = StyleSheet.create(factory(colors, type));
      cache[scheme] = styles;
    }
    return styles;
  };
}
