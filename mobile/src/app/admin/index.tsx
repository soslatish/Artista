import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { errorText } from '@/api/client';
import { useDashboard } from '@/api/admin';
import { orderStatus, artworkStatus, label } from '@/features/admin/labels';
import { adminSections } from '@/features/admin/sections';
import { AdminScreen, Badge, MiniBars, Section, StatTile, TileGrid } from '@/features/admin/ui';
import { formatPrice } from '@/lib/format';
import { Button, ErrorState, Loading, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

export default function AdminDashboard() {
  const q = useDashboard();
  const styles = useStyles();
  const colors = useColors();
  const { width } = useWindowDimensions();
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const go = (href: string, params?: Record<string, string>) => router.push((params ? { pathname: href, params } : href) as never);
  const labels = d.daily.map((p) => p.date);
  return (
    <AdminScreen title="Сводка" subtitle="Обновляется раз в минуту" actions={<Button title="Обновить" variant="ghost" onPress={() => void q.refetch()} />}>
      <TileGrid>
        <StatTile label="Пользователи" value={String(d.users.Total)} sub={`+${d.users.New7d} за неделю, +${d.users.New30d} за месяц`} onPress={() => go('/admin/users')} />
        <StatTile label="Художники" value={String(d.users.Artists)} sub={`Покупатели: ${d.users.Buyers}, Премиум: ${d.users.Premium}`} onPress={() => go('/admin/users', { role: 'artist' })} />
        <StatTile label="Продажи за месяц" value={formatPrice(d.money.GMVMonthKop)} sub={`Всего: ${formatPrice(d.money.GMVTotalKop)}`} onPress={() => go('/admin/orders', { status: 'completed' })} />
        <StatTile label="Доход платформы за месяц" tone="accent" value={formatPrice(d.money.CommissionMonthKop + d.money.SubscriptionsMonthKop + d.money.PromotionsMonthKop)} sub={`Комиссия ${formatPrice(d.money.CommissionMonthKop)}, Премиум ${formatPrice(d.money.SubscriptionsMonthKop)}, продвижение ${formatPrice(d.money.PromotionsMonthKop)}`} />
        <StatTile label="На удержании" value={formatPrice(d.money.HeldKop)} sub="Деньги покупателей до получения работ" onPress={() => go('/admin/orders', { status: 'shipped' })} />
        <StatTile label="Открытые жалобы" tone={d.activity.OpenReports ? 'bad' : undefined} value={String(d.activity.OpenReports)} onPress={() => go('/admin/moderation')} />
        <StatTile label="Возвраты в очереди" tone={d.activity.RefundsPending ? 'bad' : undefined} value={String(d.activity.RefundsPending)} onPress={() => go('/admin/payments', { status: 'refund_pending' })} />
        <StatTile label="Заблокированы" value={String(d.users.Banned)} onPress={() => go('/admin/users', { status: 'banned' })} />
      </TileGrid>

      <View style={[styles.charts, width >= 900 && styles.chartsWide]}>
        <View style={styles.chart}>
          <T variant="heading">Регистрации</T>
          <MiniBars values={d.daily.map((p) => p.signups)} labels={labels} format={String} />
        </View>
        <View style={styles.chart}>
          <T variant="heading">Оплаченные заказы</T>
          <MiniBars values={d.daily.map((p) => p.orders)} labels={labels} format={String} />
        </View>
        <View style={styles.chart}>
          <T variant="heading">Доход платформы</T>
          <MiniBars values={d.daily.map((p) => p.revenue_kop)} labels={labels} format={formatPrice} />
        </View>
      </View>

      <Section title="Сейчас на площадке">
        <TileGrid>
          <StatTile label="Аукционы идут" value={String(d.activity.LiveAuctions)} onPress={() => go('/admin/deals', { tab: 'auctions' })} />
          <StatTile label="Предложения ждут ответа" value={String(d.activity.PendingOffers)} onPress={() => go('/admin/deals', { tab: 'offers' })} />
          <StatTile label="Заказы на создание" value={String(d.activity.OpenCommissions)} onPress={() => go('/admin/deals', { tab: 'commissions' })} />
          <StatTile label="Выставки впереди" value={String(d.activity.UpcomingExhibitions)} onPress={() => go('/admin/deals', { tab: 'exhibitions' })} />
          <StatTile label="Продвигаются" value={String(d.activity.ActivePromotions)} onPress={() => go('/admin/payments', { purpose: 'promotion' })} />
        </TileGrid>
      </Section>

      <View style={[styles.charts, width >= 900 && styles.chartsWide]}>
        <Section title="Работы по статусам">
          <View style={styles.badges}>
            {Object.entries(d.artworks).map(([k, n]) => {
              const [text, tone] = label(artworkStatus, k);
              return (
                <Pressable key={k} accessibilityRole="button" onPress={() => go('/admin/artworks', { status: k })}>
                  <Badge text={`${text}: ${n}`} tone={tone} />
                </Pressable>
              );
            })}
          </View>
        </Section>
        <Section title="Заказы по статусам">
          <View style={styles.badges}>
            {Object.entries(d.orders).map(([k, n]) => {
              const [text, tone] = label(orderStatus, k);
              return (
                <Pressable key={k} accessibilityRole="button" onPress={() => go('/admin/orders', { status: k })}>
                  <Badge text={`${text}: ${n}`} tone={tone} />
                </Pressable>
              );
            })}
          </View>
        </Section>
      </View>

      {width < 900 ? (
        <Section title="Разделы">
          {adminSections.slice(1).map((s) => (
            <Pressable key={s.href} accessibilityRole="link" onPress={() => go(s.href)} style={styles.menuItem}>
              <Ionicons name={s.icon} size={22} color={colors.bordeaux} />
              <View style={styles.flex}>
                <T variant="bodyStrong">{s.label}</T>
                <T variant="small">{s.hint}</T>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.graphite} />
            </Pressable>
          ))}
        </Section>
      ) : null}
    </AdminScreen>
  );
}

const useStyles = makeStyles((c) => ({
  charts: { gap: space.lg },
  chartsWide: { flexDirection: 'row' },
  chart: { flex: 1, gap: space.sm, padding: space.lg, borderRadius: radius.control, backgroundColor: c.paper, borderWidth: 1, borderColor: c.hairline },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: c.hairline },
  flex: { flex: 1 },
}));
