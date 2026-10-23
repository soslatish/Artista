import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ComponentProps, useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { flatten, keys, useNotifications } from '@/api/hooks';
import type { AppNotification } from '@/api/types';
import { useSession } from '@/auth/session';
import { formatMessageTime } from '@/lib/format';
import { validId } from '@/lib/guard';
import { EmptyState, ErrorState, Loading, T } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

const icons: Record<string, ComponentProps<typeof Ionicons>['name']> = {
  order_paid: 'bag-check-outline',
  order_confirmed: 'checkmark-circle-outline',
  order_shipped: 'cube-outline',
  order_completed: 'wallet-outline',
  order_cancelled: 'close-circle-outline',
  new_artwork: 'image-outline',
  new_review: 'star-outline',
};

function open(n: AppNotification) {
  const orderId = validId(n.data.order_id);
  const artworkId = validId(n.data.artwork_id);
  if (orderId) router.push({ pathname: '/orders/[id]', params: { id: orderId } });
  else if (artworkId) router.push({ pathname: '/artwork/[id]', params: { id: artworkId } });
}

export default function NotificationsScreen() {
  const { user } = useSession();
  const qc = useQueryClient();
  const q = useNotifications(!!user);
  const items = flatten(q.data);
  const unread = q.data?.pages[0]?.meta.unread ?? 0;

  useEffect(() => {
    if (!unread) return;
    const t = setTimeout(() => {
      post('/notifications/read')
        .then(() => qc.invalidateQueries({ queryKey: keys.notifications }))
        .catch(() => undefined);
    }, 1500);
    return () => clearTimeout(t);
  }, [unread, qc]);

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <FlatList
      style={styles.root}
      data={items}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
      onEndReached={() => q.hasNextPage && q.fetchNextPage()}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListEmptyComponent={<EmptyState icon="notifications-outline" title="Пока тихо" text="Здесь появятся заказы, отзывы и новые работы художников, на которых вы подписаны." />}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  row: { flexDirection: 'row', gap: space.md, padding: space.lg },
  unread: { backgroundColor: colors.goldSoft },
  pressed: { backgroundColor: colors.plaster },
  body: { flex: 1, gap: 2 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
});
