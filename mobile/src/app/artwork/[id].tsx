import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText, post } from '@/api/client';
import { useArchiveArtwork, useArtwork, useCatalogMeta, useSimilar, useToggleFavorite } from '@/api/hooks';
import type { Artwork, Conversation } from '@/api/types';
import { useSession } from '@/auth/session';
import { QuestionsBlock } from '@/features/questions';
import { shareLink } from '@/features/share';
import { useT } from '@/i18n';
import { chooseAction, confirmAction, notify } from '@/lib/confirm';
import { formatDate, formatPrice, formatSize, formatTimeLeft } from '@/lib/format';
import { requireAuth, validId } from '@/lib/guard';
import { ArtworkStrip, labelOf, previewAspect, statusLabel } from '@/ui/artwork';
import { Avatar, Button, Divider, ErrorState, IconButton, Loading, Notice, PremiumMark, SectionHeader, T } from '@/ui/primitives';
import { fonts, makeStyles, radius, space, useColors } from '@/ui/theme';
import { ImageViewer } from '@/ui/zoom';

export default function ArtworkRoute() {
  const params = useLocalSearchParams();
  const id = validId(params.id);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка на работу повреждена.')} />;
  return <ArtworkScreen id={id} src={typeof params.src === 'string' ? params.src : undefined} />;
}

function ArtworkScreen({ id, src }: { id: string; src?: string }) {
  const q = useArtwork(id, src);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <ArtworkView a={q.data} />;
}

