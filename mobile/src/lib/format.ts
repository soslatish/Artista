// Форматирование для интерфейса. Деньги приходят с сервера в копейках.

const NBSP = ' ';

/** 2500000 → «25 000 ₽» */
export function formatPrice(kop: number): string {
  const rub = Math.round(kop / 100);
  const s = String(Math.abs(rub)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${rub < 0 ? '−' : ''}${s}${NBSP}₽`;
}

/** «25 000» или «25000» → 2500000 копеек; null, если не число */
export function parseRubles(input: string): number | null {
  const digits = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  return Math.round(parseFloat(digits) * 100);
}

/** Русские формы множественного числа: plural(3, ['работа', 'работы', 'работ']) */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function countLabel(n: number, forms: [string, string, string]): string {
  return `${n}${NBSP}${plural(n, forms)}`;
}

/** 60 × 80 см (глубина — если есть) */
export function formatSize(w: number, h: number, d?: number): string {
  const f = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','));
  const parts = [f(w), f(h)];
  if (d && d > 0) parts.push(f(d));
  return `${parts.join(`${NBSP}×${NBSP}`)}${NBSP}см`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «23 октября», с годом, если не текущий */
export function formatDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Время для чата: «14:05» сегодня, иначе дата */
export function formatMessageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return formatDate(iso, now);
}

/** Сколько осталось до срока: «18 ч», «2 дн.», «35 мин» */
export function formatTimeLeft(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return 'срок истёк';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min}${NBSP}мин`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}${NBSP}ч`;
  return `${Math.floor(hours / 24)}${NBSP}дн.`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
