const datePattern = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const timePattern = /^(\d{1,2}):(\d{2})$/;

/** «ДД.ММ.ГГГГ» + «ЧЧ:ММ» в часовом поясе устройства → Date; null, если ввод некорректен. */
export function parseLocalDateTime(date: string, time: string): Date | null {
  const d = datePattern.exec(date.trim());
  const tm = timePattern.exec(time.trim());
  if (!d || !tm) return null;
  const [day, month, year, hour, minute] = [d[1], d[2], d[3], tm[1], tm[2]].map(Number);
  if (hour > 23 || minute > 59) return null;
  const result = new Date(year, month - 1, day, hour, minute);
  // отсекаем 31.02 и подобное: Date молча переносит их на следующий месяц
  if (result.getDate() !== day || result.getMonth() !== month - 1) return null;
  return result;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDateInput(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Дата через days дней в hour:00 по времени устройства. */
export function daysFromNowAt(days: number, hour: number, now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0);
}
