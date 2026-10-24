import type { Offer } from '@/api/types';
import type { TFunc } from '@/i18n';
import type { Palette } from '@/ui/theme';

const labels: Record<Offer['status'], string> = {
  pending: 'Ждёт ответа художника',
  countered: 'Встречная цена',
  accepted: 'Принято — оформите заказ',
  declined: 'Отклонено',
  withdrawn: 'Отозвано',
  expired: 'Срок истёк',
  used: 'Заказ оформлен',
};

export function offerStatusLabel(o: Offer, t: TFunc): string {
  if (o.my_role === 'artist') {
    if (o.status === 'pending') return t('Ждёт вашего ответа');
    if (o.status === 'countered') return t('Ждём ответа покупателя');
    if (o.status === 'accepted') return t('Принято — ждём заказ');
  }
  return t(labels[o.status]);
}

export function offerTone(o: Offer, c: Palette): string {
  if (o.status === 'accepted' || o.status === 'used') return c.success;
  if (o.status === 'declined' || o.status === 'expired' || o.status === 'withdrawn') return c.graphite;
  return c.bordeaux;
}

/** Нужно ли действие от текущего пользователя. */
export function offerNeedsAction(o: Offer): boolean {
  return (o.my_role === 'artist' && o.status === 'pending') || (o.my_role === 'buyer' && (o.status === 'countered' || o.status === 'accepted'));
}
