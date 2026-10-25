import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';

/**
 * Раскладка в браузере. Приложение занимает всё окно (шапка и меню — во всю ширину),
 * а контент стоит по центру: лента и витрина — до APP_MAX_WIDTH, обычные экраны — до PAGE_MAX_WIDTH.
 * Прокручивается всё окно, поэтому ползунок прокрутки — у края экрана, а не посреди него.
 */
export const APP_MAX_WIDTH = 1400;
export const PAGE_MAX_WIDTH = 960;

export const contentWidth = { wide: APP_MAX_WIDTH, page: 720 } as const;

export const isWeb = Platform.OS === 'web';

/** Колонка обычного экрана по центру (только в браузере). */
export const webPage: ViewStyle = isWeb ? { width: '100%', maxWidth: PAGE_MAX_WIDTH, alignSelf: 'center' } : {};

/** Боковой отступ, при котором контент не шире `max` стоит по центру контейнера ширины `width`. */
export function centerInset(width: number, max: number = APP_MAX_WIDTH, base = 0): number {
  return isWeb ? Math.max(0, (width - max) / 2) + base : base;
}

/** Ширина контента: на телефоне — экран, в браузере — не больше APP_MAX_WIDTH. */
export function useAppWidth(): number {
  const { width } = useWindowDimensions();
  return isWeb ? Math.min(width, APP_MAX_WIDTH) : width;
}

/** Ширина блока контента, не больше `max` (только в браузере; на телефоне — весь экран). */
export function useContentWidth(max: number = contentWidth.page): number {
  const app = useAppWidth();
  return isWeb ? Math.min(app, max) : app;
}

/** Колонки сетки работ по ширине контента: 2 на телефоне, 3–4 на планшете и узком окне, 5 на мониторе. */
export function galleryColumns(width: number): number {
  if (width >= 1100) return 5;
  if (width >= 800) return 4;
  if (width >= 560) return 3;
  return 2;
}
