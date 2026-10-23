import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { errorText } from '@/api/client';
import { flatten, useOrders } from '@/api/hooks';
import type { Order } from '@/api/types';
import { useSession } from '@/auth/session';
import { orderStatusLabel, statusTone } from '@/features/order-status';
import { formatDate, formatPrice } from '@/lib/format';
import { Chip, EmptyState, ErrorState, Loading, T } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

type RoleTab = 'buyer' | 'artist';

export default function OrdersScreen() {
  const { user } = useSession();
  const param = useLocalSearchParams().role;
  const [role, setRole] = useState<RoleTab>(param === 'artist' && user?.role === 'artist' ? 'artist' : 'buyer');
  const q = useOrders(role, undefined, !!user);
  const items = flatten(q.data);

  return (
    <View style={styles.root}>
      {user?.role === 'artist' ? (
        <View style={styles.tabs}>
          <Chip label="Покупки" selected={role === 'buyer'} onPress={() => setRole('buyer')} />
          <Chip label="Продажи" selected={role === 'artist'} onPress={() => setRole('artist')} />
        </View>
      ) : null}
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(o) => o.id}
          renderItem={({ item }) => <OrderRow o={item} />}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
          onEndReached={() => q.hasNextPage && q.fetchNextPage()}
          ListEmptyComponent={
            <EmptyState
              icon={role === 'artist' ? 'cash-outline' : 'bag-handle-outline'}
              title={role === 'artist' ? 'Продаж пока нет' : 'Заказов пока нет'}
              text={role === 'artist' ? 'Когда работу купят, заказ появится здесь.' : 'Купленные работы появятся здесь.'}
            />
          }
        />
      )}
    </View>
  );
}

function OrderRow({ o }: { o: Order }) {
  const counterpart = o.my_role === 'artist' ? o.buyer.name : o.artist.name;
  const needsAction = (o.my_role === 'artist' && (o.status === 'paid' || o.status === 'confirmed')) || (o.my_role === 'buyer' && (o.status === 'shipped' || o.status === 'awaiting_payment'));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${o.artwork.title}, ${orderStatusLabel[o.status]}`}
      onPress={() => router.push({ pathname: '/orders/[id]', params: { id: o.id } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {o.artwork.image_url ? <Image source={{ uri: o.artwork.image_url }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
      <View style={styles.body}>
        <T variant="artTitleSmall" numberOfLines={1}>
          {o.artwork.title}
        </T>
        <T variant="small">
          {o.my_role === 'artist' ? 'Покупатель' : 'Художник'}: {counterpart}
        </T>
        <View style={styles.statusRow}>
          {needsAction ? <View style={styles.dot} /> : null}
          <T variant="smallStrong" color={statusTone(o.status)}>
            {orderStatusLabel[o.status]}
          </T>
        </View>
      </View>
      <View style={styles.right}>
        <T variant="price">{formatPrice(o.my_role === 'artist' ? (o.payout_kop ?? o.price_kop) : o.total_kop)}</T>
        <T variant="small">{formatDate(o.created_at)}</T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  tabs: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  list: { paddingBottom: space.xxl },
  row: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, alignItems: 'center' },
  pressed: { backgroundColor: colors.plaster },
  thumb: { width: 56, height: 70, borderRadius: radius.art, backgroundColor: colors.plaster },
  body: { flex: 1, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold },
  right: { alignItems: 'flex-end', gap: 2 },
});
