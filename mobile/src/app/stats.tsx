import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { errorText } from '@/api/client';
import { useStats } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { formatPrice } from '@/lib/format';
import { Button, ErrorState, Loading, T } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

export default function StatsScreen() {
  const { user } = useSession();
  const q = useStats(user?.role === 'artist');
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  const s = q.data;
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <T variant="small" color={colors.onDarkMuted}>
          Выручка за этот месяц
        </T>
        <T variant="display" color={colors.onDark}>
          {formatPrice(s.revenue_month_kop)}
        </T>
        <T variant="small" color={colors.onDarkMuted}>
          Продано работ: {s.sales_month}. После комиссии.
        </T>
      </View>
      <View style={styles.grid}>
        <Cell label="Просмотры работ" value={String(s.total_views)} />
        <Cell label="В избранном" value={String(s.total_favorites)} />
        <Cell label="Подписчики" value={String(s.followers)} />
        <Cell label="В продаже" value={String(s.published_artworks)} />
        <Cell label="Всего продаж" value={String(s.sales_total)} />
        <Cell label="Выручка за всё время" value={formatPrice(s.revenue_total_kop)} />
      </View>
      {s.active_orders > 0 ? <Button title={`Активные заказы: ${s.active_orders}`} onPress={() => router.push({ pathname: '/orders', params: { role: 'artist' } })} /> : null}
      {!user?.is_premium ? (
        <View style={styles.premium}>
          <T variant="heading">Продавайте без комиссии</T>
          <T variant="small">С премиумом — 0% на продажи до 100 000 ₽ в месяц и работы выше в ленте.</T>
          <Button title="Подробнее о премиуме" variant="secondary" onPress={() => router.push('/premium')} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <T variant="title">{value}</T>
      <T variant="small">{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  hero: { backgroundColor: colors.bordeaux, padding: space.xl, borderRadius: radius.control, gap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { flexBasis: '47%', flexGrow: 1, padding: space.lg, borderRadius: radius.control, backgroundColor: colors.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, gap: 2 },
  premium: { gap: space.sm, padding: space.lg, borderRadius: radius.control, backgroundColor: colors.goldSoft },
});
