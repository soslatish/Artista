import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, useWindowDimensions, View } from 'react-native';

import { errorText } from '@/api/client';
import { flatten, useExhibitions } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { ExhibitionCard } from '@/ui/cards';
import { Button, Chip, EmptyState, ErrorState, Loading } from '@/ui/primitives';
import { makeStyles, space, useColors } from '@/ui/theme';

type Scope = 'upcoming' | 'open' | 'mine';

export default function ExhibitionsScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { user } = useSession();
  const isArtist = user?.role === 'artist';
  const [scope, setScope] = useState<Scope>(useLocalSearchParams().mine === '1' && isArtist ? 'mine' : 'upcoming');
  const q = useExhibitions(scope === 'mine' ? { artist_id: user?.id } : { status: scope });
  const cardWidth = (Math.min(width, 720) - space.lg * 2 - space.md) / 2;
  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <Chip label={t('Скоро')} selected={scope === 'upcoming'} onPress={() => setScope('upcoming')} />
        <Chip label={t('Открыты')} selected={scope === 'open'} onPress={() => setScope('open')} />
        {isArtist ? <Chip label={t('Мои')} selected={scope === 'mine'} onPress={() => setScope('mine')} /> : null}
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.isError && !q.data ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          key={scope}
          data={flatten(q.data)}
          numColumns={2}
          keyExtractor={(e) => e.id}
          columnWrapperStyle={styles.columns}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
          onEndReached={() => q.hasNextPage && q.fetchNextPage()}
          renderItem={({ item }) => <ExhibitionCard e={item} width={cardWidth} />}
          ListHeaderComponent={isArtist && scope === 'mine' ? <Button title={t('Новая выставка')} icon="add" onPress={() => router.push('/exhibitions/new')} style={styles.cta} /> : undefined}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title={scope === 'mine' ? t('У вас пока нет выставок') : scope === 'open' ? t('Сейчас нет открытых выставок') : t('Анонсов пока нет')}
              text={
                scope === 'mine'
                  ? t('Соберите серию из черновиков и назначьте дату — подписчики получат напоминание, а работы откроются для покупки все разом.')
                  : t('Художники анонсируют новые серии заранее. Нажмите «Напомнить», чтобы не пропустить открытие.')
              }
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
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.xl },
  columns: { gap: space.md },
  cta: { marginBottom: space.lg },
}));
