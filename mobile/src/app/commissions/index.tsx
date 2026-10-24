import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { errorText } from '@/api/client';
import { flatten, useCommissions } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { commissionNeedsAction, commissionStatusLabel, commissionTone } from '@/features/commission-status';
import { SignInGate } from '@/features/sign-in-gate';
import { useT } from '@/i18n';
import { formatDate, formatPrice } from '@/lib/format';
import { Chip, EmptyState, ErrorState, Loading } from '@/ui/primitives';
import { DealRow } from '@/ui/rows';
import { makeStyles, space, useColors } from '@/ui/theme';

export default function CommissionsScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const param = useLocalSearchParams().role;
  // художнику по умолчанию показываем входящие; сессия может загрузиться после первого рендера, поэтому роль вычисляется
  const [chosen, setRole] = useState<'buyer' | 'artist' | null>(null);
  const role = chosen ?? (user?.role === 'artist' && param !== 'buyer' ? 'artist' : 'buyer');
  const q = useCommissions(role, !!user);
  if (!user) return <SignInGate text={t('Войдите, чтобы заказать работу у художника.')} />;
  return (
    <View style={styles.root}>
      {user?.role === 'artist' ? (
        <View style={styles.tabs}>
          <Chip label={t('Мне заказали')} selected={role === 'artist'} onPress={() => setRole('artist')} />
          <Chip label={t('Я заказал')} selected={role === 'buyer'} onPress={() => setRole('buyer')} />
        </View>
      ) : null}
      {q.isLoading ? (
        <Loading />
      ) : q.isError && !q.data ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={flatten(q.data)}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
          onEndReached={() => q.hasNextPage && q.fetchNextPage()}
          renderItem={({ item: c }) => (
            <DealRow
              image={c.images[0]}
              title={c.my_role === 'artist' ? c.buyer.name : c.artist.name}
              subtitle={c.description}
              status={commissionStatusLabel(c, t)}
              statusColor={commissionTone(c, colors)}
              highlight={commissionNeedsAction(c)}
              right={c.quote_kop ? formatPrice(c.quote_kop) : c.budget_kop ? `≤ ${formatPrice(c.budget_kop)}` : undefined}
              rightSub={formatDate(c.created_at)}
              onPress={() => router.push({ pathname: '/commissions/[id]', params: { id: c.id } })}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="brush-outline"
              title={t('Заказов на создание пока нет')}
              text={role === 'artist' ? t('Включите приём заказов в настройках мастерской — покупатели смогут попросить работу под их интерьер.') : t('Попросить художника написать работу можно в его профиле, если он принимает заказы.')}
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
