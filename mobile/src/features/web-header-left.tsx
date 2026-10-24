import { router } from 'expo-router';

import { useT } from '@/i18n';
import { IconButton } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

/**
 * Веб-версия: человек часто приходит по ссылке сразу на экран работы (например, из Telegram),
 * и истории «назад» у него нет. Тогда вместо стрелки показываем переход в галерею.
 */
export function WebHeaderLeft({ canGoBack }: { canGoBack?: boolean }) {
  const t = useT();
  const colors = useColors();
  if (canGoBack) return <IconButton icon="chevron-back" color={colors.ink} label={t('Назад')} onPress={() => router.back()} />;
  return <IconButton icon="grid-outline" color={colors.ink} label={t('Галерея')} onPress={() => router.replace('/')} />;
}
