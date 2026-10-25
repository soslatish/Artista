// Подписи статусов и тон меток для списков админки.
type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'accent';

export const roleLabels: Record<string, string> = { buyer: 'Покупатель', artist: 'Художник', admin: 'Администратор' };

export const artworkStatus: Record<string, [string, Tone]> = {
  draft: ['Черновик', 'neutral'],
  published: ['В продаже', 'good'],
  reserved: ['Резерв', 'warn'],
  sold: ['Продана', 'accent'],
  archived: ['Архив', 'neutral'],
  hidden: ['Скрыта', 'bad'],
  scheduled: ['Ждёт выставки', 'warn'],
  auction: ['Аукцион', 'accent'],
  commission: ['На заказ', 'neutral'],
};

export const orderStatus: Record<string, [string, Tone]> = {
  awaiting_payment: ['Ждёт оплаты', 'warn'],
  paid: ['Оплачен', 'accent'],
  confirmed: ['Подтверждён', 'accent'],
  shipped: ['В пути', 'accent'],
  completed: ['Завершён', 'good'],
  cancelled: ['Отменён', 'bad'],
};

export const orderKind: Record<string, string> = { artwork: 'Покупка', offer: 'По предложению', auction: 'Аукцион', commission: 'На заказ' };

export const paymentStatus: Record<string, [string, Tone]> = {
  pending: ['Ожидает', 'warn'],
  succeeded: ['Оплачен', 'good'],
  cancelled: ['Отменён', 'neutral'],
  refund_pending: ['Возврат в очереди', 'bad'],
  refunded: ['Возвращён', 'bad'],
};

export const paymentPurpose: Record<string, string> = { order: 'Заказ', subscription: 'Премиум', promotion: 'Продвижение' };

export const dealStatus: Record<string, [string, Tone]> = {
  live: ['Идёт', 'accent'],
  ended: ['Завершён', 'good'],
  cancelled: ['Отменён', 'bad'],
  pending: ['Ждёт ответа', 'warn'],
  countered: ['Встречная цена', 'warn'],
  accepted: ['Принято', 'good'],
  declined: ['Отклонено', 'bad'],
  withdrawn: ['Отозвано', 'neutral'],
  expired: ['Истекло', 'neutral'],
  used: ['Заказ оформлен', 'good'],
  requested: ['Запрос', 'warn'],
  quoted: ['Цена названа', 'accent'],
  upcoming: ['Скоро', 'warn'],
  open: ['Открыта', 'good'],
};

export const payoutStatus: Record<string, string> = { none: 'нет', held: 'удерживается', released: 'выплачено', refunded: 'возвращено' };

export function label(map: Record<string, [string, Tone]>, key: string): [string, Tone] {
  return map[key] ?? [key, 'neutral'];
}

export const actionLabels: Record<string, string> = {
  'settings.update': 'Изменены настройки',
  'user.update': 'Изменён пользователь',
  'artwork.update': 'Изменена работа',
  'order.cancel': 'Заказ отменён',
  'order.complete': 'Заказ завершён',
  'auction.cancel': 'Аукцион отменён',
  'offer.cancel': 'Предложение отклонено',
  'commission.cancel': 'Заказ на создание отменён',
  'exhibition.cancel': 'Выставка отменена',
  'post.hidden': 'Пост скрыт / показан',
  'question.hidden': 'Вопрос скрыт / показан',
  broadcast: 'Рассылка',
};

/** Короткое описание изменений для журнала: простые поля через запятую. */
export function summarize(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ');
}
