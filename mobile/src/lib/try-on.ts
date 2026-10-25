import type { Artwork } from '@/api/types';

/** Объёмные работы в примерке ставим на стол или консоль, остальные вешаем на стену. */
export function standsOnSurface(a: Pick<Artwork, 'category' | 'technique'>): boolean {
  return a.category === 'sculpture' || a.technique === 'bronze' || a.technique === 'ceramics';
}
