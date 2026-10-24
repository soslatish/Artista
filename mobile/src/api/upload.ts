// Загрузка фото на сервер (multipart). Сервер сам определяет тип по содержимому.
import { Platform } from 'react-native';

import { request } from './client';
import type { UploadResult } from './types';

export interface PickedImage {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}

export async function uploadImage(img: PickedImage): Promise<string> {
  return (await uploadImageFull(img)).url;
}

/** Загрузка с палитрой и размерами (их считает сервер). */
export async function uploadImageFull(img: PickedImage): Promise<UploadResult> {
  const form = new FormData();
  const type = img.mimeType ?? 'image/jpeg';
  const name = img.fileName ?? `photo.${type.split('/')[1] ?? 'jpg'}`;
  if (Platform.OS === 'web') {
    const blob = await (await fetch(img.uri)).blob();
    form.append('file', blob, name);
  } else {
    // React Native принимает объект {uri, name, type} как файл
    form.append('file', { uri: img.uri, name, type } as unknown as Blob);
  }
  const env = await request<UploadResult>('/uploads', { method: 'POST', form });
  return env.data;
}
