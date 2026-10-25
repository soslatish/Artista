// Карточки постов художников и выставок.
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { del, errorText, post as apiPost } from '@/api/client';
import { keys } from '@/api/hooks';
import type { Exhibition, Post } from '@/api/types';
import { useSession } from '@/auth/session';
import { useT } from '@/i18n';
import { confirmAction, notify } from '@/lib/confirm';
import { formatDate, formatDateTime, formatPrice, formatTimeLeft } from '@/lib/format';
import { requireAuth } from '@/lib/guard';

import { openArtwork } from './artwork';
import { Avatar, PremiumMark, T } from './primitives';
import { contentWidth, isWeb, useContentWidth } from './layout';
import { makeStyles, radius, space, useColors } from './theme';

export const PostCard = memo(function PostCard({ post }: { post: Post }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const qc = useQueryClient();
  const { user } = useSession();
  const width = useContentWidth(contentWidth.page);
  const [liked, setLiked] = useState(post.liked);
  const [likes, setLikes] = useState(post.likes);
  // лента перечиталась (например, лайк с другого устройства) — берём свежие значения
  const [synced, setSynced] = useState({ liked: post.liked, likes: post.likes });
  if (synced.liked !== post.liked || synced.likes !== post.likes) {
    setSynced({ liked: post.liked, likes: post.likes });
    setLiked(post.liked);
    setLikes(post.likes);
  }
  const mine = user?.id === post.artist.id;
  const imageWidth = width - space.lg * 2;

  const toggleLike = () => {
    if (!requireAuth(!!user)) return;
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    (next ? apiPost(`/posts/${post.id}/like`) : del(`/posts/${post.id}/like`)).catch(() => {
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
    });
  };

  const remove = () =>
    confirmAction(t('Удалить пост?'), t('Пост исчезнет из ленты подписчиков.'), () => {
      del(`/posts/${post.id}`)
        .then(() => {
          qc.invalidateQueries({ queryKey: keys.postsFeed });
          qc.invalidateQueries({ queryKey: keys.userPosts(post.artist.id) });
        })
        .catch((e: unknown) => notify(t('Не удалось удалить'), errorText(e)));
    }, { destructive: true, confirmText: t('Удалить') });

  return (
    <View style={styles.post}>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/artist/[id]', params: { id: post.artist.id } })} style={styles.postHead}>
        <Avatar uri={post.artist.avatar_url} name={post.artist.name} size={36} />
        <View style={styles.flex}>
          <View style={styles.row}>
            <T variant="bodyStrong">{post.artist.name}</T>
            {post.artist.is_premium ? <PremiumMark /> : null}
          </View>
          <T variant="small">{formatDate(post.created_at)}</T>
        </View>
        {mine ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Удалить пост')} hitSlop={10} onPress={remove}>
            <Ionicons name="trash-outline" size={20} color={colors.graphite} />
          </Pressable>
        ) : null}
      </Pressable>
      {post.body ? <T variant="body">{post.body}</T> : null}
      {post.images.length ? (
        <FlatList
          horizontal
          pagingEnabled
          data={post.images}
          keyExtractor={(u, i) => `${i}-${u}`}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => <Image source={{ uri: item }} style={[styles.postImage, { width: imageWidth }]} contentFit="cover" />}
        />
      ) : null}
      {post.artwork ? (
        <Pressable accessibilityRole="button" onPress={() => openArtwork(post.artwork!.id, 'post')} style={styles.linked}>
          {post.artwork.image_url ? <Image source={{ uri: post.artwork.image_url }} style={styles.linkedThumb} contentFit="cover" /> : null}
          <View style={styles.flex}>
            <T variant="artTitleSmall" numberOfLines={1}>
              {post.artwork.title}
            </T>
            <T variant="price">{formatPrice(post.artwork.price_kop)}</T>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.graphite} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={liked ? t('Убрать отметку «нравится»') : t('Нравится')}
        accessibilityState={{ selected: liked }}
        onPress={toggleLike}
        style={styles.like}
        hitSlop={8}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? colors.bordeaux : colors.graphite} />
        <T variant="smallStrong" color={liked ? colors.bordeaux : colors.graphite}>
          {likes > 0 ? String(likes) : ''}
        </T>
      </Pressable>
    </View>
  );
});

export function ExhibitionCard({ e, width }: { e: Exhibition; width?: number }) {
  const t = useT();
  const styles = useStyles();
  const open = e.status === 'open';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('Выставка')} ${e.title}, ${e.artist.name}`}
      onPress={() => router.push({ pathname: '/exhibition/[id]', params: { id: e.id } })}
      style={[styles.exhibition, width ? { width } : null]}>
      <View style={styles.exhibitionCover}>
        {e.cover_url ? <Image source={{ uri: e.cover_url }} style={styles.fill} contentFit="cover" /> : null}
        <View style={[styles.exhibitionTag, open && styles.exhibitionTagOpen]}>
          <T variant="smallStrong" color="#FFFFFF">
            {open ? t('Открыта') : t('через {left}', { left: formatTimeLeft(e.starts_at) })}
          </T>
        </View>
      </View>
      <T variant="artTitleSmall" numberOfLines={1}>
        {e.title}
      </T>
      <T variant="small" numberOfLines={1}>
        {e.artist.name}, {open ? t('{n} работ', { n: e.artworks_count }) : formatDateTime(e.starts_at)}
      </T>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  post: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.md,
    borderBottomWidth: 1,
    borderBottomColor: c.hairline,
    backgroundColor: c.wall,
    // в браузере пост — колонка для чтения по центру, картинки считаются от неё же
    ...(isWeb ? { width: '100%' as const, maxWidth: contentWidth.page, alignSelf: 'center' as const } : null),
  },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  postImage: { height: 300, borderRadius: radius.art, backgroundColor: c.plaster },
  linked: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.control, backgroundColor: c.paper, borderWidth: 1, borderColor: c.hairline },
  linkedThumb: { width: 44, height: 56, borderRadius: radius.art },
  like: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32 },
  exhibition: { gap: 4 },
  exhibitionCover: { aspectRatio: 4 / 5, borderRadius: radius.art, backgroundColor: c.plaster, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  exhibitionTag: { position: 'absolute', left: space.sm, bottom: space.sm, backgroundColor: 'rgba(30,26,27,0.8)', borderRadius: radius.art, paddingHorizontal: space.sm, paddingVertical: 3 },
  exhibitionTagOpen: { backgroundColor: 'rgba(63,107,76,0.92)' },
}));
