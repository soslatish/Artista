// Тема Artista: токены (палитры, шрифты, отступы) и хуки темы.
// Токены живут в tokens.ts, чтобы theme-context мог импортировать их без циклической зависимости.
export * from './tokens';
export { makeStyles, ThemeProvider, useColors, useTheme, type ThemePref } from './theme-context';
