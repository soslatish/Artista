import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ApiError, errorText } from '@/api/client';
import { useDetailedStats, usePromotions, useStats } from '@/api/hooks';
import type { DetailedStats } from '@/api/types';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { formatDate, formatPrice } from '@/lib/format';
import { openArtwork } from '@/ui/artwork';
import { Button, Chip, ErrorState, Loading, SectionHeader, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const sourceLabels: Record<string, string> = {
  feed: 'Лента',
  search: 'Поиск',
  similar: 'Похожие работы',
  collection: 'Подборки',
  share: 'Ссылки и шеринг',
  profile: 'Ваш профиль',
  favorites: 'Избранное',
  notification: 'Уведомления',
  history: 'История просмотров',
  exhibition: 'Выставки',
  post: 'Посты',
  other: 'Другое',
};

export default function StatsScreen() {
  const t = useT();
  const styles = useStyles();
  const { user } = useSession();
  const q = useStats(user?.role === 'artist');
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  const s = q.data;
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <T variant="small" color="rgba(255,255,255,0.72)">
          {t('Выручка за этот месяц')}
        </T>
        <T variant="priceLarge" color="#FFFFFF">
          {formatPrice(s.revenue_month_kop)}
        </T>
        <T variant="small" color="rgba(255,255,255,0.72)">
          {t('Продано работ: {n}. После комиссии.', { n: s.sales_month })}
        </T>
      </View>
      <View style={styles.grid}>
        <Cell label={t('Просмотры работ')} value={String(s.total_views)} />
        <Cell label={t('В избранном')} value={String(s.total_favorites)} />
        <Cell label={t('Подписчики')} value={String(s.followers)} />
        <Cell label={t('В продаже')} value={String(s.published_artworks)} />
        <Cell label={t('Всего продаж')} value={String(s.sales_total)} />
        <Cell label={t('Выручка за всё время')} value={formatPrice(s.revenue_total_kop)} />
      </View>
      {s.active_orders > 0 ? <Button title={t('Активные заказы: {n}', { n: s.active_orders })} onPress={() => router.push({ pathname: '/orders', params: { role: 'artist' } })} /> : null}
      <Detailed isPremium={!!user?.is_premium} />
      <Promotions />
    </ScrollView>
  );
}

/** Расширенная статистика — часть премиума. */
function Detailed({ isPremium }: { isPremium: boolean }) {
  const t = useT();
  const styles = useStyles();
  const [days, setDays] = useState(30);
  const q = useDetailedStats(days, isPremium);
  if (!isPremium || (q.error instanceof ApiError && q.error.code === 'premium_required')) {
    return (
      <View style={styles.premium}>
        <T variant="heading">{t('Откуда приходят покупатели')}</T>
        <T variant="small">{t('С премиумом — просмотры по дням, источники, воронка от просмотра до продажи и 0% комиссии до 100 000 ₽ в месяц.')}</T>
        <Button title={t('Подробнее о премиуме')} variant="secondary" onPress={() => router.push('/premium')} />
      </View>
    );
  }
  return (
    <View style={styles.block}>
      <SectionHeader title={t('Подробно')} />
      <View style={styles.chips}>
        {[7, 30, 90].map((d) => (
          <Chip key={d} label={t('{n} дней', { n: d })} selected={days === d} onPress={() => setDays(d)} />
        ))}
      </View>
      {q.isLoading ? <Loading /> : q.data ? <DetailedView s={q.data} /> : q.error ? <T variant="small">{errorText(q.error)}</T> : null}
    </View>
  );
}

