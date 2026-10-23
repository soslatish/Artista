import { countLabel, formatDate, formatMessageTime, formatPrice, formatSize, formatTimeLeft, initials, parseRubles, plural } from '@/lib/format';

const NB = ' ';

describe('formatPrice', () => {
  it.each([
    [2_500_000, `25${NB}000${NB}₽`],
    [300_000, `3${NB}000${NB}₽`],
    [99, `1${NB}₽`],
    [0, `0${NB}₽`],
    [50_000_000, `500${NB}000${NB}₽`],
    [-150_000, `−1${NB}500${NB}₽`],
  ])('formats %d kopecks', (kop, expected) => {
    expect(formatPrice(kop)).toBe(expected);
  });
});

describe('parseRubles', () => {
  it.each([
    ['25 000', 2_500_000],
    ['25000', 2_500_000],
    ['3000,50', 300_050],
    [`12${NB}500`, 1_250_000],
  ])('parses %s', (input, expected) => {
    expect(parseRubles(input)).toBe(expected);
  });
  it.each(['', 'abc', '1.234', '-5'])('rejects %p', (input) => {
    expect(parseRubles(input)).toBeNull();
  });
});

describe('plural', () => {
  const forms: [string, string, string] = ['работа', 'работы', 'работ'];
  it.each([
    [1, 'работа'],
    [2, 'работы'],
    [5, 'работ'],
    [11, 'работ'],
    [21, 'работа'],
    [22, 'работы'],
    [112, 'работ'],
  ])('%d → %s', (n, word) => {
    expect(plural(n, forms)).toBe(word);
  });
  it('countLabel joins with nbsp', () => {
    expect(countLabel(3, forms)).toBe(`3${NB}работы`);
  });
});

describe('formatSize', () => {
  it('two dimensions', () => expect(formatSize(60, 80)).toBe(`60${NB}×${NB}80${NB}см`));
  it('with depth and decimals', () => expect(formatSize(60.5, 80, 2)).toBe(`60,5${NB}×${NB}80${NB}×${NB}2${NB}см`));
  it('ignores zero depth', () => expect(formatSize(10, 10, 0)).toBe(`10${NB}×${NB}10${NB}см`));
});

describe('dates', () => {
  const now = new Date('2026-10-23T12:00:00');
  it('same year has no year', () => expect(formatDate('2026-03-08T10:00:00', now)).toBe('8 марта'));
  it('other year shows year', () => expect(formatDate('2025-12-31T10:00:00', now)).toBe('31 декабря 2025'));
  it('message time today is clock', () => expect(formatMessageTime('2026-10-23T09:05:00', now)).toBe('09:05'));
  it('message time earlier is date', () => expect(formatMessageTime('2026-10-20T09:05:00', now)).toBe('20 октября'));
  it.each([
    ['2026-10-23T12:30:00', `30${NB}мин`],
    ['2026-10-24T06:00:00', `18${NB}ч`],
    ['2026-10-26T12:00:00', `3${NB}дн.`],
    ['2026-10-23T11:00:00', 'срок истёк'],
  ])('time left until %s', (iso, expected) => {
    expect(formatTimeLeft(iso, now)).toBe(expected);
  });
});

describe('initials', () => {
  it('takes first letters of two words', () => expect(initials('анна петрова иванова')).toBe('АП'));
  it('handles empty', () => expect(initials('  ')).toBe(''));
});
