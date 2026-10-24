import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Linking, Pressable, ScrollView, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { flatten, useFollow, useReviews, useUser, useUserArtworks, useUserPosts, useUserSeries } from '@/api/hooks';
import type { Conversation, Post, PublicUser } from '@/api/types';
import { useSession } from '@/auth/session';
import { shareLink } from '@/features/share';
import { useT } from '@/i18n';
import { countLabel, formatDate } from '@/lib/format';
import { requireAuth, validId } from '@/lib/guard';
import { Gallery } from '@/ui/artwork';
import { PostCard } from '@/ui/cards';
import { Avatar, Button, Chip, EmptyState, ErrorState, IconButton, Loading, Notice, PremiumMark, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

type Tab = 'works' | 'posts' | 'reviews';

export default function ArtistRoute() {
  const id = validId(useLocalSearchParams().id);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <ArtistScreen id={id} />;
}

function ArtistScreen({ id }: { id: string }) {
  const t = useT();
  const user = useUser(id);
  const [tab, setTab] = useState<Tab>('works');
  const [seriesId, setSeriesId] = useState<string | undefined>();
  const artworks = useUserArtworks(id, seriesId);
  if (user.isLoading) return <Loading />;
  if (user.isError || !user.data) return <ErrorState text={errorText(user.error)} onRetry={() => user.refetch()} />;
  const u = user.data;
  const header = <ArtistHeader u={u} tab={tab} onTab={setTab} seriesId={seriesId} onSeries={setSeriesId} />;
  const share = <Stack.Screen options={{ headerRight: () => <IconButton icon="share-outline" label={t('Поделиться')} onPress={() => shareLink(`/u/${u.id}`, `${u.name} — Artista`)} /> }} />;
  if (tab === 'reviews') return <>{share}<ReviewsList id={id} header={header} /></>;
  if (tab === 'posts') return <>{share}<PostsList id={id} header={header} /></>;
  return (
    <>
      {share}
      <Gallery
        items={flatten(artworks.data)}
        loading={artworks.isLoading}
        src="profile"
        onEndReached={() => artworks.hasNextPage && !artworks.isFetchingNextPage && artworks.fetchNextPage()}
        loadingMore={artworks.isFetchingNextPage}
        header={header}
        empty={<EmptyState title={t('Работ пока нет')} text={t('Подпишитесь, чтобы узнать о новых работах первыми.')} />}
      />
    </>
  );
}

interface HeaderProps {
  u: PublicUser;
  tab: Tab;
  onTab: (t: Tab) => void;
  seriesId?: string;
  onSeries: (id?: string) => void;
}

function ArtistHeader({ u, tab, onTab, seriesId, onSeries }: HeaderProps) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const follow = useFollow(u.id);
  const series = useUserSeries(u.id);
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
  const socialName = (k: string) => (k === 'vk' ? t('ВКонтакте') : k === 'telegram' ? 'Telegram' : k === 'behance' ? 'Behance' : t('Сайт'));
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
          {[isArtist ? t('Художник') : t('Коллекционер'), u.city].filter(Boolean).join(', ')}
        </T>
      </View>
      {isArtist ? (
        <View style={styles.stats}>
          <Stat value={u.rating ? u.rating.toFixed(1).replace('.', ',') : '—'} label={countLabel(u.reviews_count, ['отзыв', 'отзыва', 'отзывов'], ['review', 'reviews'])} />
          <Stat value={String(u.artworks_count)} label={t('в продаже')} />
          <Stat value={String(u.followers)} label={t('подписчиков')} />
        </View>
      ) : null}
      {u.on_vacation ? (
        <Notice text={`${u.vacation_until ? t('Художник взял паузу до {date}.', { date: formatDate(u.vacation_until) }) : t('Художник взял паузу.')}${u.vacation_note ? ` ${u.vacation_note}` : ''}`} />
      ) : null}
      {u.bio ? <T variant="body">{u.bio}</T> : null}
      {links.length ? (
        <View style={styles.links}>
          {links.map(([k, v]) => (
            <Pressable
              key={k}
              accessibilityRole="link"
              onPress={() => {
                const url = k === 'telegram' && !/^https?:/i.test(v) ? `https://t.me/${encodeURIComponent(v.replace(/^@/, ''))}` : v;
                if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
              }}
              style={styles.link}>
              <Ionicons name={k === 'telegram' ? 'paper-plane-outline' : k === 'vk' ? 'people-outline' : 'globe-outline'} size={16} color={colors.bordeaux} />
              <T variant="smallStrong" color={colors.bordeaux}>
                {socialName(k)}
              </T>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      {!isMe && isArtist ? (
        <View style={styles.actions}>
          <View style={styles.row}>
            <Button
              title={u.is_following ? t('Вы подписаны') : t('Подписаться')}
              variant={u.is_following ? 'secondary' : 'primary'}
              style={styles.flex}
              loading={follow.isPending}
              onPress={() => requireAuth(!!user) && follow.mutate(!u.is_following)}
            />
            <Button title={t('Написать')} variant="secondary" style={styles.flex} loading={busy} onPress={write} />
          </View>
          {u.accepts_commissions && !u.on_vacation ? (
            <View style={styles.commission}>
              <T variant="heading">{t('Принимает заказы')}</T>
              {u.commission_note ? <T variant="small">{u.commission_note}</T> : null}
              <Button
                title={t('Заказать работу')}
                icon="color-wand-outline"
                onPress={() => requireAuth(!!user) && router.push({ pathname: '/commission/new/[artistId]', params: { artistId: u.id } })}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {isMe ? <Button title={t('Редактировать профиль')} variant="secondary" onPress={() => router.push('/settings/profile')} /> : null}
      {isArtist ? (
        <View style={styles.tabs}>
          <Chip label={t('Работы')} selected={tab === 'works'} onPress={() => onTab('works')} />
          <Chip label={t('Посты')} selected={tab === 'posts'} onPress={() => onTab('posts')} />
          <Chip label={t('Отзывы')} selected={tab === 'reviews'} onPress={() => onTab('reviews')} />
        </View>
      ) : null}
      {isArtist && tab === 'works' && series.data?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.series}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: !seriesId }} onPress={() => onSeries(undefined)} style={[styles.seriesCard, !seriesId && styles.seriesOn]}>
            <View style={[styles.seriesCover, styles.seriesAll]}>
              <Ionicons name="grid-outline" size={22} color={colors.bordeaux} />
            </View>
            <T variant="smallStrong" numberOfLines={1}>
              {t('Все работы')}
            </T>
          </Pressable>
          {series.data.map((s) => (
            <Pressable key={s.id} accessibilityRole="button" accessibilityState={{ selected: seriesId === s.id }} onPress={() => onSeries(s.id)} style={[styles.seriesCard, seriesId === s.id && styles.seriesOn]}>
              {s.cover_url ? <Image source={{ uri: s.cover_url }} style={styles.seriesCover} contentFit="cover" /> : <View style={styles.seriesCover} />}
              <T variant="smallStrong" numberOfLines={1}>
                {s.title}
              </T>
              <T variant="small">{countLabel(s.artworks_count, ['работа', 'работы', 'работ'], ['work', 'works'])}</T>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <T variant="small">{t('На Artista с {date}', { date: formatDate(u.created_at) })}</T>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <T variant="priceLarge">{value}</T>
      <T variant="small">{label}</T>
    </View>
  );
}

function PostsList({ id, header }: { id: string; header: React.ReactElement }) {
  const t = useT();
  const styles = useStyles();
  const q = useUserPosts(id);
  return (
    <FlashList
      style={styles.listRoot}
      data={flatten(q.data)}
      keyExtractor={(p: Post) => p.id}
      ListHeaderComponent={<View style={styles.pad}>{header}</View>}
      renderItem={({ item }) => <PostCard post={item} />}
      ListEmptyComponent={q.isLoading ? <Loading /> : <EmptyState icon="newspaper-outline" title={t('Постов пока нет')} text={t('Здесь художник рассказывает о процессе и новых работах.')} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
    />
  );
}

function ReviewsList({ id, header }: { id: string; header: React.ReactElement }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const q = useReviews(id);
  return (
    <FlatList
      style={styles.listRoot}
      data={flatten(q.data)}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={<View style={styles.pad}>{header}</View>}
      ListEmptyComponent={q.isLoading ? <Loading /> : <EmptyState icon="star-outline" title={t('Отзывов пока нет')} text={t('Отзыв появляется после завершённой покупки.')} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      onEndReachedThreshold={0.5}
      renderItem={({ item: r }) => (
        <View style={styles.review}>
          <View style={styles.reviewHead}>
            <Avatar uri={r.author.avatar_url} name={r.author.name} size={32} />
            <T variant="bodyStrong" style={styles.flex}>
              {r.author.name}
            </T>
            <T variant="smallStrong" color={colors.gold} accessibilityLabel={t('Оценка {n} из 5', { n: r.rating })}>
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
      )}
    />
  );
}

const useStyles = makeStyles((c) => ({
  head: { paddingHorizontal: space.sm, paddingTop: space.lg, paddingBottom: space.xl, gap: space.lg },
  identity: { alignItems: 'center', gap: space.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.hairline },
  stat: { alignItems: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  actions: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
  commission: { gap: space.sm, padding: space.lg, borderRadius: radius.control, backgroundColor: c.goldSoft },
  tabs: { flexDirection: 'row', gap: space.sm },
  series: { gap: space.md },
  seriesCard: { width: 112, gap: 4, padding: 4, borderRadius: radius.control, borderWidth: 2, borderColor: 'transparent' },
  seriesOn: { borderColor: c.bordeaux },
  seriesCover: { width: '100%', aspectRatio: 1, borderRadius: radius.art, backgroundColor: c.plaster },
  seriesAll: { alignItems: 'center', justifyContent: 'center' },
  listRoot: { flex: 1, backgroundColor: c.wall },
  pad: { paddingHorizontal: space.sm },
  review: { marginHorizontal: space.lg, paddingVertical: space.lg, gap: space.sm, borderTopWidth: 1, borderTopColor: c.hairline },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
}));