function DetailedView({ s }: { s: DetailedStats }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const max = Math.max(1, ...s.views_by_day.map((p) => p.value));
  const totalSources = s.sources.reduce((sum, x) => sum + x.views, 0) || 1;
  const steps = [
    { label: t('Просмотры'), value: s.funnel.views },
    { label: t('В избранное'), value: s.funnel.favorites },
    { label: t('Заказы'), value: s.funnel.orders },
    { label: t('Продажи'), value: s.funnel.sales },
  ];
  return (
    <View style={styles.block}>
      <T variant="heading">{t('Просмотры по дням')}</T>
      <View style={styles.chart} accessible accessibilityLabel={t('Всего просмотров за период: {n}', { n: s.funnel.views })}>
        {s.views_by_day.map((p) => (
          <View key={p.date} style={styles.barSlot}>
            <View style={[styles.bar, { height: `${Math.max(2, (p.value / max) * 100)}%`, backgroundColor: p.value ? colors.bordeaux : colors.hairline }]} />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <T variant="small">{s.views_by_day[0] ? formatDate(s.views_by_day[0].date) : ''}</T>
        <T variant="small">{t('макс. {n} в день', { n: max })}</T>
        <T variant="small">{s.views_by_day.at(-1) ? formatDate(s.views_by_day.at(-1)!.date) : ''}</T>
      </View>

      <T variant="heading">{t('Воронка')}</T>
      {steps.map((st) => (
        <View key={st.label} style={styles.funnelRow}>
          <T variant="body" style={styles.flex}>
            {st.label}
          </T>
          <T variant="bodyStrong">{st.value}</T>
        </View>
      ))}
      <T variant="small">{t('Новых подписчиков: {n}', { n: s.new_followers })}</T>

      {s.sources.length ? (
        <>
          <T variant="heading">{t('Источники просмотров')}</T>
          {s.sources.map((src) => (
            <View key={src.source} style={styles.sourceRow}>
              <T variant="body" style={styles.sourceLabel}>
                {t(sourceLabels[src.source] ?? 'Другое')}
              </T>
              <View style={styles.sourceTrack}>
                <View style={[styles.sourceFill, { width: `${(src.views / totalSources) * 100}%` }]} />
              </View>
              <T variant="smallStrong">{Math.round((src.views / totalSources) * 100)}%</T>
            </View>
          ))}
        </>
      ) : null}

      {s.top_artworks.length ? (
        <>
          <T variant="heading">{t('Лучшие работы')}</T>
          {s.top_artworks.map((a) => (
            <Pressable key={a.id} accessibilityRole="button" onPress={() => openArtwork(a.id)} style={styles.topRow}>
              {a.image_url ? <Image source={{ uri: a.image_url }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
              <View style={styles.flex}>
                <T variant="artTitleSmall" numberOfLines={1}>
                  {a.title}
                </T>
                <T variant="small">{t('{v} просмотров, {f} в избранном, {o} заказов', { v: a.views, f: a.favorites, o: a.orders })}</T>
              </View>
            </Pressable>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Promotions() {
  const t = useT();
  const styles = useStyles();
  const q = usePromotions(true);
  if (!q.data?.length) return null;
  return (
    <View style={styles.block}>
      <SectionHeader title={t('Продвижение')} />
      {q.data.map((p) => (
        <Pressable key={p.id} accessibilityRole="button" onPress={() => openArtwork(p.artwork.id)} style={styles.topRow}>
          {p.artwork.image_url ? <Image source={{ uri: p.artwork.image_url }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
          <View style={styles.flex}>
            <T variant="artTitleSmall" numberOfLines={1}>
              {p.artwork.title}
            </T>
            <T variant="small">
              {p.status === 'active' && p.ends_at ? t('Продвигается до {date}', { date: formatDate(p.ends_at) }) : t('Завершено')}, {formatPrice(p.price_kop)}
            </T>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.cell}>
      <T variant="priceLarge">{value}</T>
      <T variant="small">{label}</T>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  hero: { backgroundColor: c.brand, padding: space.xl, borderRadius: radius.control, gap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { flexBasis: '47%', flexGrow: 1, padding: space.lg, borderRadius: radius.control, backgroundColor: c.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, gap: 2 },
  premium: { gap: space.sm, padding: space.lg, borderRadius: radius.control, backgroundColor: c.goldSoft },
  block: { gap: space.md },
  chips: { flexDirection: 'row', gap: space.sm },
  chart: { height: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  funnelRow: { flexDirection: 'row', paddingVertical: space.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairline },
  flex: { flex: 1 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sourceLabel: { width: 130 },
  sourceTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.plaster, overflow: 'hidden' },
  sourceFill: { height: 8, backgroundColor: c.gold },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 48, height: 60, borderRadius: radius.art, backgroundColor: c.plaster },
}));
