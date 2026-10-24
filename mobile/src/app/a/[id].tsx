import { Redirect, useLocalSearchParams } from 'expo-router';

import { validId } from '@/lib/guard';

/** Короткая ссылка сайта (universal/app link) открывает экран приложения. */
export default function ShortLink() {
  const id = validId(useLocalSearchParams().id);
  if (!id) return <Redirect href="/" />;
  return <Redirect href={{ pathname: '/artwork/[id]', params: { id: id } }} />;
}
