import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { errorText, get, post } from '@/api/client';
import type { Me, Payment } from '@/api/types';
import { useSession } from '@/auth/session';
import { TestPaymentSheet } from '@/features/test-payment';
import { formatDate } from '@/lib/format';
import { Button, Notice, T } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

const perks: { icon: ComponentProps<typeof Ionicons>['name']; title: string; text: string }[] = [
  { icon: 'cash-outline', title: '0% комиссии', text: 'На продажи до 100 000 ₽ в календарный месяц. Сверх лимита — обычные 15%.' },
  { icon: 'trending-up-outline', title: 'Выше в ленте', text: 'Ваши работы показываются раньше в разделах «Популярное» и «Для вас».' },
  { icon: 'brush-outline', title: 'Отметка мастерской', text: 'Золотой мазок рядом с именем на карточках и в профиле.' },
];

export default function PremiumScreen() {
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
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <T variant="display">Премиум мастерской</T>
      <T variant="priceLarge" color={colors.bordeaux}>
        990 ₽ в месяц
      </T>
      {perks.map((p) => (
        <View key={p.title} style={styles.perk}>
          <Ionicons name={p.icon} size={26} color={colors.gold} />
          <View style={styles.flex}>
            <T variant="heading">{p.title}</T>
            <T variant="small">{p.text}</T>
          </View>
        </View>
      ))}
      {user?.is_premium && user.premium_until ? <Notice tone="success" text={`Премиум активен до ${formatDate(user.premium_until)}. Продление добавит 30 дней.`} /> : null}
      {done ? <Notice tone="success" text="Готово! Премиум подключён." /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      {user?.role === 'artist' ? (
        <Button title={user.is_premium ? 'Продлить на 30 дней' : 'Подключить за 990 ₽'} loading={busy} onPress={buy} />
      ) : (
        <Notice text="Премиум доступен художникам. Откройте мастерскую в профиле." />
      )}
      <Button title="Закрыть" variant="ghost" onPress={() => router.back()} />
      <TestPaymentSheet payment={payment} purpose="Artista Премиум — 30 дней" onPaid={paid} onCancel={() => setPayment(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  content: { padding: space.xl, gap: space.lg, paddingBottom: space.xxl },
  perk: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
