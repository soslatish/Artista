import { useCatalogMeta } from '@/api/hooks';

import { formatPrice } from './format';

/** Условия платформы для текстов: комиссия, цена и лимит Премиума (меняются в админке). */
export function usePlatformTerms(): { pct: string; price: string; limit: string } {
  const { data } = useCatalogMeta();
  const bp = data?.commission_bp ?? 1500;
  return {
    pct: `${String(bp / 100).replace('.', ',')}%`,
    price: formatPrice(data?.premium_price_kop ?? 990_00),
    limit: formatPrice(data?.premium_free_limit_kop ?? 100_000_00),
  };
}
