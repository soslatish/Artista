import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { errorText, post } from '@/api/client';
import { keys, useAuction, useSafeDeals } from '@/api/hooks';
import type { Auction } from '@/api/types';
import { useSession } from '@/auth/session';
import { useContactArtist } from '@/features/contact-artist';
import { useT } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { formatCountdown, formatMessageTime, formatPrice, formatTimeLeft, parseRubles } from '@/lib/format';
import { requireAuth, validId } from '@/lib/guard';
import { useNow } from '@/lib/use-now';
import { Button, Chip, ErrorState, Field, Loading, Notice, T } from '@/ui/primitives';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

export default function AuctionRoute() {
  const id = validId(useLocalSearchParams().id);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <AuctionScreen id={id} />;
}

function AuctionScreen({ id }: { id: string }) {
  const q = useAuction(id);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <AuctionView a={q.data} />;
}

function AuctionView({ a }: { a: Auction }) {
  const safeDeals = useSafeDeals();
  const { contact, busy: contacting } = useContactArtist();
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const qc = useQueryClient();
  const now = useNow();
  const { user } = useSession();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = user?.id === a.artist_id;
  const live = a.status === 'live' && new Date(a.ends_at) > now;
  const kop = parseRubles(amount);
  const quick = [a.min_bid_kop, a.min_bid_kop + a.step_kop, a.min_bid_kop + a.step_kop * 3];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.auction(a.id) });
    qc.invalidateQueries({ queryKey: keys.artwork(a.artwork_id) });
  };

  const bid = (value: number) => {
    if (!requireAuth(!!user)) return;
    confirmAction(t('Сделать ставку {p}?', { p: formatPrice(value) }), t('Ставка — обязательство купить работу, если она окажется последней.'), async () => {
      setBusy(true);
      setError('');
      try {
        const next = await post<Auction>(`/auctions/${a.id}/bids`, { amount_kop: value });
        qc.setQueryData(keys.auction(a.id), next);
        setAmount('');
        refresh();
      } catch (e) {
        setError(errorText(e));
        refresh(); // ставку могли перебить — обновляем минимальную ставку и историю
      } finally {
        setBusy(false);
      }
    });
  };

  const cancel = () =>
    confirmAction(t('Снять с аукциона?'), t('Работа вернётся в продажу по обычной цене.'), async () => {
      try {
        await post(`/auctions/${a.id}/cancel`);
        refresh();
        qc.invalidateQueries({ queryKey: ['artworks'] });
        qc.invalidateQueries({ queryKey: ['my-artworks'] });
        router.back();
      } catch (e) {
        setError(errorText(e));
      }
    }, { destructive: true });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/artwork/[id]', params: { id: a.artwork_id } })} style={styles.item}>
        {a.artwork.image_url ? <Image source={{ uri: a.artwork.image_url }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
        <T variant="artTitle" style={styles.flex}>
          {a.artwork.title}
        </T>
      </Pressable>

      <View style={styles.board}>
        <T variant="small">{a.current_kop ? t('Текущая ставка') : t('Стартовая цена')}</T>
        <T variant="display">{formatPrice(a.current_kop ?? a.start_kop)}</T>
        <T variant="bodyStrong" color={live ? colors.bordeaux : colors.graphite}>
          {live ? t('До конца {time}', { time: formatCountdown(a.ends_at, now) }) : a.status === 'cancelled' ? t('Аукцион отменён') : t('Торги завершены')}
        </T>
        <T variant="small">{t('Ставок: {n}. Шаг — {step}. Ставка в последние 5 минут продлевает торги.', { n: a.bids_count, step: formatPrice(a.step_kop) })}</T>
      </View>

      {a.i_won ? (
        <View style={styles.win}>
          {safeDeals ? (
            <>
              <Notice tone="success" text={a.checkout_until ? t('Вы выиграли! Оформите заказ в течение {left}.', { left: formatTimeLeft(a.checkout_until) }) : t('Вы выиграли этот аукцион.')} />
              {a.checkout_until ? <Button title={t('Оформить заказ')} onPress={() => router.push({ pathname: '/checkout/[artworkId]', params: { artworkId: a.artwork_id } })} /> : null}
            </>
          ) : (
            <>
              <Notice tone="success" text={t('Вы выиграли! Напишите художнику, чтобы договориться об оплате и доставке.')} />
              <Button
                title={t('Написать художнику')}
                loading={contacting}
                onPress={() =>
                  void contact({
                    artistId: a.artist_id,
                    artistName: '',
                    artworkId: a.artwork_id,
                    draft: t('Здравствуйте! Моя ставка {p} на «{title}» победила в аукционе. Как удобнее оплатить и получить работу?', { title: a.artwork.title, p: formatPrice(a.current_kop ?? a.start_kop) }),
                  })
                }
              />
            </>
          )}
        </View>
      ) : null}
      {live && a.is_leader ? <Notice tone="success" text={t('Ваша ставка лидирует. Пришлём уведомление, если её перебьют.')} /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}

      {live && !mine && !a.is_leader ? (
        <View style={styles.bidBox}>
          <T variant="heading">{t('Ваша ставка')}</T>
          <View style={styles.chips}>
            {quick.map((v) => (
              <Chip key={v} label={formatPrice(v)} selected={kop === v} onPress={() => setAmount(String(v / 100))} />
            ))}
          </View>
          <Field label={t('Сумма, ₽')} value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder={String(a.min_bid_kop / 100)} />
          <Button title={kop ? t('Поставить {p}', { p: formatPrice(kop) }) : t('Поставить {p}', { p: formatPrice(a.min_bid_kop) })} loading={busy} disabled={!!kop && kop < a.min_bid_kop} onPress={() => bid(kop ?? a.min_bid_kop)} />
        </View>
      ) : null}
      {mine && live && a.bids_count === 0 ? <Button title={t('Снять с аукциона')} variant="danger" onPress={cancel} /> : null}

      <T variant="heading">{t('История ставок')}</T>
      {a.bids.length === 0 ? <T variant="small">{t('Ставок пока нет — станьте первым.')}</T> : null}
      {a.bids.map((b, i) => (
        <View key={`${b.created_at}-${i}`} style={styles.bidRow}>
          <T variant={i === 0 ? 'bodyStrong' : 'body'} style={styles.flex}>
            {b.is_mine ? t('Вы') : b.bidder.replace('Участник', t('Участник'))}
          </T>
          <T variant="small">{formatMessageTime(b.created_at)}</T>
          <T variant={i === 0 ? 'bodyStrong' : 'body'}>{formatPrice(b.amount_kop)}</T>
        </View>
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  item: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  thumb: { width: 72, height: 90, borderRadius: radius.art, backgroundColor: c.plaster },
  flex: { flex: 1 },
  board: { gap: 4, padding: space.lg, borderRadius: radius.control, backgroundColor: c.goldSoft },
  win: { gap: space.md },
  bidBox: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.hairline },
}));
