import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type CatalogFilters, flatten, useArtworks, useNotifications } from '@/api/hooks';
import { errorText } from '@/api/client';
import { useSession } from '@/auth/session';
import { Gallery } from '@/ui/artwork';
import { Chip, EmptyState, ErrorState, IconButton } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

type Feed = NonNullable<CatalogFilters['feed']>;

const feeds: { key: Feed; label: string }[] = [
  { key: 'new', label: 'Новое' },
  { key: 'popular', label: 'Популярное' },
  { key: 'for_you', label: 'Для вас' },
];

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const [feed, setFeed] = useState<Feed>('new');
  const q = useArtworks({ feed });
  const notifications = useNotifications(!!user);
  const unread = notifications.data?.pages[0]?.meta.unread ?? 0;
  const items = flatten(q.data);

  const header = (
    <View style={styles.feeds}>
      {feeds
        .filter((f) => f.key !== 'for_you' || user)
        .map((f) => (
          <Chip key={f.key} label={f.label} selected={feed === f.key} onPress={() => setFeed(f.key)} />
        ))}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.band, { paddingTop: insets.top + space.sm }]}>
        <Image source={require('@/assets/images/wordmark.png')} style={styles.wordmark} contentFit="contain" accessibilityLabel="Artista" />
        <View style={styles.actions}>
          {user?.role === 'artist' ? (
            <IconButton icon="add-circle-outline" label="Добавить работу" color={colors.onDark} onPress={() => router.push('/artwork/new')} />
          ) : null}
          {user ? (
            <IconButton icon="notifications-outline" label="Уведомления" color={colors.onDark} badge={unread} onPress={() => router.push('/notifications')} />
          ) : null}
        </View>
      </View>
      {q.isError ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <Gallery
          items={items}
          loading={q.isLoading}
          refreshing={q.isRefetching && !q.isFetchingNextPage}
          onRefresh={() => void q.refetch()}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          loadingMore={q.isFetchingNextPage}
          header={header}
          empty={
            <EmptyState
              title={feed === 'for_you' ? 'Подпишитесь на художников' : 'Здесь пока пусто'}
              text={feed === 'for_you' ? 'Лента «Для вас» собирается из подписок и избранного.' : 'Скоро здесь появятся работы.'}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  band: {
    backgroundColor: colors.bordeaux,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  wordmark: { width: 132, height: 72 },
  actions: { flexDirection: 'row', gap: space.sm, paddingBottom: space.md },
  feeds: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.sm, paddingTop: space.lg, paddingBottom: space.lg },
});
