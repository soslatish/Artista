import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { errorText } from '@/api/client';
import { flatten, useMyArtworks } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { Gallery } from '@/ui/artwork';
import { Button, Chip, EmptyState, ErrorState } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

const filters: { key?: string; label: string }[] = [
  { label: 'Все' },
  { key: 'published', label: 'В продаже' },
  { key: 'draft', label: 'Черновики' },
  { key: 'reserved', label: 'В заказе' },
  { key: 'sold', label: 'Проданы' },
  { key: 'archived', label: 'Архив' },
];

export default function MyArtworksScreen() {
  const { user } = useSession();
  const [status, setStatus] = useState<string | undefined>();
  const q = useMyArtworks(status, user?.role === 'artist');

  const header = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {filters.map((f) => (
        <Chip key={f.label} label={f.label} selected={status === f.key} onPress={() => setStatus(f.key)} />
      ))}
    </ScrollView>
  );

  return (
    <View style={styles.root}>
      {q.isError ? (
        <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <Gallery
          items={flatten(q.data)}
          loading={q.isLoading}
          showStatus
          refreshing={q.isRefetching && !q.isFetchingNextPage}
          onRefresh={() => void q.refetch()}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          loadingMore={q.isFetchingNextPage}
          header={header}
          empty={
            <EmptyState
              icon="brush-outline"
              title={status ? 'Здесь пусто' : 'Добавьте первую работу'}
              text="Публикация бесплатна. Хорошие фото при дневном свете продают лучше всего."
              action={<Button title="Добавить работу" onPress={() => router.push('/artwork/new')} />}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  filters: { gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.md },
});
