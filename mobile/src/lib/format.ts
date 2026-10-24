// Форматирование для интерфейса. Деньги приходят с сервера в копейках.
// Функции учитывают текущий язык (компоненты перерисовываются при его смене через useT).
import { currentLocale, pluralForm, t } from '@/i18n';

const NBSP = '\u00a0';

/** 2500000 → «25 000 ₽» */
export function formatPrice(kop: number): string {
  const rub = Math.round(kop / 100);
  const s = String(Math.abs(rub)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${rub < 0 ? '−' : ''}${s}${NBSP}₽`;
}

/** «25 000» или «25000» → 2500000 копеек; null, если не число */
export function parseRubles(input: string): number | null {
  const digits = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  return Math.round(parseFloat(digits) * 100);
}

/** Формы множественного числа на текущем языке: plural(3, ['работа', 'работы', 'работ']) */
export function plural(n: number, forms: [string, string, string], enForms?: [string, string]): string {
  return pluralForm(currentLocale(), n, forms, enForms);
}

export function countLabel(n: number, forms: [string, string, string], enForms?: [string, string]): string {
  return `${n}${NBSP}${plural(n, forms, enForms)}`;
}

function num(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(1);
  return currentLocale() === 'en' ? s : s.replace('.', ',');
}

/** 60 × 80 см (глубина — если есть) */
export function formatSize(w: number, h: number, d?: number): string {
  const parts = [num(w), num(h)];
  if (d && d > 0) parts.push(num(d));
  return `${parts.join(`${NBSP}×${NBSP}`)}${NBSP}${t('см')}`;
}

const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** «23 октября» / «Oct 23», с годом, если не текущий */
export function formatDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  if (currentLocale() === 'en') {
    const base = `${MONTHS_EN[d.getMonth()]} ${d.getDate()}`;
    return sameYear ? base : `${base}, ${d.getFullYear()}`;
  }
  const base = `${d.getDate()} ${MONTHS_RU[d.getMonth()]}`;
  return sameYear ? base : `${base} ${d.getFullYear()}`;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** «23 октября, 19:00» */
export function formatDateTime(iso: string, now = new Date()): string {
  return `${formatDate(iso, now)}, ${hhmm(new Date(iso))}`;
}

/** Время для чата: «14:05» сегодня, иначе дата */
export function formatMessageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString() ? hhmm(d) : formatDate(iso, now);
}

/** Сколько осталось до срока: «18 ч», «2 дн.», «35 мин» */
export function formatTimeLeft(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return t('срок истёк');
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min}${NBSP}${t('мин')}`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}${NBSP}${t('ч')}`;
  return `${Math.floor(hours / 24)}${NBSP}${t('дн.')}`;
}

/** Обратный отсчёт с секундами для аукциона и выставок: «2 дн. 04:12:09», «04:12:09» */
export function formatCountdown(iso: string, now = new Date()): string {
  let s = Math.max(0, Math.floor((new Date(iso).getTime() - now.getTime()) / 1000));
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return days > 0 ? `${days}${NBSP}${t('дн.')} ${clock}` : clock;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
