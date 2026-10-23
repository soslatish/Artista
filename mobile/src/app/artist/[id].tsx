import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { flatten, useFollow, useReviews, useUser, useUserArtworks } from '@/api/hooks';
import type { Conversation, PublicUser } from '@/api/types';
import { useSession } from '@/auth/session';
import { countLabel, formatDate } from '@/lib/format';
import { requireAuth, validId } from '@/lib/guard';
import { Gallery } from '@/ui/artwork';
import { Avatar, Button, Chip, EmptyState, ErrorState, Loading, Notice, PremiumMark, T } from '@/ui/primitives';
import { colors, space } from '@/ui/theme';

export default function ArtistRoute() {
  const id = validId(useLocalSearchParams().id);
  if (!id) return <ErrorState text="Ссылка повреждена." />;
  return <ArtistScreen id={id} />;
}

function ArtistScreen({ id }: { id: string }) {
  const user = useUser(id);
  const artworks = useUserArtworks(id);
  const [tab, setTab] = useState<'works' | 'reviews'>('works');
  if (user.isLoading) return <Loading />;
  if (user.isError || !user.data) return <ErrorState text={errorText(user.error)} onRetry={() => user.refetch()} />;
  const header = <ArtistHeader u={user.data} tab={tab} onTab={setTab} />;
  if (tab === 'reviews') return <ReviewsList id={id} header={header} />;
  return (
    <Gallery
      items={flatten(artworks.data)}
      loading={artworks.isLoading}
      onEndReached={() => artworks.hasNextPage && !artworks.isFetchingNextPage && artworks.fetchNextPage()}
      loadingMore={artworks.isFetchingNextPage}
      header={header}
      empty={<EmptyState title="Работ пока нет" text="Подпишитесь, чтобы узнать о новых работах первыми." />}
    />
  );
}

function ArtistHeader({ u, tab, onTab }: { u: PublicUser; tab: 'works' | 'reviews'; onTab: (t: 'works' | 'reviews') => void }) {
  const { user } = useSession();
  const follow = useFollow(u.id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isMe = user?.id === u.id;
  const isArtist = u.role === 'artist';

  const write = async () => {
    if (!requireAuth(!!user)) return;
    setBusy(true);
    try {
      const c = await post<Conversation>('/conversations', { user_id: u.id });
      router.push({ pathname: '/chat/[id]', params: { id: c.id, name: u.name } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const links = Object.entries(u.social ?? {}).filter(([, v]) => v);
  return (
    <View style={styles.head}>
      <View style={styles.identity}>
        <Avatar uri={u.avatar_url} name={u.name} size={88} />
        <View style={styles.nameRow}>
          <T variant="display" center>
            {u.name}
          </T>
          {u.is_premium ? <PremiumMark /> : null}
        </View>
        <T variant="small" center>
          {[isArtist ? 'Художник' : 'Коллекционер', u.city].filter(Boolean).join(', ')}
        </T>
      </View>
      {isArtist ? (
        <View style={styles.stats}>
          <Stat value={u.rating ? u.rating.toFixed(1).replace('.', ',') : '—'} label={countLabel(u.reviews_count, ['отзыв', 'отзыва', 'отзывов'])} />
          <Stat value={String(u.artworks_count)} label="в продаже" />
          <Stat value={String(u.followers)} label="подписчиков" />
        </View>
      ) : null}
      {u.bio ? <T variant="body">{u.bio}</T> : null}
      {links.length ? (
        <View style={styles.links}>
          {links.map(([k, v]) => (
            <Pressable
              key={k}
              accessibilityRole="link"
              onPress={() => Linking.openURL(k === 'telegram' && !v.startsWith('http') ? `https://t.me/${v.replace('@', '')}` : v)}
              style={styles.link}>
              <Ionicons name={k === 'telegram' ? 'paper-plane-outline' : k === 'vk' ? 'people-outline' : 'globe-outline'} size={16} color={colors.bordeaux} />
              <T variant="smallStrong" color={colors.bordeaux}>
                {k === 'vk' ? 'ВКонтакте' : k === 'telegram' ? 'Telegram' : k === 'behance' ? 'Behance' : 'Сайт'}
              </T>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      {!isMe && isArtist ? (
        <View style={styles.actions}>
          <Button
            title={u.is_following ? 'Вы подписаны' : 'Подписаться'}
            variant={u.is_following ? 'secondary' : 'primary'}
            style={styles.flex}
            loading={follow.isPending}
            onPress={() => requireAuth(!!user) && follow.mutate(!u.is_following)}
          />
          <Button title="Написать" variant="secondary" style={styles.flex} loading={busy} onPress={write} />
        </View>
      ) : null}
      {isMe ? <Button title="Редактировать профиль" variant="secondary" onPress={() => router.push('/settings/profile')} /> : null}
      {isArtist ? (
        <View style={styles.tabs}>
          <Chip label="Работы" selected={tab === 'works'} onPress={() => onTab('works')} />
          <Chip label="Отзывы" selected={tab === 'reviews'} onPress={() => onTab('reviews')} />
        </View>
      ) : null}
      <T variant="small">На Artista с {formatDate(u.created_at)}</T>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <T variant="priceLarge">{value}</T>
      <T variant="small">{label}</T>
    </View>
  );
}

function ReviewsList({ id, header }: { id: string; header: React.ReactElement }) {
  const q = useReviews(id);
  const items = flatten(q.data);
  return (
    <View style={styles.reviewsRoot}>
      <View style={styles.pad}>{header}</View>
      {q.isLoading ? <Loading /> : null}
      {!q.isLoading && items.length === 0 ? <EmptyState icon="star-outline" title="Отзывов пока нет" text="Отзыв появляется после завершённой покупки." /> : null}
      {items.map((r) => (
        <View key={r.id} style={styles.review}>
          <View style={styles.reviewHead}>
            <Avatar uri={r.author.avatar_url} name={r.author.name} size={32} />
            <T variant="bodyStrong" style={styles.flex}>
              {r.author.name}
            </T>
            <T variant="smallStrong" color={colors.gold} accessibilityLabel={`Оценка ${r.rating} из 5`}>
              {'★'.repeat(r.rating)}
              <T variant="smallStrong" color={colors.hairline}>
                {'★'.repeat(5 - r.rating)}
              </T>
            </T>
          </View>
          <T variant="artTitleSmall">{r.artwork_title}</T>
          {r.text ? <T variant="body">{r.text}</T> : null}
          <T variant="small">{formatDate(r.created_at)}</T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.sm, paddingTop: space.lg, paddingBottom: space.xl, gap: space.lg },
  identity: { alignItems: 'center', gap: space.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  stat: { alignItems: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  actions: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
  tabs: { flexDirection: 'row', gap: space.sm },
  reviewsRoot: { flex: 1, backgroundColor: colors.wall },
  pad: { paddingHorizontal: space.sm },
  review: { marginHorizontal: space.lg, paddingVertical: space.lg, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
