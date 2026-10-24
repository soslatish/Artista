import { useEffect, useState } from 'react';

/** Текущее время, обновляемое раз в intervalMs (обратный отсчёт аукциона и выставки). */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
