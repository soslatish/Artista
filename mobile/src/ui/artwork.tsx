// Карточка работы и галерея-«шпалера»: картина в своих пропорциях + музейная этикетка.
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, type ReactElement, useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useCatalogMeta } from '@/api/hooks';
import type { Artwork, ArtworkStatus, CatalogMeta } from '@/api/types';
import { type TFunc, useT } from '@/i18n';
import { formatPrice, formatSize } from '@/lib/format';

import { PremiumMark } from './primitives';
import { useGalleryColumns } from './layout';
import { fonts, makeStyles, radius, space, useColors } from './theme';

const statusLabels: Record<ArtworkStatus, string> = {
  draft: 'Черновик',
  published: 'В продаже',
  reserved: 'Зарезервирована',
  sold: 'Продана',
  archived: 'В архиве',
  hidden: 'Скрыта модератором',
  scheduled: 'Скоро на выставке',
  auction: 'Аукцион',
  commission: 'На заказ',
};

/** Подпись статуса (на текущем языке, если передан t). */
export function statusLabel(s: ArtworkStatus, t?: TFunc): string {
  return t ? t(statusLabels[s]) : statusLabels[s];
}

export function labelOf(meta: CatalogMeta | undefined, group: 'categories' | 'styles' | 'techniques' | 'rooms', code: string): string {
  return meta?.[group]?.find((o) => o.code === code)?.label ?? '';
}

/** Пропорции работы для превью: не уже 1:1.6 и не шире 1.6:1, чтобы лента оставалась читаемой. */
export function previewAspect(a: Pick<Artwork, 'width_cm' | 'height_cm'>): number {
  const r = a.width_cm > 0 && a.height_cm > 0 ? a.width_cm / a.height_cm : 1;
  return Math.min(1.6, Math.max(0.625, r));
}

/** Источник перехода к работе — для статистики художника. */
export type ViewSource = 'feed' | 'search' | 'similar' | 'collection' | 'profile' | 'favorites' | 'history' | 'exhibition' | 'post' | 'notification';

export function openArtwork(id: string, src?: ViewSource): void {
  router.push({ pathname: '/artwork/[id]', params: src ? { id, src } : { id } });
}

/** Цена в карточке: для аукциона — текущая ставка. */
function displayPrice(a: Artwork): number {
  return a.auction ? (a.auction.current_kop ?? a.auction.start_kop) : a.price_kop;
}

interface CardProps {
  artwork: Artwork;
  showStatus?: boolean;
  meta?: CatalogMeta;
  src?: ViewSource;
  width?: number;
}

export const ArtworkCard = memo(function ArtworkCard({ artwork: a, showStatus, meta, src, width }: CardProps) {
  const t = useT();
  const styles = useStyles();
  const technique = t(labelOf(meta, 'techniques', a.technique));
  const unavailable = a.status === 'sold' || a.status === 'reserved';
  const badge = a.status === 'auction' ? t('Аукцион') : a.status === 'scheduled' ? t('Скоро') : unavailable || showStatus ? statusLabel(a.status, t) : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${a.title}, ${a.artist.name}, ${formatPrice(displayPrice(a))}`}
      onPress={() => openArtwork(a.id, src)}
      style={({ pressed }) => [width ? { width } : styles.card, pressed && styles.pressed]}>
      <View style={[styles.frame, { aspectRatio: previewAspect(a) }]}>
        {a.images[0] ? (
          <Image source={{ uri: a.images[0] }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={a.id} />
        ) : (
          <View style={styles.noImage}>
            <Text style={styles.noImageText}>{t('Нет фото')}</Text>
          </View>
        )}
        {badge ? (
          <View style={[styles.tag, (a.status === 'published' || a.status === 'auction') && styles.tagLive]}>
            <Text style={styles.tagText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.label}>
        <Text style={styles.title} numberOfLines={2}>
          {a.title}
        </Text>
        <View style={styles.artistRow}>
          <Text style={styles.artist} numberOfLines={1}>
            {a.artist.name}
          </Text>
          {a.artist.is_premium ? <PremiumMark /> : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {[technique, formatSize(a.width_cm, a.height_cm)].filter(Boolean).join(', ')}
        </Text>
        <Text style={[styles.price, unavailable && styles.priceMuted]}>
          {a.auction ? `${t('Ставка')} ` : ''}
          {formatPrice(displayPrice(a))}
        </Text>
        {a.is_promoted ? <Text style={styles.promoted}>{t('Продвижение')}</Text> : null}
      </View>
    </Pressable>
  );
});

interface GalleryProps {
  items: Artwork[];
  loading: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
  loadingMore?: boolean;
  header?: ReactElement | null;
  empty?: ReactElement | null;
  showStatus?: boolean;
  src?: ViewSource;
}

/** Лента работ разной высоты (masonry): 2 колонки на телефоне, до 4 на широком экране. */
export function Gallery({ items, loading, refreshing, onRefresh, onEndReached, loadingMore, header, empty, showStatus, src }: GalleryProps) {
  const { data: meta } = useCatalogMeta();
  const colors = useColors();
  const styles = useStyles();
  const columns = useGalleryColumns();
  const renderItem = useCallback(
    ({ item }: { item: Artwork }) => <ArtworkCard artwork={item} meta={meta} showStatus={showStatus} src={src} />,
    [meta, showStatus, src],
  );
  return (
    <FlashList
      key={columns}
      data={items}
      masonry
      numColumns={columns}
      keyExtractor={(a) => a.id}
      renderItem={renderItem}
      style={styles.list}
      contentContainerStyle={styles.gallery}
      ListHeaderComponent={header}
      ListEmptyComponent={loading ? <ActivityIndicator style={styles.spinner} color={colors.bordeaux} /> : empty}
      ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.spinner} color={colors.bordeaux} /> : null}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.bordeaux} /> : undefined}
    />
  );
}

/** Горизонтальная лента работ (подборки, похожие, аукционы). */
export function ArtworkStrip({ items, src, cardWidth = 150 }: { items: Artwork[]; src?: ViewSource; cardWidth?: number }) {
  const { data: meta } = useCatalogMeta();
  const styles = useStyles();
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(a) => a.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      renderItem={({ item }) => <ArtworkCard artwork={item} meta={meta} src={src} width={cardWidth} />}
    />
  );
}

const useStyles = makeStyles((c, t) => ({
  list: { backgroundColor: c.wall },
  gallery: { paddingHorizontal: space.sm, paddingBottom: space.xxl },
  card: { paddingHorizontal: space.sm, paddingBottom: space.xl },
  pressed: { opacity: 0.9 },
  frame: { width: '100%', backgroundColor: c.plaster, borderRadius: radius.art, overflow: 'hidden' },
  noImage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noImageText: { ...t.small },
  tag: {
    position: 'absolute',
    left: space.sm,
    top: space.sm,
    backgroundColor: 'rgba(30,26,27,0.78)',
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.art,
  },
  tagLive: { backgroundColor: 'rgba(63,107,76,0.9)' },
  tagText: { fontFamily: fonts.sansSemi, fontSize: 12, color: '#FFFFFF' },
  label: { paddingTop: space.sm, gap: 2 },
  title: { ...t.artTitleSmall },
  artistRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  artist: { ...t.smallStrong, flexShrink: 1 },
  meta: { ...t.small },
  price: { ...t.price },
  priceMuted: { color: c.graphite },
  promoted: { ...t.small, fontSize: 11, color: c.gold },
  spinner: { marginVertical: space.xxl },
  strip: { gap: space.md, paddingHorizontal: space.lg },
}));
