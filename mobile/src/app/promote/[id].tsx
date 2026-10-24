import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { keys, useArtwork, useCatalogMeta } from '@/api/hooks';
import type { Payment } from '@/api/types';
import { openPaymentPage } from '@/features/open-payment';
import { TestPaymentSheet } from '@/features/test-payment';
import { useT } from '@/i18n';
import { notify } from '@/lib/confirm';
import { formatPrice, plural } from '@/lib/format';
import { validId } from '@/lib/guard';
import { Button, ErrorState, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space } from '@/ui/theme';

export default function PromoteRoute() {
  const id = validId(useLocalSearchParams().id);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <Promote artworkId={id} />;
}

function Promote({ artworkId }: { artworkId: string }) {
  const t = useT();
  const styles = useStyles();
  const qc = useQueryClient();
  const art = useArtwork(artworkId);
  const meta = useCatalogMeta();
  const tariffs = meta.data?.promotion_tariffs ?? [];
  const [days, setDays] = useState<number | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (art.isLoading || meta.isLoading) return <Loading />;
  if (art.isError || !art.data) return <ErrorState text={errorText(art.error)} />;
  const a = art.data;
  const selected = tariffs.find((x) => x.days === days) ?? tariffs[1] ?? tariffs[0];
  const available = a.status === 'published' || a.status === 'auction';

  const buy = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const p = await post<Payment>(`/artworks/${a.id}/promote`, { days: selected.days });
      if (p.test_mode) setPayment(p);
      else await openPaymentPage(p);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const paid = () => {
    setPayment(null);
    qc.invalidateQueries({ queryKey: keys.promotions });
    qc.invalidateQueries({ queryKey: keys.artwork(a.id) });
    qc.invalidateQueries({ queryKey: ['artworks'] });
    notify(t('Продвижение включено'), t('Работа поднимется в ленте и поиске с пометкой «Продвижение».'));
    router.back();
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.item}>
        {a.images[0] ? <Image source={{ uri: a.images[0] }} style={styles.thumb} contentFit="cover" /> : null}
        <View style={styles.flex}>
          <T variant="artTitle">{a.title}</T>
          <T variant="price">{formatPrice(a.price_kop)}</T>
        </View>
      </View>
      <T variant="body">{t('Работа показывается первой в ленте «Новое», в поиске и в подборках, где она подходит по фильтрам. Сортировка по цене не меняется — покупатель всегда видит честный порядок.')}</T>
      {a.is_promoted ? <Notice tone="success" text={t('Работа уже продвигается — новый срок добавится к текущему.')} /> : null}
      {!available ? <Notice tone="danger" text={t('Продвигать можно работу в продаже или на аукционе.')} /> : null}

      <View style={styles.tariffs} accessibilityRole="radiogroup">
        {tariffs.map((tr) => {
          const on = selected?.days === tr.days;
          return (
            <Pressable key={tr.days} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setDays(tr.days)} style={[styles.tariff, on && styles.tariffOn]}>
              <T variant="title">{`${tr.days} ${plural(tr.days, ['день', 'дня', 'дней'], ['day', 'days'])}`}</T>
              <T variant="price">{formatPrice(tr.price_kop)}</T>
              <T variant="small">{t('{p} в день', { p: formatPrice(Math.round(tr.price_kop / tr.days / 100) * 100) })}</T>
            </Pressable>
          );
        })}
      </View>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button title={selected ? t('Оплатить {sum}', { sum: formatPrice(selected.price_kop) }) : t('Оплатить')} loading={busy} disabled={!available || !selected} onPress={buy} />
      <TestPaymentSheet payment={payment} purpose={t('Продвижение «{title}»', { title: a.title })} onPaid={paid} onCancel={() => setPayment(null)} />
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  item: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  thumb: { width: 72, height: 90, borderRadius: radius.art },
  flex: { flex: 1 },
  tariffs: { flexDirection: 'row', gap: space.sm },
  tariff: { flex: 1, gap: 4, padding: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: c.hairline, backgroundColor: c.paper },
  tariffOn: { borderColor: c.bordeaux, borderWidth: 2 },
}));
