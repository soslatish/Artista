import { Linking } from 'react-native';

import type { Payment } from '@/api/types';
import { t } from '@/i18n';
import { notify } from '@/lib/confirm';

/**
 * Боевой платёж: открываем страницу провайдера (ЮKassa и т. п.). Тестовый показывается своим окном,
 * поэтому сюда не попадает. Возвращает false, если открыть оплату не удалось.
 */
export async function openPaymentPage(p: Payment): Promise<boolean> {
  if (!p.confirmation_url.startsWith('https://')) {
    notify(t('Оплата недоступна'), t('Платёжная система пока не подключена. Попробуйте позже.'));
    return false;
  }
  try {
    await Linking.openURL(p.confirmation_url);
    return true;
  } catch {
    notify(t('Оплата недоступна'), t('Не удалось открыть страницу оплаты.'));
    return false;
  }
}
