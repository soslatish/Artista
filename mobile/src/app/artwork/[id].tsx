import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, post } from '@/api/client';
import { useArchiveArtwork, useArtwork, useCatalogMeta, useToggleFavorite } from '@/api/hooks';
import type { Artwork, Conversation } from '@/api/types';
import { useSession } from '@/auth/session';
import { formatPrice, formatSize } from '@/lib/format';
import { chooseAction, confirmAction, notify } from '@/lib/confirm';
import { requireAuth, validId } from '@/lib/guard';
import { labelOf, previewAspect, statusLabel } from '@/ui/artwork';
import { Avatar, Button, Divider, ErrorState, IconButton, Loading, Notice, PremiumMark, T } from '@/ui/primitives';
import { colors, fonts, radius, space } from '@/ui/theme';
import { ImageViewer } from '@/ui/zoom';

export default function ArtworkRoute() {
  const id = validId(useLocalSearchParams().id);
  if (!id) return <ErrorState text="Ссылка на работу повреждена." />;
  return <ArtworkScreen id={id} />;
}

function ArtworkScreen({ id }: { id: string }) {
  const q = useArtwork(id);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <ArtworkView a={q.data} />;
}

function ArtworkView({ a }: { a: Artwork }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { data: meta } = useCatalogMeta();
  const fav = useToggleFavorite();
  const archive = useArchiveArtwork();
  const [page, setPage] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState('');

  const mine = user?.id === a.artist.id;
  const canBuy = a.status === 'published' && !mine;
  const frameHeight = Math.min(width / previewAspect(a), width * 1.25);
  const details = [
    ['Категория', labelOf(meta, 'categories', a.category)],
    ['Стиль', labelOf(meta, 'styles', a.style)],
    ['Техника', labelOf(meta, 'techniques', a.technique)],
    ['Материалы', a.materials],
    ['Размер', formatSize(a.width_cm, a.height_cm, a.depth_cm)],
    ['Год', a.year ? String(a.year) : ''],
  ].filter(([, v]) => v);

  const toggleFav = () => requireAuth(!!user) && fav.mutate({ id: a.id, on: !a.is_favorite });

  const writeArtist = async () => {
    if (!requireAuth(!!user)) return;
    setChatBusy(true);
    try {
      const c = await post<Conversation>('/conversations', { user_id: a.artist.id, artwork_id: a.id });
      router.push({ pathname: '/chat/[id]', params: { id: c.id, name: a.artist.name } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChatBusy(false);
    }
  };

  const sendReport = (reason: string) =>
    post('/reports', { target_type: 'artwork', target_id: a.id, reason })
      .then(() => notify('Жалоба отправлена', 'Модератор проверит публикацию.'))
      .catch((e) => setError(errorText(e)));

  const report = () => {
    if (!requireAuth(!!user)) return;
    chooseAction('Пожаловаться на работу', 'Модератор проверит публикацию.', [
      { label: 'Чужая работа или плагиат', onPress: () => sendReport('Чужая работа или плагиат') },
      { label: 'Недопустимое содержание', onPress: () => sendReport('Недопустимое содержание') },
    ]);
  };

  const confirmArchive = () =>
    confirmAction('Снять работу с продажи?', 'Она переместится в архив, её можно будет опубликовать снова.', () => archive.mutate(a.id, { onError: (e) => setError(errorText(e)) }), {
      confirmText: 'Снять',
      destructive: true,
    });

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <View style={styles.headerActions}>
              {!mine ? (
                <IconButton
                  icon={a.is_favorite ? 'heart' : 'heart-outline'}
                  color={a.is_favorite ? colors.bordeaux : colors.ink}
                  label={a.is_favorite ? 'Убрать из избранного' : 'В избранное'}
                  onPress={toggleFav}
                />
              ) : null}
              {!mine ? <IconButton icon="flag-outline" label="Пожаловаться" onPress={report} /> : null}
            </View>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
        <View style={[styles.frame, { height: frameHeight }]}>
          <FlatList
            data={a.images.length ? a.images : ['']}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(u, i) => `${i}-${u}`}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item, index }) => (
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel={`Фото ${index + 1} — открыть на весь экран`}
                disabled={!item}
                onPress={() => setViewer(index)}
                style={{ width, height: frameHeight }}>
                {item ? <Image source={{ uri: item }} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} /> : null}
              </Pressable>
            )}
          />
          {a.images.length > 1 ? (
            <View style={styles.dots}>
              {a.images.map((u, i) => (
                <View key={`${i}-${u}`} style={[styles.dot, i === page && styles.dotOn]} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          {a.status !== 'published' ? <Notice tone={a.status === 'sold' ? 'info' : 'danger'} text={statusLabel(a.status)} /> : null}
          <T variant="display" style={styles.titleItalic}>
            {a.title}
          </T>
          <T variant="title">{formatPrice(a.price_kop)}</T>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Художник ${a.artist.name}`}
            onPress={() => router.push({ pathname: '/artist/[id]', params: { id: a.artist.id } })}
            style={styles.artist}>
            <Avatar uri={a.artist.avatar_url} name={a.artist.name} size={44} />
            <View style={styles.flex}>
              <View style={styles.artistName}>
                <T variant="bodyStrong">{a.artist.name}</T>
                {a.artist.is_premium ? <PremiumMark /> : null}
              </View>
              {a.artist.city ? <T variant="small">{a.artist.city}</T> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.graphite} />
          </Pressable>

          <Divider />
          <View style={styles.table}>
            {details.map(([k, v]) => (
              <View key={k} style={styles.tableRow}>
                <T variant="small" style={styles.tableKey}>
                  {k}
                </T>
                <T variant="body" style={styles.flex}>
                  {v}
                </T>
              </View>
            ))}
          </View>
          {a.description ? (
            <>
              <Divider />
              <T variant="body">{a.description}</T>
            </>
          ) : null}
          <Divider />
          <View style={styles.trust}>
            <Ionicons name="shield-checkmark-outline" size={22} color={colors.success} />
            <T variant="small" style={styles.flex}>
              Оплата хранится у Artista, пока вы не подтвердите получение. Если художник не отправит работу за 48 часов — деньги вернутся.
            </T>
          </View>
          {error ? <Notice tone="danger" text={error} /> : null}
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
        {mine ? (
          <>
            {a.status === 'draft' || a.status === 'published' ? (
              <Button title="Снять с продажи" variant="danger" style={styles.flex} loading={archive.isPending} onPress={confirmArchive} />
            ) : null}
            {a.status === 'draft' || a.status === 'published' || a.status === 'archived' ? (
              <Button title="Редактировать" style={styles.flex} onPress={() => router.push({ pathname: '/artwork/edit/[id]', params: { id: a.id } })} />
            ) : null}
          </>
        ) : (
          <>
            <Button title="Написать" variant="secondary" style={styles.flex} loading={chatBusy} onPress={writeArtist} />
            <Button
              title={canBuy ? 'Купить' : statusLabel(a.status)}
              disabled={!canBuy}
              style={styles.flex}
              onPress={() => requireAuth(!!user) && router.push({ pathname: '/checkout/[artworkId]', params: { artworkId: a.id } })}
            />
          </>
        )}
      </View>
      {viewer !== null ? <ImageViewer images={a.images} index={viewer} visible title={a.title} onClose={() => setViewer(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall },
  headerActions: { flexDirection: 'row', gap: space.sm },
  frame: { backgroundColor: colors.plaster },
  dots: { position: 'absolute', bottom: space.md, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotOn: { backgroundColor: colors.paper, width: 18 },
  body: { padding: space.lg, gap: space.lg },
  titleItalic: { fontFamily: fonts.serifItalic },
  artist: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  artistName: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  table: { gap: space.sm },
  tableRow: { flexDirection: 'row', gap: space.md },
  tableKey: { width: 104, paddingTop: 2 },
  trust: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md, borderRadius: radius.control, backgroundColor: colors.successSoft },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.wall,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
});
