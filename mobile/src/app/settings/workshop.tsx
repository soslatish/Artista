// Мастерская: пауза магазина (отпуск) и приём заказов на заказ.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { errorText } from '@/api/client';
import { useUpdateMe } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { Button, Chip, Field, Notice, T, ToggleRow } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

const durations = [7, 14, 30, 60];

export default function WorkshopSettingsScreen() {
  const t = useT();
  const styles = useStyles();
  const { user, setUser } = useSession();
  const update = useUpdateMe();
  const [days, setDays] = useState<number | null>(null);
  const [note, setNote] = useState(user?.vacation_note ?? '');
  const [accepts, setAccepts] = useState(user?.accepts_commissions ?? false);
  const [terms, setTerms] = useState(user?.commission_note ?? '');
  const [error, setError] = useState('');
  if (!user) return null;
  const onVacation = !!user.vacation_until;

  const save = (body: Parameters<typeof update.mutate>[0]) =>
    update.mutate(body, {
      onSuccess: (me) => {
        setUser(me);
        setError('');
      },
      onError: (e) => setError(errorText(e)),
    });

  const startVacation = () => {
    if (!days) return;
    const until = new Date(Date.now() + days * 24 * 3600 * 1000);
    until.setHours(23, 59, 0, 0);
    save({ vacation_until: until.toISOString(), vacation_note: note.trim() });
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={styles.section}>
          <T variant="title">{t('Пауза магазина')}</T>
          <T variant="small">{t('Уезжаете на пленэр или в отпуск? Работы останутся в каталоге, но купить их, предложить цену или сделать заказ будет нельзя.')}</T>
          {onVacation ? (
            <>
              <Notice text={t('Пауза до {date}.', { date: formatDate(user.vacation_until!) })} />
              <Button title={t('Вернуться к работе')} loading={update.isPending} onPress={() => save({ vacation_until: '' })} />
            </>
          ) : (
            <>
              <View style={styles.chips}>
                {durations.map((d) => (
                  <Chip key={d} label={t('{n} дней', { n: d })} selected={days === d} onPress={() => setDays(d)} />
                ))}
              </View>
              <Field label={t('Сообщение покупателям')} value={note} onChangeText={setNote} maxLength={200} placeholder={t('Например, «Уехала на пленэр, вернусь к выставке»')} />
              <Button title={t('Поставить на паузу')} variant="secondary" disabled={!days} loading={update.isPending} onPress={startVacation} />
            </>
          )}
        </View>

        <View style={styles.section}>
          <T variant="title">{t('Работы на заказ')}</T>
          <ToggleRow
            label={t('Принимать заказы')}
            hint={t('Покупатели смогут описать работу — портрет, картину под интерьер — и предложить бюджет. Вы называете цену и срок.')}
            value={accepts}
            onChange={setAccepts}
          />
          <Field label={t('Условия')} value={terms} onChangeText={setTerms} multiline maxLength={500} placeholder={t('Например: портреты по фото от 15 000 ₽, срок 2–3 недели')} />
          <Button
            title={t('Сохранить')}
            loading={update.isPending}
            onPress={() => save({ accepts_commissions: accepts, commission_note: terms.trim() })}
          />
          <Button title={t('Открыть заказы на заказ')} variant="ghost" onPress={() => router.push({ pathname: '/commissions', params: { role: 'artist' } })} />
        </View>
        {error ? <Notice tone="danger" text={error} /> : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.xxl, paddingBottom: space.xxl },
  section: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
