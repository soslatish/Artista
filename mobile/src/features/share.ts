// «Поделиться» ссылкой на страницу сайта: в мессенджерах она раскроется в превью с картинкой.
import { Platform, Share } from 'react-native';

import { SITE_URL } from '@/api/client';
import { t } from '@/i18n';
import { notify } from '@/lib/confirm';

export async function shareLink(path: string, message: string): Promise<void> {
  const url = `${SITE_URL}${path}`;
  if (Platform.OS === 'web') {
    await shareOnWeb(url, message);
    return;
  }
  try {
    await Share.share({ message: `${message}\n${url}`, url });
  } catch {
    /* пользователь закрыл окно */
  }
}

/** В браузере (и во встроенном браузере Telegram) — системное меню, а если его нет, копируем ссылку. */
async function shareOnWeb(url: string, title: string): Promise<void> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share) {
    try {
      await nav.share({ title, url });
      return;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
    }
  }
  try {
    await nav?.clipboard?.writeText(url);
    notify(t('Ссылка скопирована'), url);
  } catch {
    notify(t('Ссылка'), url);
  }
}