function ArtworkView({ a }: { a: Artwork }) {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { data: meta } = useCatalogMeta();
  const fav = useToggleFavorite();
  const archive = useArchiveArtwork();
  const similar = useSimilar(a.id);
  const [page, setPage] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState('');

  const mine = user?.id === a.artist.id;
  const onVacation = !!a.artist.on_vacation;
  const hasLock = !!a.my_price_kop;
  // бронь цены (принятое предложение, выигранный аукцион) позволяет оформить заказ и во время паузы
  const canBuy = !mine && ((a.status === 'published' && (!onVacation || hasLock)) || (a.status === 'reserved' && hasLock));
  const canOffer = canBuy && a.allow_offers && !hasLock;
  const frameHeight = Math.min(width / previewAspect(a), width * 1.25);
  const rooms = a.rooms.map((r) => t(labelOf(meta, 'rooms', r))).filter(Boolean);
  const details = [
    [t('Категория'), t(labelOf(meta, 'categories', a.category))],
    [t('Стиль'), t(labelOf(meta, 'styles', a.style))],
    [t('Техника'), t(labelOf(meta, 'techniques', a.technique))],
    [t('Материалы'), a.materials],
    [t('Размер'), formatSize(a.width_cm, a.height_cm, a.depth_cm)],
    [t('Год'), a.year ? String(a.year) : ''],
    [t('Для интерьера'), rooms.join(', ')],
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
      .then(() => notify(t('Жалоба отправлена'), t('Модератор проверит публикацию.')))
      .catch((e) => setError(errorText(e)));

  const report = () => {
    if (!requireAuth(!!user)) return;
    chooseAction(t('Пожаловаться на работу'), t('Модератор проверит публикацию.'), [
      { label: t('Чужая работа или плагиат'), onPress: () => sendReport('Чужая работа или плагиат') },
      { label: t('Недопустимое содержание'), onPress: () => sendReport('Недопустимое содержание') },
    ]);
  };

  const similarAlert = async () => {
    if (!requireAuth(!!user)) return;
    try {
      await post(`/artworks/${a.id}/similar-alert`);
      notify(t('Готово'), t('Сообщим, когда появятся похожие работы: та же категория, цвета и цена.'));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const confirmArchive = () =>
    confirmAction(t('Снять работу с продажи?'), t('Она переместится в архив, её можно будет опубликовать снова.'), () => archive.mutate(a.id, { onError: (e) => setError(errorText(e)) }), {
      confirmText: t('Снять'),
      destructive: true,
    });

  const share = () => shareLink(`/a/${a.id}`, `«${a.title}» — ${a.artist.name}, ${formatPrice(a.price_kop)}`);

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <View style={styles.headerActions}>
              <IconButton icon="share-outline" label={t('Поделиться')} onPress={share} />
              {!mine ? (
                <IconButton
                  icon={a.is_favorite ? 'heart' : 'heart-outline'}
                  color={a.is_favorite ? colors.bordeaux : colors.ink}
                  label={a.is_favorite ? t('Убрать из избранного') : t('В избранное')}
                  onPress={toggleFav}
                />
              ) : null}
              {!mine ? <IconButton icon="flag-outline" label={t('Пожаловаться')} onPress={report} /> : null}
            </View>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}>
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
                accessibilityLabel={t('Фото {n} — открыть на весь экран', { n: index + 1 })}
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
          {a.images[0] && a.width_cm > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/try-on/[id]', params: { id: a.id } })} style={styles.tryOn}>
              <Ionicons name="scan-outline" size={18} color="#FFFFFF" />
              <T variant="smallStrong" color="#FFFFFF">
                {t('Примерить на стену')}
              </T>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.body}>
          {a.status === 'scheduled' && a.exhibition_id ? (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/exhibition/[id]', params: { id: a.exhibition_id! } })}>
              <Notice text={t('Работа появится в продаже в момент открытия выставки. Нажмите, чтобы включить напоминание.')} />
            </Pressable>
          ) : a.status !== 'published' && a.status !== 'auction' ? (
            <Notice tone={a.status === 'hidden' ? 'danger' : 'info'} text={statusLabel(a.status, t)} />
          ) : null}
          {onVacation && !mine ? (
            <Notice text={a.artist.vacation_until ? t('Художник взял паузу до {date} — купить работу пока нельзя.', { date: formatDate(a.artist.vacation_until) }) : t('Художник взял паузу — купить работу пока нельзя.')} />
          ) : null}
          <T variant="display" style={styles.titleItalic}>
            {a.title}
          </T>
          {a.auction ? (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/auction/[id]', params: { id: a.auction!.id } })} style={styles.auction}>
              <View style={styles.flex}>
                <T variant="small">{a.auction.current_kop ? t('Текущая ставка') : t('Стартовая цена')}</T>
                <T variant="priceLarge">{formatPrice(a.auction.current_kop ?? a.auction.start_kop)}</T>
                <T variant="small">
                  {t('Ставок: {n}', { n: a.auction.bids_count })}, {t('до конца {left}', { left: formatTimeLeft(a.auction.ends_at) })}
                </T>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.graphite} />
            </Pressable>
          ) : hasLock ? (
            <View>
              <T variant="priceLarge">{formatPrice(a.my_price_kop!)}</T>
              <T variant="small">{t('Ваша согласованная цена — оформите заказ, пока бронь действует.')}</T>
            </View>
          ) : (
            <T variant="priceLarge">{formatPrice(a.price_kop)}</T>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Художник {name}', { name: a.artist.name })}
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
              {t('Оплата хранится у Artista, пока вы не подтвердите получение. После сделки вы получите сертификат подлинности.')}
            </T>
          </View>
          {error ? <Notice tone="danger" text={error} /> : null}

          {mine ? <OwnerTools a={a} onArchive={confirmArchive} archiving={archive.isPending} /> : null}

          {!mine ? (
            <Pressable accessibilityRole="button" onPress={similarAlert} style={styles.link}>
              <Ionicons name="notifications-outline" size={18} color={colors.bordeaux} />
              <T variant="bodyStrong" color={colors.bordeaux}>
                {t('Сообщать о похожих работах')}
              </T>
            </Pressable>
          ) : null}

          <Divider />
          <QuestionsBlock artworkId={a.id} artistId={a.artist.id} />
        </View>

        {similar.data?.length ? (
          <View style={styles.similar}>
            <View style={styles.pad}>
              <SectionHeader title={t('Похожие работы')} />
            </View>
            <ArtworkStrip items={similar.data} src="similar" />
          </View>
        ) : null}
      </ScrollView>

      {!mine ? (
        <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
          {canOffer ? (
            <Pressable accessibilityRole="button" onPress={() => requireAuth(!!user) && router.push({ pathname: '/offer/new/[artworkId]', params: { artworkId: a.id } })} style={styles.offerLink}>
              <T variant="bodyStrong" color={colors.bordeaux}>
                {t('Предложить свою цену')}
              </T>
            </Pressable>
          ) : null}
          <View style={styles.barRow}>
            <Button title={t('Написать')} variant="secondary" style={styles.flex} loading={chatBusy} onPress={writeArtist} />
            {a.status === 'auction' && a.auction ? (
              <Button title={t('Сделать ставку')} style={styles.flex} onPress={() => router.push({ pathname: '/auction/[id]', params: { id: a.auction!.id } })} />
            ) : (
              <Button
                title={canBuy ? (hasLock ? t('Оформить заказ') : t('Купить')) : onVacation && a.status === 'published' ? t('Художник на паузе') : statusLabel(a.status, t)}
                disabled={!canBuy}
                style={styles.flex}
                onPress={() => requireAuth(!!user) && router.push({ pathname: '/checkout/[artworkId]', params: { artworkId: a.id } })}
              />
            )}
          </View>
        </View>
      ) : null}
      {viewer !== null ? <ImageViewer images={a.images} index={viewer} visible title={a.title} onClose={() => setViewer(null)} /> : null}
    </View>
  );
}

/** Инструменты художника на странице своей работы. */
function OwnerTools({ a, onArchive, archiving }: { a: Artwork; onArchive: () => void; archiving: boolean }) {
  const t = useT();
  const styles = useStyles();
  const editable = a.status === 'draft' || a.status === 'published' || a.status === 'archived' || a.status === 'scheduled';
  return (
    <View style={styles.owner}>
      <T variant="heading">{t('Управление работой')}</T>
      {editable ? <Button title={t('Редактировать')} icon="create-outline" onPress={() => router.push({ pathname: '/artwork/edit/[id]', params: { id: a.id } })} /> : null}
      {a.status === 'published' || a.status === 'auction' ? (
        <Button title={a.is_promoted ? t('Продлить продвижение') : t('Продвинуть в ленте')} variant="secondary" icon="trending-up-outline" onPress={() => router.push({ pathname: '/promote/[id]', params: { id: a.id } })} />
      ) : null}
      {a.status === 'published' || a.status === 'draft' ? (
        <Button title={t('Выставить на аукцион')} variant="secondary" icon="hammer-outline" onPress={() => router.push({ pathname: '/auction/new/[artworkId]', params: { artworkId: a.id } })} />
      ) : null}
      {a.status === 'auction' && a.auction ? <Button title={t('Ход аукциона')} variant="secondary" onPress={() => router.push({ pathname: '/auction/[id]', params: { id: a.auction!.id } })} /> : null}
      {a.status === 'draft' || a.status === 'published' ? <Button title={a.status === 'draft' ? t('В архив') : t('Снять с продажи')} variant="danger" loading={archiving} onPress={onArchive} /> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  headerActions: { flexDirection: 'row', gap: space.xs },
  frame: { backgroundColor: c.plaster },
  dots: { position: 'absolute', bottom: space.md, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotOn: { backgroundColor: '#FFFFFF', width: 18 },
  tryOn: {
    position: 'absolute',
    right: space.md,
    top: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(30,26,27,0.72)',
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  body: { padding: space.lg, gap: space.lg },
  titleItalic: { fontFamily: fonts.serifItalic },
  auction: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.control, backgroundColor: c.goldSoft },
  artist: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  artistName: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  table: { gap: space.sm },
  tableRow: { flexDirection: 'row', gap: space.md },
  tableKey: { width: 112, paddingTop: 2 },
  trust: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md, borderRadius: radius.control, backgroundColor: c.successSoft },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  owner: { gap: space.sm },
  similar: { gap: space.md, paddingBottom: space.lg },
  pad: { paddingHorizontal: space.lg },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    backgroundColor: c.wall,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.hairline,
  },
  barRow: { flexDirection: 'row', gap: space.md },
  offerLink: { alignItems: 'center', paddingVertical: 4 },
}));
