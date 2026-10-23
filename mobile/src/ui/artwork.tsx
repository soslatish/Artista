// Карточка работы и галерея-«шпалера»: картина в своих пропорциях + музейная этикетка.
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, type ReactElement, useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useCatalogMeta } from '@/api/hooks';
import type { Artwork, ArtworkStatus, CatalogMeta } from '@/api/types';
import { formatPrice, formatSize } from '@/lib/format';

import { PremiumMark } from './primitives';
import { colors, fonts, radius, space, type } from './theme';

const statusLabels: Record<ArtworkStatus, string> = {
  draft: 'Черновик',
  published: 'В продаже',
  reserved: 'Зарезервирована',
  sold: 'Продана',
  archived: 'В архиве',
  hidden: 'Скрыта модератором',
};

export function statusLabel(s: ArtworkStatus): string {
  return statusLabels[s];
}

export function labelOf(meta: CatalogMeta | undefined, group: 'categories' | 'styles' | 'techniques', code: string): string {
  return meta?.[group].find((o) => o.code === code)?.label ?? '';
}

/** Пропорции работы для превью: не уже 1:1.6 и не шире 1.6:1, чтобы лента оставалась читаемой. */
export function previewAspect(a: Pick<Artwork, 'width_cm' | 'height_cm'>): number {
  const r = a.width_cm > 0 && a.height_cm > 0 ? a.width_cm / a.height_cm : 1;
  return Math.min(1.6, Math.max(0.625, r));
}

interface CardProps {
  artwork: Artwork;
  showStatus?: boolean;
  meta?: CatalogMeta;
}

export const ArtworkCard = memo(function ArtworkCard({ artwork: a, showStatus, meta }: CardProps) {
  const technique = labelOf(meta, 'techniques', a.technique);
  const unavailable = a.status === 'sold' || a.status === 'reserved';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${a.title}, ${a.artist.name}, ${formatPrice(a.price_kop)}`}
      onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: a.id } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.frame, { aspectRatio: previewAspect(a) }]}>
        {a.images[0] ? (
          <Image source={{ uri: a.images[0] }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={a.id} />
        ) : (
          <View style={styles.noImage}>
            <Text style={styles.noImageText}>Нет фото</Text>
          </View>
        )}
        {unavailable || showStatus ? (
          <View style={[styles.tag, a.status === 'published' && styles.tagLive]}>
            <Text style={styles.tagText}>{statusLabel(a.status)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.label}>
        <Text style={type.artTitleSmall} numberOfLines={2}>
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
        <Text style={[type.price, unavailable && styles.priceMuted]}>{formatPrice(a.price_kop)}</Text>
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
}

/** Двухколоночная лента разной высоты (masonry). */
export function Gallery({ items, loading, refreshing, onRefresh, onEndReached, loadingMore, header, empty, showStatus }: GalleryProps) {
  const { data: meta } = useCatalogMeta();
  const renderItem = useCallback(
    ({ item }: { item: Artwork }) => <ArtworkCard artwork={item} meta={meta} showStatus={showStatus} />,
    [meta, showStatus],
  );
  return (
    <FlashList
      data={items}
      masonry
      numColumns={2}
      keyExtractor={(a) => a.id}
      renderItem={renderItem}
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

const styles = StyleSheet.create({
  gallery: { paddingHorizontal: space.sm, paddingBottom: space.xxl },
  card: { paddingHorizontal: space.sm, paddingBottom: space.xl },
  pressed: { opacity: 0.9 },
  frame: { width: '100%', backgroundColor: colors.plaster, borderRadius: radius.art, overflow: 'hidden' },
  noImage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noImageText: { ...type.small },
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
  tagText: { fontFamily: fonts.sansSemi, fontSize: 12, color: colors.onDark },
  label: { paddingTop: space.sm, gap: 2 },
  artistRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  artist: { ...type.smallStrong, flexShrink: 1 },
  meta: { ...type.small },
  priceMuted: { color: colors.graphite },
  spinner: { marginVertical: space.xxl },
});
