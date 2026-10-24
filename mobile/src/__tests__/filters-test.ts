import type { CatalogMeta } from '@/api/types';
import { describeFilter, fromSavedParam, toQuery, toSaved } from '@/lib/filters';

const id = (s: string, vars?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''));
const sp = (s: string) => s.replace(/\u00a0/g, ' ');

const meta = {
  categories: [{ code: 'painting', label: 'Живопись' }],
  styles: [{ code: 'realism', label: 'Реализм' }],
  techniques: [{ code: 'oil', label: 'Масло' }],
  rooms: [{ code: 'bedroom', label: 'Спальня' }],
  colors: [{ code: 'blue', label: 'Синий', hex: '#2f5da8' }],
} as unknown as CatalogMeta;

describe('toQuery and toSaved', () => {
  it('joins colours and drops empty values', () => {
    const panel = { sort: 'new', colors: ['blue', 'red'], auction: true, category: 'painting' };
    expect(toQuery(panel, 'море')).toEqual({ sort: 'new', category: 'painting', q: 'море', colors: 'blue,red', auction: 'true' });
    expect(toQuery({ colors: [] }, '')).toEqual({ q: undefined, colors: undefined, auction: undefined });
  });

  it('keeps only set filters for saving', () => {
    expect(toSaved({ sort: 'price_asc', category: '', price_max: 2_000_000, colors: ['blue'] }, '')).toEqual({ price_max: 2_000_000, colors: ['blue'] });
  });
});

describe('fromSavedParam', () => {
  it('restores a saved search from a link param', () => {
    const raw = JSON.stringify({ q: 'сирень', category: 'painting', colors: ['blue'], price_max: 1_000_000, auction: true });
    expect(fromSavedParam(raw)).toEqual({ q: 'сирень', panel: { sort: 'new', category: 'painting', colors: ['blue'], price_max: 1_000_000, auction: true } });
  });

  it('drops unknown fields and wrong types', () => {
    const raw = JSON.stringify({ category: 5, price_min: -1, price_max: 'x', colors: [1, 'red'], sort: 'hack', extra: true });
    expect(fromSavedParam(raw)).toEqual({ q: '', panel: { sort: 'new', colors: ['red'] } });
  });

  it.each([undefined, 42, 'not json', '[1,2]', 'null', 'x'.repeat(2001)])('rejects %p', (raw) => {
    expect(fromSavedParam(raw)).toBeNull();
  });
});

describe('describeFilter', () => {
  it('builds a short human summary', () => {
    const text = describeFilter({ q: 'море', category: 'painting', style: 'realism', technique: 'oil', room: 'bedroom', colors: ['blue'], price_max: 2_000_000, size_max: 80, city: 'Казань', auction: true }, meta, id);
    expect(sp(text)).toBe('«море», Живопись, Реализм, Масло, Спальня, синий, до 20 000 ₽, до 80 см, Казань, аукционы');
  });

  it('formats price ranges and falls back to codes', () => {
    expect(sp(describeFilter({ price_min: 500_000, price_max: 900_000 }, meta, id))).toBe('5 000 ₽–9 000 ₽');
    expect(sp(describeFilter({ price_min: 500_000 }, meta, id))).toBe('от 5 000 ₽');
    expect(sp(describeFilter({ category: 'unknown' }, undefined, id))).toBe('unknown');
    expect(sp(describeFilter({}, meta, id))).toBe('Все работы');
  });
});
