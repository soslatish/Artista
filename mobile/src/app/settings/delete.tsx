import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { del, errorText } from '@/api/client';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { Button, Field, Notice, T } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

export default function DeleteAccountScreen() {
  const t = useT();
  const styles = useStyles();
  const { signOut } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const remove = () =>
    confirmAction(
      t('Удалить аккаунт навсегда?'),
      t('Профиль будет обезличен, работы сняты с продажи. Восстановить аккаунт нельзя.'),
      async () => {
        setBusy(true);
        setError('');
        try {
          await del('/me', { password });
          await signOut();
          router.dismissTo('/');
        } catch (e) {
          setError(errorText(e));
        } finally {
          setBusy(false);
        }
      },
      { confirmText: t('Удалить'), destructive: true },
    );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <T variant="title">{t('Что произойдёт')}</T>
      <T variant="body">{t('Имя, фото, контакты и описание будут удалены. Ваши работы снимутся с продажи, подписки и избранное — очистятся.')}</T>
      <T variant="body">{t('История завершённых заказов сохраняется обезличенно — это требование бухгалтерского учёта.')}</T>
      <Notice text={t('Если у вас есть активные заказы, сначала завершите или отмените их.')} />
      <Field label={t('Пароль для подтверждения')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button title={t('Удалить аккаунт')} variant="danger" loading={busy} disabled={password.length < 8} onPress={remove} />
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.xl, gap: space.lg },
}));
