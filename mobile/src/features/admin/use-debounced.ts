import { useEffect, useState } from 'react';

export function useDebounced<V>(value: V, ms = 350): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

/** Строковый параметр маршрута (первое значение) или запасное значение. */
export function param(v: string | string[] | undefined, fallback = ''): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? fallback) : fallback;
}
