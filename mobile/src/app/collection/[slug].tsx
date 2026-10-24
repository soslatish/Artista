import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { errorText } from '@/api/client';
import { flatten, pageMeta, useCollection } from '@/api/hooks';
import type { Collection } from '@/api/types';
import { shareLink } from '@/features/share';
import { useT } from '@/i18n';
import { Gallery } from '@/ui/artwork';
import { EmptyState, ErrorState, IconButton, T } from '@/ui/primitives';
import { makeStyles, space, useColors } from '@/ui/theme';

const slugPattern = /^[a-z0-9-]{1,64}$/;

export default function CollectionRoute() {
  const raw = useLocalSearchParams().slug;
  const t = useT();
  const slug = typeof raw === 'string' && slugPattern.test(raw) ? raw : '';
  if (!slug) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <CollectionScreen slug={slug} />;
}

function CollectionScreen({ slug }: { slug: string }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const q = useCollection(slug);
  const c = pageMeta<Collection>(q.data, 'collection');
  if (q.isError && !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: c?.title ?? t('Подборка'),
          headerRight: () =>
            c ? <IconButton icon="share-outline" color={colors.ink} label={t('Поделиться')} onPress={() => void shareLink(`/collections/${slug}`, c.title)} /> : null,
        }}
      />
      <Gallery
        items={flatten(q.data)}
        loading={q.isLoading}
        src="collection"
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        onRefresh={() => void q.refetch()}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        loadingMore={q.isFetchingNextPage}
        header={
          c ? (
            <View style={styles.head}>
              <T variant="display">{c.title}</T>
              {c.subtitle ? <T variant="body">{c.subtitle}</T> : null}
            </View>
          ) : null
        }
        empty={<EmptyState title={t('Подборка пока пуста')} text={t('Загляните позже — мы добавляем работы каждую неделю.')} />}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  head: { paddingHorizontal: space.sm, paddingTop: space.lg, paddingBottom: space.xl, gap: space.sm },
}));
