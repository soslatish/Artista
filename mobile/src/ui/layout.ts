// Ширина контента в веб-версии: на большом мониторе экраны не растягиваются во всю ширину.
import { Platform, useWindowDimensions } from 'react-native';

/** Ширины колонок контента в браузере. */
export const contentWidth = {
  /** галерея, подборки, выставки — сетка работ */
  wide: 1200,
  /** страница работы, художника, посты */
  page: 760,
} as const;

/** Ширина окна, ограниченная колонкой контента (на телефоне — просто ширина экрана). */
export function useContentWidth(max: number = contentWidth.page): number {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' ? Math.min(width, max) : width;
}

/** Сколько колонок в сетке работ: 2 на телефоне, до 4 на широком экране. */
export function useGalleryColumns(): number {
  const w = useContentWidth(contentWidth.wide);
  if (w >= 1000) return 4;
  if (w >= 700) return 3;
  return 2;
}
