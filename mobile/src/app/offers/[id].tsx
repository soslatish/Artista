import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { keys, useOffer, useSafeDeals } from '@/api/hooks';
import type { Offer } from '@/api/types';
import { useContactArtist } from '@/features/contact-artist';
import { offerStatusLabel, offerTone } from '@/features/offer-status';
import { useT } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { formatPrice, formatTimeLeft, parseRubles } from '@/lib/format';
import { validId } from '@/lib/guard';
import { Button, ErrorState, Field, Line, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

export default function OfferRoute() {
  const id = validId(useLocalSearchParams().id);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <OfferScreen id={id} />;
}

function OfferScreen({ id }: { id: string }) {
  const q = useOffer(id);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <OfferView o={q.data} />;
}

function OfferView({ o }: { o: Offer }) {
  const safeDeals = useSafeDeals();
  const { contact, busy: contacting } = useContactArtist();
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const qc = useQueryClient();
  const [counter, setCounter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isArtist = o.my_role === 'artist';
  const open = o.status === 'pending' || o.status === 'countered' || o.status === 'accepted';

  const act = async (action: string, body?: object) => {
    setBusy(true);
    setError('');
    try {
      const next = await post<Offer>(`/offers/${o.id}/${action}`, body);
      qc.setQueryData(keys.offer(o.id), next);
      qc.invalidateQueries({ queryKey: ['offers'] });
      qc.invalidateQueries({ queryKey: keys.artwork(o.artwork.id) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const counterKop = parseRubles(counter);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: o.artwork.id } })} style={styles.item}>
        {o.artwork.image_url ? <Image source={{ uri: o.artwork.image_url }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
        <View style={styles.flex}>
          <T variant="artTitle">{o.artwork.title}</T>
          <T variant="small">{isArtist ? t('Покупатель: {name}', { name: o.buyer.name }) : t('Художник: {name}', { name: o.artist.name })}</T>
          <T variant="smallStrong" color={offerTone(o, colors)}>
            {offerStatusLabel(o, t)}
          </T>
        </View>
      </Pressable>

      <View style={styles.sums}>
        <Line label={t('Цена работы')} value={formatPrice(o.price_kop)} />
        <Line label={t('Предложение покупателя')} value={formatPrice(o.amount_kop)} />
        {o.counter_kop ? <Line label={t('Встречная цена художника')} value={formatPrice(o.counter_kop)} /> : null}
        {o.agreed_kop ? <Line label={t('Согласовано')} value={formatPrice(o.agreed_kop)} strong /> : null}
      </View>
      {o.message ? (
        <View style={styles.message}>
          <T variant="smallStrong">{t('Сообщение')}</T>
          <T variant="body">{o.message}</T>
        </View>
      ) : null}
      {open ? <T variant="small">{t('Действует ещё {left}.', { left: formatTimeLeft(o.expires_at) })}</T> : null}
      {error ? <Notice tone="danger" text={error} /> : null}

      {isArtist && o.status === 'pending' ? (
        <View style={styles.actions}>
          <Button title={t('Принять {p}', { p: formatPrice(o.amount_kop) })} loading={busy} onPress={() => act('accept')} />
          <Field label={t('Или назовите свою цену, ₽')} value={counter} onChangeText={setCounter} keyboardType="number-pad" placeholder={String(Math.round(((o.amount_kop + o.price_kop) / 2) / 100))} />
          <Button title={t('Предложить встречную цену')} variant="secondary" disabled={!counterKop || busy} onPress={() => act('counter', { amount_kop: counterKop })} />
          <Button title={t('Отклонить')} variant="danger" disabled={busy} onPress={() => confirmAction(t('Отклонить предложение?'), t('Покупатель получит уведомление.'), () => void act('decline'), { destructive: true })} />
        </View>
      ) : null}
      {!isArtist && o.status === 'countered' ? (
        <View style={styles.actions}>
          <Button title={t('Согласиться на {p}', { p: formatPrice(o.counter_kop ?? 0) })} loading={busy} onPress={() => act('accept')} />
          <Button title={t('Отказаться')} variant="danger" disabled={busy} onPress={() => act('decline')} />
        </View>
      ) : null}
      {!isArtist && o.status === 'accepted' && safeDeals ? (
        <View style={styles.actions}>
          <Notice tone="success" text={t('Художник согласен. Оформите заказ — цена закреплена за вами на 24 часа.')} />
          <Button title={t('Оформить заказ за {p}', { p: formatPrice(o.agreed_kop ?? o.amount_kop) })} onPress={() => router.push({ pathname: '/checkout/[artworkId]', params: { artworkId: o.artwork.id } })} />
        </View>
      ) : null}
      {!isArtist && o.status === 'accepted' && !safeDeals ? (
        <View style={styles.actions}>
          <Notice tone="success" text={t('Художник согласен на {p}. Напишите ему, чтобы договориться об оплате и доставке.', { p: formatPrice(o.agreed_kop ?? o.amount_kop) })} />
          <Button
            title={t('Написать художнику')}
            loading={contacting}
            onPress={() =>
              void contact({
                artistId: o.artist.id,
                artistName: o.artist.name,
                artworkId: o.artwork.id,
                draft: t('Здравствуйте! Вы приняли моё предложение {p} за «{title}». Как удобнее оплатить и получить работу?', { p: formatPrice(o.agreed_kop ?? o.amount_kop), title: o.artwork.title }),
              })
            }
          />
        </View>
      ) : null}
      {!isArtist && open ? <Button title={t('Отозвать предложение')} variant="ghost" disabled={busy} onPress={() => act('withdraw')} /> : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  item: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  thumb: { width: 72, height: 90, borderRadius: radius.art, backgroundColor: c.plaster },
  flex: { flex: 1 },
  sums: { gap: space.sm, padding: space.lg, borderRadius: radius.control, backgroundColor: c.paper },
  message: { gap: 4 },
  actions: { gap: space.md },
}));
