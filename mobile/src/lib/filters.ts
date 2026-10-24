// Фильтры каталога: панель поиска, сохранённые поиски и их краткое описание.
import type { CatalogFilters } from '@/api/hooks';
import type { CatalogFilter, CatalogMeta } from '@/api/types';
import { formatPrice } from '@/lib/format';

type Translate = (s: string, vars?: Record<string, string | number>) => string;

/** Метка из справочника каталога по коду. */
function labelOf(meta: CatalogMeta | undefined, group: 'categories' | 'styles' | 'techniques' | 'rooms', code: string): string {
  return meta?.[group]?.find((o) => o.code === code)?.label ?? code;
}

/** Состояние панели фильтров (цвета — массивом). */
export interface Panel extends Omit<CatalogFilters, 'q' | 'feed' | 'colors' | 'auction'> {
  colors?: string[];
  auction?: boolean;
}

export function toQuery(p: Panel, q: string): CatalogFilters {
  return { ...p, q: q || undefined, colors: p.colors?.length ? p.colors.join(',') : undefined, auction: p.auction ? 'true' : undefined };
}

/** Фильтры в формате сервера для сохранённого поиска. */
export function toSaved(p: Panel, q: string): CatalogFilter {
  const f: CatalogFilter = {
    q: q || undefined,
    category: p.category,
    style: p.style,
    technique: p.technique,
    city: p.city,
    colors: p.colors?.length ? p.colors : undefined,
    room: p.room,
    price_min: p.price_min,
    price_max: p.price_max,
    size_max: p.size_max,
    auction: p.auction || undefined,
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')) as CatalogFilter;
}

const stringKeys = ['q', 'category', 'style', 'technique', 'city', 'room'] as const;
const numberKeys = ['price_min', 'price_max', 'size_max'] as const;

/** Разбирает фильтры из параметра ссылки (сохранённый поиск); чужие поля и типы отбрасываются. */
export function fromSavedParam(raw: unknown): { panel: Panel; q: string } | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const src = data as Record<string, unknown>;
  const panel: Panel = { sort: 'new' };
  for (const k of stringKeys) {
    const v = src[k];
    if (k !== 'q' && typeof v === 'string' && v.length <= 100) panel[k] = v;
  }
  for (const k of numberKeys) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) panel[k] = v;
  }
  if (Array.isArray(src.colors)) panel.colors = src.colors.filter((c): c is string => typeof c === 'string').slice(0, 13);
  if (src.auction === true) panel.auction = true;
  const q = typeof src.q === 'string' ? src.q.slice(0, 100) : '';
  return { panel, q };
}

/** Короткое описание фильтров: «Живопись, до 20 000 ₽, синий». */
export function describeFilter(f: CatalogFilter, meta: CatalogMeta | undefined, t: Translate): string {
  const parts: string[] = [];
  if (f.q) parts.push(`«${f.q}»`);
  if (f.category) parts.push(t(labelOf(meta, 'categories', f.category)));
  if (f.style) parts.push(t(labelOf(meta, 'styles', f.style)));
  if (f.technique) parts.push(t(labelOf(meta, 'techniques', f.technique)));
  if (f.room) parts.push(t(labelOf(meta, 'rooms', f.room)));
  if (f.colors?.length) parts.push(f.colors.map((c) => t(meta?.colors?.find((x) => x.code === c)?.label ?? c).toLowerCase()).join(', '));
  if (f.price_min && f.price_max) parts.push(`${formatPrice(f.price_min)}–${formatPrice(f.price_max)}`);
  else if (f.price_max) parts.push(t('до {p}', { p: formatPrice(f.price_max) }));
  else if (f.price_min) parts.push(t('от {p}', { p: formatPrice(f.price_min) }));
  if (f.size_max) parts.push(t('до {n} см', { n: f.size_max }));
  if (f.city) parts.push(f.city);
  if (f.auction) parts.push(t('аукционы'));
  return parts.join(', ') || t('Все работы');
}

