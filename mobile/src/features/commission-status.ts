import type { Commission } from '@/api/types';
import type { Palette } from '@/ui/theme';

type Translate = (s: string, vars?: Record<string, string | number>) => string;

export function commissionStatusLabel(c: Commission, t: Translate): string {
  switch (c.status) {
    case 'requested':
      return c.my_role === 'artist' ? t('Ждёт вашего ответа') : t('Ждёт ответа художника');
    case 'quoted':
      return c.my_role === 'buyer' ? t('Художник назвал цену') : t('Цена отправлена');
    case 'accepted':
      return t('Принят, создан заказ');
    case 'declined':
      return t('Отклонён');
    case 'cancelled':
      return t('Отменён');
    case 'expired':
      return t('Истёк срок');
  }
}

export function commissionTone(c: Commission, colors: Palette): string {
  if (c.status === 'accepted') return colors.success;
  if (c.status === 'declined' || c.status === 'cancelled' || c.status === 'expired') return colors.graphite;
  return colors.bordeaux;
}

/** Нужен ли ответ текущего пользователя. */
export function commissionNeedsAction(c: Commission): boolean {
  return (c.status === 'requested' && c.my_role === 'artist') || (c.status === 'quoted' && c.my_role === 'buyer');
}
