import { router } from 'expo-router';

import { useT } from '@/i18n';
import { Button, EmptyState } from '@/ui/primitives';

/** Экран для гостя вместо пустого списка: раздел доступен после входа. */
export function SignInGate({ text }: { text: string }) {
  const t = useT();
  return <EmptyState icon="person-circle-outline" title={t('Войдите в аккаунт')} text={text} action={<Button title={t('Войти')} onPress={() => router.push('/login')} />} />;
}
