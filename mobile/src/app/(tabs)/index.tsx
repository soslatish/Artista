import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText } from '@/api/client';
import { type CatalogFilters, flatten, useArtworks, useCatalogMeta, useCollections, useExhibitions, useNotifications, usePostsFeed } from '@/api/hooks';
import type { Post } from '@/api/types';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { ArtworkStrip, Gallery } from '@/ui/artwork';
import { ExhibitionCard, PostCard } from '@/ui/cards';
import { Button, Chip, EmptyState, ErrorState, IconButton, Loading, Notice, SectionHeader } from '@/ui/primitives';
import { makeStyles, space, useColors } from '@/ui/theme';

type Feed = NonNullable<CatalogFilters['feed']> | 'posts';

const feeds: { key: Feed; label: string; auth?: boolean }[] = [
  { key: 'new', label: 'Новое' },
  { key: 'popular', label: 'Популярное' },
  { key: 'for_you', label: 'Для вас', auth: true },
  { key: 'posts', label: 'Мастерские' },
];

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const [selectedFeed, setFeed] = useState<Feed>('new');
  const feed: Feed = !user && selectedFeed === 'for_you' ? 'new' : selectedFeed; // «Для вас» только с аккаунтом
  const notifications = useNotifications(!!user);
  const unread = notifications.data?.pages[0]?.meta.unread ?? 0;

  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.feeds}>
      {feeds
        .filter((f) => !f.auth || user)
        .map((f) => (
          <Chip key={f.key} label={t(f.label)} selected={feed === f.key} onPress={() => setFeed(f.key)} />
        ))}
    </ScrollView>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.band, { paddingTop: insets.top + space.sm }]}>
        <Image source={require('@/assets/images/wordmark.png')} style={styles.wordmark} contentFit="contain" accessibilityLabel="Artista" />
        <View style={styles.actions}>
          {user?.role === 'artist' ? <IconButton icon="add-circle-outline" label={t('Добавить работу')} color={colors.onDark} onPress={() => router.push('/artwork/new')} /> : null}
          {user ? (
            <IconButton icon="notifications-outline" label={t('Уведомления')} color={colors.onDark} badge={unread} onPress={() => router.push('/notifications')} />
          ) : null}
        </View>
      </View>
      {feed === 'posts' ? <PostsFeed header={chips} /> : <ArtworksFeed feed={feed} chips={chips} />}
    </View>
  );
}

function ArtworksFeed({ feed, chips }: { feed: Exclude<Feed, 'posts'>; chips: React.ReactElement }) {
  const t = useT();
  const q = useArtworks({ feed });
  const header = (
    <View style={{ marginHorizontal: -space.sm }}>
      <Announcement />
      {chips}
      {feed === 'new' ? <Showcase /> : null}
    </View>
  );
  if (q.isError && !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <Gallery
      items={flatten(q.data)}
      loading={q.isLoading}
      refreshing={q.isRefetching && !q.isFetchingNextPage}
      onRefresh={() => void q.refetch()}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      loadingMore={q.isFetchingNextPage}
      header={header}
      src="feed"
      empty={
        <EmptyState
          title={feed === 'for_you' ? t('Подпишитесь на художников') : t('Здесь пока пусто')}
          text={feed === 'for_you' ? t('Лента «Для вас» собирается из подписок и избранного.') : t('Скоро здесь появятся работы.')}
        />
      }
    />
  );
}

/** Витрина над лентой «Новое»: выставки, аукционы, подборки. */
function Showcase() {
  const t = useT();
  const styles = useStyles();
  const exhibitions = useExhibitions();
  const auctions = useArtworks({ auction: 'true', sort: 'ending' });
  const collections = useCollections();
  const exList = flatten(exhibitions.data);
  const auctionList = flatten(auctions.data);
  return (
    <View style={styles.showcase}>
      {exList.length ? (
        <View style={styles.block}>
          <View style={styles.pad}>
            <SectionHeader title={t('Выставки')} action={t('Все')} onAction={() => router.push('/exhibitions')} />
          </View>
          <FlatList
            horizontal
            data={exList}
            keyExtractor={(e) => e.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            renderItem={({ item }) => <ExhibitionCard e={item} width={160} />}
          />
        </View>
      ) : null}
      {auctionList.length ? (
        <View style={styles.block}>
          <View style={styles.pad}>
            <SectionHeader title={t('Аукционы')} />
          </View>
          <ArtworkStrip items={auctionList.slice(0, 12)} src="feed" />
        </View>
      ) : null}
      {(collections.data ?? []).map((c) => (
        <View key={c.id} style={styles.block}>
          <View style={styles.pad}>
            <SectionHeader title={t(c.title)} action={t('Все')} onAction={() => router.push({ pathname: '/collection/[slug]', params: { slug: c.slug } })} />
          </View>
          <ArtworkStrip items={c.preview ?? []} src="collection" />
        </View>
      ))}
      <View style={styles.pad}>
        <SectionHeader title={t('Новые работы')} />
      </View>
    </View>
  );
}

function PostsFeed({ header }: { header: React.ReactElement }) {
  const t = useT();
  const colors = useColors();
  const { user } = useSession();
  const q = usePostsFeed();
  if (q.isLoading) return <Loading />;
  if (q.isError && !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <FlashList
      data={flatten(q.data)}
      keyExtractor={(p: Post) => p.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={
        <View>
          {header}
          {user?.role === 'artist' ? (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
              <Button title={t('Рассказать о новой работе')} variant="secondary" icon="create-outline" onPress={() => router.push('/posts/new')} />
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={<EmptyState icon="newspaper-outline" title={t('Пока тихо')} text={t('Здесь появятся новости из мастерских художников, на которых вы подписаны.')} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
    />
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  band: {
    backgroundColor: c.brand,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  wordmark: { width: 132, height: 72 },
  actions: { flexDirection: 'row', gap: space.sm, paddingBottom: space.md },
  feeds: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.lg },
  showcase: { gap: space.xl, paddingBottom: space.lg },
  block: { gap: space.md },
  pad: { paddingHorizontal: space.lg },
  strip: { gap: space.md, paddingHorizontal: space.lg },
}));

/** Объявление администратора (настраивается в админке). */
function Announcement() {
  const { data } = useCatalogMeta();
  const text = data?.announcement?.trim();
  if (!text) return null;
  return (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
      <Notice text={text} />
    </View>
  );
}
