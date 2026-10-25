import { Platform, useWindowDimensions } from 'react-native';

/**
 * Ширина приложения в браузере. На мониторе приложение стоит колонкой по центру,
 * как на планшете: так лента, шапка и меню не растягиваются на весь экран.
 * Админка — исключение, ей нужна вся ширина (см. корневой _layout).
 */
export const APP_MAX_WIDTH = 1080;

export const contentWidth = { wide: APP_MAX_WIDTH, page: 720 } as const;

export const isWeb = Platform.OS === 'web';

/** Ширина колонки приложения: на телефоне — экран, в браузере — не больше APP_MAX_WIDTH. */
export function useAppWidth(): number {
  const { width } = useWindowDimensions();
  return isWeb ? Math.min(width, APP_MAX_WIDTH) : width;
}

/** Ширина блока контента, не больше `max` (только в браузере; на телефоне — весь экран). */
export function useContentWidth(max: number = contentWidth.page): number {
  const app = useAppWidth();
  return isWeb ? Math.min(app, max) : app;
}

/** Колонки ленты: 2 на телефоне, 3 на планшете и узком окне, 4 на мониторе. */
export function useGalleryColumns(): number {
  const w = useAppWidth();
  if (w >= 900) return 4;
  if (w >= 600) return 3;
  return 2;
}
