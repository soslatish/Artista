import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { errorText, get, post } from '@/api/client';
import type { Me, Payment } from '@/api/types';
import { useSession } from '@/auth/session';
import { TestPaymentSheet } from '@/features/test-payment';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { usePlatformTerms } from '@/lib/terms';
import { Button, type IconName, Notice, T } from '@/ui/primitives';
import { makeStyles, space, useColors } from '@/ui/theme';

const perks: { icon: IconName; title: string; text: string }[] = [
  { icon: 'cash-outline', title: '0% комиссии', text: 'На продажи до {limit} в календарный месяц. Сверх лимита — обычные {pct}.' },
  { icon: 'trending-up-outline', title: 'Выше в ленте', text: 'Ваши работы показываются раньше в разделах «Популярное» и «Для вас».' },
  { icon: 'stats-chart-outline', title: 'Расширенная статистика', text: 'Просмотры по дням, откуда приходят покупатели, воронка от просмотра до продажи.' },
  { icon: 'brush-outline', title: 'Отметка мастерской', text: 'Золотой мазок рядом с именем на карточках и в профиле.' },
];

export default function PremiumScreen() {
  const t = useT();
  const terms = usePlatformTerms();
  const styles = useStyles();
  const colors = useColors();
  const { user, setUser } = useSession();
  const qc = useQueryClient();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const buy = async () => {
    setBusy(true);
    setError('');
    try {
      setPayment(await post<Payment>('/me/subscription'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const paid = async () => {
    setPayment(null);
    setDone(true);
    try {
      setUser(await get<Me>('/me'));
    } catch {
      /* профиль обновится при следующем входе */
    }
    qc.invalidateQueries({ queryKey: ['artworks'] });
    qc.invalidateQueries({ queryKey: ['detailed-stats'] });
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <T variant="display">{t('Премиум мастерской')}</T>
      <T variant="priceLarge" color={colors.bordeaux}>
        {t('{price} в месяц', terms)}
      </T>
      {perks.map((p) => (
        <View key={p.title} style={styles.perk}>
          <Ionicons name={p.icon} size={26} color={colors.gold} />
          <View style={styles.flex}>
            <T variant="heading">{t(p.title)}</T>
            <T variant="small">{t(p.text, terms)}</T>
          </View>
        </View>
      ))}
      {user?.is_premium && user.premium_until ? <Notice tone="success" text={t('Премиум активен до {date}. Продление добавит 30 дней.', { date: formatDate(user.premium_until) })} /> : null}
      {done ? <Notice tone="success" text={t('Готово! Премиум подключён.')} /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      {user?.role === 'artist' ? (
        <Button title={user.is_premium ? t('Продлить на 30 дней') : t('Подключить за {price}', terms)} loading={busy} onPress={buy} />
      ) : (
        <Notice text={t('Премиум доступен художникам. Откройте мастерскую в профиле.')} />
      )}
      <Button title={t('Закрыть')} variant="ghost" onPress={() => router.back()} />
      <TestPaymentSheet payment={payment} purpose={t('Artista Премиум — 30 дней')} onPaid={paid} onCancel={() => setPayment(null)} />
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.xl, gap: space.lg, paddingBottom: space.xxl },
  perk: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
}));
