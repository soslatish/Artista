import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { flatten, keys, useNotifications } from '@/api/hooks';
import type { AppNotification } from '@/api/types';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { formatMessageTime } from '@/lib/format';
import { validId } from '@/lib/guard';
import { EmptyState, ErrorState, type IconName, Loading, T } from '@/ui/primitives';
import { makeStyles, space, useColors } from '@/ui/theme';

const icons: Record<string, IconName> = {
  order_paid: 'bag-check-outline',
  order_confirmed: 'checkmark-circle-outline',
  order_shipped: 'cube-outline',
  order_completed: 'wallet-outline',
  order_cancelled: 'close-circle-outline',
  new_artwork: 'image-outline',
  new_review: 'star-outline',
  price_drop: 'pricetag-outline',
  saved_search: 'search-outline',
  offer_new: 'pricetags-outline',
  offer_accepted: 'checkmark-done-outline',
  offer_declined: 'close-outline',
  offer_countered: 'swap-horizontal-outline',
  auction_started: 'hammer-outline',
  auction_outbid: 'trending-up-outline',
  auction_won: 'trophy-outline',
  auction_ended: 'hammer-outline',
  commission_new: 'color-wand-outline',
  commission_quoted: 'color-wand-outline',
  commission_accepted: 'color-wand-outline',
  commission_declined: 'close-outline',
  commission_cancelled: 'close-outline',
  certificate_issued: 'ribbon-outline',
  question_new: 'help-circle-outline',
  question_answered: 'chatbox-ellipses-outline',
  new_post: 'newspaper-outline',
  exhibition_announced: 'easel-outline',
  exhibition_opened: 'easel-outline',
};

/** Куда ведёт уведомление (все id из данных уведомления проверяются). */
function open(n: AppNotification) {
  const id = (k: string) => validId(n.data[k]);
  const code = typeof n.data.certificate_code === 'string' && /^ART-[A-Z0-9-]{9}$/.test(n.data.certificate_code) ? n.data.certificate_code : null;
  if (id('order_id')) router.push({ pathname: '/orders/[id]', params: { id: id('order_id')! } });
  else if (id('offer_id')) router.push({ pathname: '/offers/[id]', params: { id: id('offer_id')! } });
  else if (id('commission_id')) router.push({ pathname: '/commissions/[id]', params: { id: id('commission_id')! } });
  else if (id('auction_id')) router.push({ pathname: '/auction/[id]', params: { id: id('auction_id')! } });
  else if (id('exhibition_id')) router.push({ pathname: '/exhibition/[id]', params: { id: id('exhibition_id')! } });
  else if (code) router.push({ pathname: '/certificate/[code]', params: { code } });
  else if (id('artwork_id')) router.push({ pathname: '/artwork/[id]', params: { id: id('artwork_id')!, src: 'notification' } });
  else if (id('artist_id')) router.push({ pathname: '/artist/[id]', params: { id: id('artist_id')! } });
}

export default function NotificationsScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const qc = useQueryClient();
  const q = useNotifications(!!user);
  const items = flatten(q.data);
  const unread = q.data?.pages[0]?.meta.unread ?? 0;

  useEffect(() => {
    if (!unread) return;
    const timer = setTimeout(() => {
      post('/notifications/read')
        .then(() => qc.invalidateQueries({ queryKey: keys.notifications }))
        .catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, [unread, qc]);

  if (q.isLoading) return <Loading />;
  if (q.isError && !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <FlatList
      style={styles.root}
      data={items}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
      onEndReached={() => q.hasNextPage && q.fetchNextPage()}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListEmptyComponent={<EmptyState icon="notifications-outline" title={t('Пока тихо')} text={t('Здесь появятся заказы, отзывы и новые работы художников, на которых вы подписаны.')} />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => open(item)} style={({ pressed }) => [styles.row, !item.read_at && styles.unread, pressed && styles.pressed]}>
          <Ionicons name={icons[item.type] ?? 'notifications-outline'} size={24} color={colors.bordeaux} />
          <View style={styles.body}>
            <T variant="bodyStrong">{item.title}</T>
            {item.body ? <T variant="body">{item.body}</T> : null}
            <T variant="small">{formatMessageTime(item.created_at)}</T>
          </View>
        </Pressable>
      )}
    />
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  row: { flexDirection: 'row', gap: space.md, padding: space.lg },
  unread: { backgroundColor: c.goldSoft },
  pressed: { backgroundColor: c.plaster },
  body: { flex: 1, gap: 2 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.hairline },
}));
