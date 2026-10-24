// «Поделиться» ссылкой на страницу сайта: в мессенджерах она раскроется в превью с картинкой.
import { Share } from 'react-native';

import { SITE_URL } from '@/api/client';

export async function shareLink(path: string, message: string): Promise<void> {
  const url = `${SITE_URL}${path}`;
  try {
    await Share.share({ message: `${message}\n${url}`, url });
  } catch {
    /* пользователь закрыл окно */
  }
}
