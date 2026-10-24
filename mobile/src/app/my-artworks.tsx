import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { errorText } from '@/api/client';
import { flatten, useMyArtworks } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { Gallery } from '@/ui/artwork';
import { Button, Chip, EmptyState, ErrorState } from '@/ui/primitives';
import { makeStyles, space } from '@/ui/theme';

const filters: { key?: string; label: string }[] = [
  { label: 'Все' },
  { key: 'published', label: 'В продаже' },
  { key: 'draft', label: 'Черновики' },
  { key: 'scheduled', label: 'На выставке' },
  { key: 'auction', label: 'На аукционе' },
  { key: 'reserved', label: 'В заказе' },
  { key: 'sold', label: 'Проданы' },
  { key: 'commission', label: 'На заказ' },
  { key: 'archived', label: 'Архив' },
];

export default function MyArtworksScreen() {
  const t = useT();
  const styles = useStyles();
  const { user } = useSession();
  const [status, setStatus] = useState<string | undefined>();
  const q = useMyArtworks(status, user?.role === 'artist');

  const header = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {filters.map((f) => (
        <Chip key={f.label} label={t(f.label)} selected={status === f.key} onPress={() => setStatus(f.key)} />
      ))}
    </ScrollView>
  );

  return (
    <View style={styles.root}>
      {q.isError && !q.data ? (
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
              title={status ? t('Здесь пусто') : t('Добавьте первую работу')}
              text={t('Публикация бесплатна. Хорошие фото при дневном свете продают лучше всего.')}
              action={<Button title={t('Добавить работу')} onPress={() => router.push('/artwork/new')} />}
            />
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  filters: { gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.md },
}));
