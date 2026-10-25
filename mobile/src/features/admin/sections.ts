import type { IconName } from '@/ui/primitives';

export interface AdminSection {
  href: string;
  label: string;
  icon: IconName;
  hint: string;
}

export const adminSections: AdminSection[] = [
  { href: '/admin', label: 'Сводка', icon: 'speedometer-outline', hint: 'Пользователи, деньги, активность за 30 дней' },
  { href: '/admin/users', label: 'Пользователи', icon: 'people-outline', hint: 'Поиск, блокировка, роли, Премиум' },
  { href: '/admin/artworks', label: 'Работы', icon: 'images-outline', hint: 'Скрыть, вернуть в продажу, цена' },
  { href: '/admin/orders', label: 'Заказы', icon: 'cube-outline', hint: 'Споры, отмена с возвратом, завершение' },
  { href: '/admin/payments', label: 'Платежи', icon: 'card-outline', hint: 'Оплаты, возвраты, Премиум, продвижение' },
  { href: '/admin/deals', label: 'Сделки', icon: 'hammer-outline', hint: 'Аукционы, предложения, заказы на создание, выставки' },
  { href: '/admin/moderation', label: 'Модерация', icon: 'shield-checkmark-outline', hint: 'Жалобы, посты, вопросы' },
  { href: '/admin/collections', label: 'Подборки', icon: 'albums-outline', hint: 'Подборки на главной' },
  { href: '/admin/certificates', label: 'Сертификаты', icon: 'ribbon-outline', hint: 'Выданные сертификаты подлинности' },
  { href: '/admin/broadcast', label: 'Рассылка', icon: 'megaphone-outline', hint: 'Уведомление всем или группе' },
  { href: '/admin/settings', label: 'Настройки', icon: 'options-outline', hint: 'Комиссия, Премиум, тарифы, функции' },
  { href: '/admin/audit', label: 'Журнал', icon: 'time-outline', hint: 'Кто и что менял в админке' },
];
