// Выбор фото из галереи или съёмка камерой (с запросом разрешения в момент действия).
import * as ImagePicker from 'expo-image-picker';

import { t } from '@/i18n';
import { notify } from '@/lib/confirm';

export type PhotoSource = 'library' | 'camera';

/** Возвращает выбранные снимки (пустой массив — отмена или нет доступа). */
export async function pickPhotos(source: PhotoSource, limit = 1): Promise<ImagePicker.ImagePickerAsset[]> {
  if (limit <= 0) return [];
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      notify(t('Нет доступа к камере'), t('Разрешите доступ в настройках телефона, чтобы снимать работы.'));
      return [];
    }
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, exif: false };
  const res =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: limit > 1, selectionLimit: limit });
  return res.canceled ? [] : res.assets.slice(0, limit);
}
