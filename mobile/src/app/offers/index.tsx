import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { errorText } from '@/api/client';
import { flatten, useOffers } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { offerNeedsAction, offerStatusLabel, offerTone } from '@/features/offer-status';
import { useT } from '@/i18n';
import { formatDate, formatPrice } from '@/lib/format';
import { Chip, EmptyState, ErrorState, Loading } from '@/ui/primitives';
import { DealRow } from '@/ui/rows';
import { makeStyles, space, useColors } from '@/ui/theme';

export default function OffersScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const param = useLocalSearchParams().role;
  // художнику по умолчанию показываем входящие; сессия может загрузиться после первого рендера, поэтому роль вычисляется
  const [chosen, setRole] = useState<'buyer' | 'artist' | null>(null);
  const role = chosen ?? (user?.role === 'artist' && param !== 'buyer' ? 'artist' : 'buyer');
  const q = useOffers(role, !!user);
  return (
    <View style={styles.root}>
      {user?.role === 'artist' ? (
        <View style={styles.tabs}>
          <Chip label={t('Мне предлагают')} selected={role === 'artist'} onPress={() => setRole('artist')} />
          <Chip label={t('Я предлагаю')} selected={role === 'buyer'} onPress={() => setRole('buyer')} />
        </View>
      ) : null}
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={flatten(q.data)}
          keyExtractor={(o) => o.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
          onEndReached={() => q.hasNextPage && q.fetchNextPage()}
          renderItem={({ item: o }) => (
            <DealRow
              image={o.artwork.image_url}
              title={o.artwork.title}
              subtitle={o.my_role === 'artist' ? `${o.buyer.name}, ${t('цена {p}', { p: formatPrice(o.price_kop) })}` : o.artist.name}
              status={offerStatusLabel(o, t)}
              statusColor={offerTone(o, colors)}
              highlight={offerNeedsAction(o)}
              right={formatPrice(o.agreed_kop ?? o.counter_kop ?? o.amount_kop)}
              rightSub={formatDate(o.created_at)}
              onPress={() => router.push({ pathname: '/offers/[id]', params: { id: o.id } })}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="pricetags-outline"
              title={t('Предложений пока нет')}
              text={role === 'artist' ? t('Включите «Принимать предложения цены» в работе — покупатели смогут предложить свою цену.') : t('Предложить цену можно на странице работы, если художник принимает предложения.')}
            />
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  tabs: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
}));
